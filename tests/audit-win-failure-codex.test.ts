// Windows failure-handling audit (win-failure): Codex launch/link behaviour on
// Windows. A fake app-server speaks the real JSON-RPC protocol with CRLF line
// endings; the launcher is a .cmd shim on Windows (npm's shim shape) and a
// shell wrapper elsewhere. No model turn, no provider contact.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexBridge,ensureCodexPrivateHome} from '../src/codex';

const CRLF=String.fromCharCode(13,10);
const LF=String.fromCharCode(10);
const FAKE=`const [mode,...args]=process.argv.slice(2);
const LF=String.fromCharCode(10),CR=String.fromCharCode(13);
const EOL=mode==='crlf'?CR+LF:LF;
if(args[0]==='--version'){process.stdout.write('codex-cli 0.169.0'+EOL);process.exit(0);}
if(mode==='crlf-stderr'){process.stderr.write('first line'+CR+LF+'thread panicked: config.rs'+CR+LF);setTimeout(()=>process.exit(1),80);}
else{
 let buffer='';
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{
  buffer+=chunk;let index;
  while((index=buffer.indexOf(LF))>=0){
   const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
   if(!line.trim())continue;
   const message=JSON.parse(line);
   if(message.id===undefined)continue;
   let result={};
   if(message.method==='config/read')result={config:{notify:[],hooks:null,sandbox_mode:'read-only',approval_policy:'never',features:{shell_tool:false,apps:false},analytics:{enabled:false},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}};
   else if(message.method==='account/read')result={account:{type:'chatgpt',planType:'plus'}};
   else if(message.method==='model/list')result={data:[{id:'fake',model:'fake',displayName:'Fake',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:''}]}],nextCursor:null};
   process.stdout.write(JSON.stringify({id:message.id,result})+EOL);
  }
 });
}
`;

async function fakeCodex(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-win-failure-codex-'));
 const script=join(folder,'fake.mjs');
 writeFileSync(script,FAKE);
 let file:string;
 if(process.platform==='win32'){
  file=join(folder,'codex.cmd');
  writeFileSync(file,'@echo off'+CRLF+'"'+process.execPath+'" "'+script+'" '+mode+' %*'+CRLF);
 }else{
  file=join(folder,'codex');
  writeFileSync(file,'#!/bin/sh'+LF+'exec "'+process.execPath+'" "'+script+'" '+mode+' "$@"'+LF,{mode:0o700});
 }
 const bridge=new CodexBridge();
 const cwd=join(folder,'session');
 const cleanup=async()=>{bridge.disconnect();await (bridge as unknown as {closing:Promise<void>}).closing;rmSync(folder,{recursive:true,force:true});};
 return {folder,file,cwd,bridge,cleanup};
}

test('CRLF protocol lines complete the Codex handshake',async()=>{
 const fake=await fakeCodex('crlf');
 try{
  await fake.bridge.connect(fake.file,fake.cwd);
  assert.equal(fake.bridge.ready,true);
  assert.equal(fake.bridge.models.length,1);
 }finally{await fake.cleanup();}
});

test('CRLF stderr keeps the bounded last-error cause without stray carriage returns',async()=>{
 const fake=await fakeCodex('crlf-stderr');
 try{
  await assert.rejects(fake.bridge.connect(fake.file,fake.cwd),/disconnected/);
  assert.match(fake.bridge.status,/Last error: thread panicked: config\.rs/);
  assert.ok(!fake.bridge.status.includes(String.fromCharCode(13)),'the cause line is trimmed');
  assert.equal(fake.bridge.running,false);
 }finally{await fake.cleanup();}
});

test('a shim whose target is missing reports the launch cause, not a cancellation',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'owla-win-failure-missing-'));
 const bridge=new CodexBridge();
 try{
  const missing=join(folder,'absent.mjs');
  let file:string;
  if(process.platform==='win32'){
   file=join(folder,'codex.cmd');
   writeFileSync(file,'@echo off'+CRLF+'"'+process.execPath+'" "'+missing+'" %*'+CRLF);
  }else{
   file=join(folder,'codex');
   writeFileSync(file,'#!/bin/sh'+LF+'exec "'+process.execPath+'" "'+missing+'" "$@"'+LF,{mode:0o700});
  }
  const error=await bridge.connect(file,join(folder,'session')).then(()=>null,(e:Error)=>e);
  assert.ok(error,'connect must reject');
  assert.doesNotMatch(error!.message,/cancelled/,'a launch failure is not a user cancellation');
  assert.match(error!.message,/Cannot find module|not recognized|Could not start/);
  assert.equal(bridge.running,false);
 }finally{bridge.disconnect();await (bridge as unknown as {closing:Promise<void>}).closing;rmSync(folder,{recursive:true,force:true});}
});

// Private-home links on Windows: file symlinks are EPERM without Developer
// Mode, so the product falls back to hard links. These assertions run
// unprivileged and prove the link (never a copy) and the refusal of aliases.
const linkedTo=(target:string,from:string)=>{
 const info=lstatSync(target);
 if(info.isSymbolicLink())return true; // named by readlink; checked by callers that can create symlinks
 const a=statSync(target),b=statSync(from);
 return info.nlink>1&&a.ino===b.ino&&a.dev===b.dev;
};

test('a hard link planted to another credential is replaced, never kept',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-home-alias-'));
 try{
  const user=join(root,'user'),home=join(root,'private');
  mkdirSync(user,{recursive:true});
  writeFileSync(join(user,'auth.json'),'user-credential');
  writeFileSync(join(root,'elsewhere'),'other-credential');
  mkdirSync(home,{recursive:true});
  linkSync(join(root,'elsewhere'),join(home,'auth.json'));
  ensureCodexPrivateHome(home,user);
  assert.ok(linkedTo(join(home,'auth.json'),join(user,'auth.json')),'the wrong hard link must be replaced');
  assert.equal(readFileSync(join(home,'auth.json'),'utf8'),'user-credential');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the hard-link fallback keeps one rotating credential',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-home-rotate-'));
 try{
  const user=join(root,'user'),home=join(root,'private');
  mkdirSync(user,{recursive:true});
  writeFileSync(join(user,'auth.json'),'token-1');
  ensureCodexPrivateHome(home,user);
  // Codex rotates the refresh token in place; the private home must see it.
  writeFileSync(join(user,'auth.json'),'token-2');
  assert.equal(readFileSync(join(home,'auth.json'),'utf8'),'token-2');
  const before=statSync(join(home,'auth.json')).ino;
  ensureCodexPrivateHome(home,user);
  assert.equal(statSync(join(home,'auth.json')).ino,before,'a valid link is kept, not churned');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a case-fold alias of the sign-in path does not churn the link',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-home-case-'));
 try{
  const user=join(root,'user'),home=join(root,'private');
  mkdirSync(user,{recursive:true});
  writeFileSync(join(user,'auth.json'),'cred');
  ensureCodexPrivateHome(home,user);
  const before=statSync(join(home,'auth.json')).ino;
  // NTFS resolves the upper-cased alias to the same directory.
  ensureCodexPrivateHome(home,user.toUpperCase());
  assert.equal(statSync(join(home,'auth.json')).ino,before);
  assert.equal(readFileSync(join(home,'auth.json'),'utf8'),'cred');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('a junction planted as a sign-in file is replaced by the real link',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-home-junction-'));
 try{
  const user=join(root,'user'),home=join(root,'private');
  mkdirSync(user,{recursive:true});mkdirSync(home,{recursive:true});
  writeFileSync(join(user,'auth.json'),'cred');
  // A directory link wearing the auth file's name: lstat reports a symlink.
  symlinkSync(user,join(home,'auth.json'),process.platform==='win32'?'junction':undefined);
  ensureCodexPrivateHome(home,user);
  const info=lstatSync(join(home,'auth.json'));
  assert.ok(!info.isDirectory(),'the planted directory link is gone');
  assert.equal(readFileSync(join(home,'auth.json'),'utf8'),'cred');
  assert.ok(linkedTo(join(home,'auth.json'),join(user,'auth.json')));
  assert.ok(statSync(join(user,'auth.json')).isFile(),'the junction target was not touched');
 }finally{rmSync(root,{recursive:true,force:true});}
});
