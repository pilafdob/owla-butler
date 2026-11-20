// npm-shim → direct node launch for Claude on Windows (3.7.0-RC round 2,
// orchestrator consolidation of win-stream X1/D1 × win-failure WF1).
// cmd.exe truncates a wrapped /c command line at an embedded CR/LF, so the
// control-char guard in spawnCli refuses multi-line --system-prompt arguments
// on .cmd shims. windowsShimScript recognises the standard npm cmd-shim layout
// and launches node directly (arguments verbatim); anything else keeps the
// guarded shim path. Pure-helper tests are platform-parameterized and run on
// every host; the end-to-end npm-shim turn is Windows-only.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,isAbsolute} from 'node:path';
import {ClaudeBridge,windowsShimScript,shimLaunch} from '../src/claude';
import {runCli} from '../src/cli';
import type {ProviderRunOptions} from '../src/provider';

const win=process.platform==='win32';
const folder=()=>mkdtempSync(join(tmpdir(),'owla-win-shim-'));
// Windows can briefly hold a folder after children die (Defender/indexer).
const cleanup=(dir:string)=>{for(let attempt=0;;attempt++){try{rmSync(dir,{recursive:true,force:true});return;}catch(e){const code=(e as NodeJS.ErrnoException).code;if(attempt>=5||(code!=='EPERM'&&code!=='EBUSY'&&code!=='EACCES'))throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}}};

const NPM_SHIM='@ECHO off\r\nGOTO start\r\n@SETLOCAL\r\n@SET PATHEXT=%PATHEXT:;.JS;=;%\r\n:start\r\n@IF EXIST "%~dp0\\node.exe" (\r\n  "%~dp0\\node.exe"  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n) ELSE (\r\n  @SETLOCAL\r\n  node  "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n)\r\n';
const SCRIPT_REL='node_modules/@anthropic-ai/claude-code/cli.js';

function npmFixture(dir:string,shimText=NPM_SHIM){
 const shim=join(dir,'claude.cmd');
 writeFileSync(shim,shimText);
 const script=join(dir,SCRIPT_REL);
 mkdirSync(join(dir,'node_modules','@anthropic-ai','claude-code'),{recursive:true});
 writeFileSync(script,'// fake cli\r\n');
 return {shim,script};
}

test('an npm-style Windows shim resolves to its node script',()=>{
 const dir=folder();
 try{
  const {shim,script}=npmFixture(dir);
  const resolved=windowsShimScript(shim,'win32');
  assert.ok(resolved,'the standard npm cmd-shim layout must resolve');
  assert.notEqual(resolved.node,'node');
  assert.ok(isAbsolute(resolved.node),'the interpreter must be an absolute path, never a cwd-searchable bare name');
  assert.equal(resolved.script,script);
  const launch=shimLaunch(shim,['--system-prompt','line1\nline2'],'win32');
  assert.equal(launch.file,resolved.node);
  assert.ok(isAbsolute(launch.file),'the launch command must be the resolved absolute node');
  assert.deepEqual(launch.args,[script,'--system-prompt','line1\nline2']);
 }finally{cleanup(dir);}
});

test('a shim with a local node.exe prefers it over PATH node',()=>{
 const dir=folder();
 try{
  const {shim}=npmFixture(dir);
  writeFileSync(join(dir,'node.exe'),'');
  const resolved=windowsShimScript(shim,'win32');
  assert.equal(resolved?.node,join(dir,'node.exe'));
 }finally{cleanup(dir);}
});

test('case-variant mentions of the same script deduplicate on Windows',()=>{
 const dir=folder();
 try{
  const text='@ECHO off\r\nnode "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\nnode "%~dp0\\node_modules\\@anthropic-ai\\claude-code\\CLI.JS" %*\r\n';
  const {shim,script}=npmFixture(dir,text);
  const resolved=windowsShimScript(shim,'win32');
  assert.equal(resolved?.script,script);
 }finally{cleanup(dir);}
});

test('only the npm layout resolves; everything else keeps the guarded shim',()=>{
 const dir=folder();
 try{
  const {shim,script}=npmFixture(dir);
  // No %~dp0 target (e.g. an absolute-path wrapper) → null.
  const absolute=join(dir,'absolute.cmd');
  writeFileSync(absolute,'@echo off\r\n"'+process.execPath+'" "'+script+'" %*\r\n');
  assert.equal(windowsShimScript(absolute,'win32'),null);
  // Two DIFFERENT scripts → ambiguous → null.
  const two=join(dir,'two.cmd');
  writeFileSync(two,'@ECHO off\r\nnode "%~dp0\\a.js" %*\r\nnode "%~dp0\\b.js" %*\r\n');
  writeFileSync(join(dir,'a.js'),'');writeFileSync(join(dir,'b.js'),'');
  assert.equal(windowsShimScript(two,'win32'),null);
  // Traversal, env expansion and drive-letter targets fail closed.
  for(const rel of ['..\\evil.js','%USERPROFILE%\\evil.js','C:\\evil.js']){
   const bad=join(dir,'bad.cmd');
   writeFileSync(bad,'@ECHO off\r\nnode "%~dp0\\'+rel+'" %*\r\n');
   assert.equal(windowsShimScript(bad,'win32'),null,rel);
  }
  // A quoted target spanning lines (embedded control chars) fails closed.
  const span=join(dir,'span.cmd');
  writeFileSync(span,'@ECHO off\r\nnode "%~dp0\\a\nb.js" %*\r\n');
  assert.equal(windowsShimScript(span,'win32'),null);
  // Missing script file → null.
  const missing=join(dir,'missing.cmd');
  writeFileSync(missing,'@ECHO off\r\nnode "%~dp0\\nope.js" %*\r\n');
  assert.equal(windowsShimScript(missing,'win32'),null);
  // A directory named like a script is not a file → null.
  const dirTarget=join(dir,'dirtarget.cmd');
  mkdirSync(join(dir,'folder.js'));
  writeFileSync(dirTarget,'@ECHO off\r\nnode "%~dp0\\folder.js" %*\r\n');
  assert.equal(windowsShimScript(dirTarget,'win32'),null);
  // No node invocation mentioned → null.
  const noNode=join(dir,'nonode.cmd');
  writeFileSync(noNode,'@ECHO off\r\n"%~dp0\\tool.exe" "%~dp0\\cli.js" %*\r\n');
  assert.equal(windowsShimScript(noNode,'win32'),null);
  // Not a shim extension / not Windows / unreadable → null.
  assert.equal(windowsShimScript(script,'win32'),null);
  assert.equal(windowsShimScript(shim,'darwin'),null);
  assert.equal(windowsShimScript(join(dir,'absent.cmd'),'win32'),null);
  // shimLaunch keeps the original command when nothing resolves.
  const args=['--system-prompt','x'];
  const kept=shimLaunch(absolute,args,'win32');
  assert.equal(kept.file,absolute);assert.equal(kept.args,args);
  const posix=shimLaunch(shim,args,'darwin');
  assert.equal(posix.file,shim);assert.equal(posix.args,args);
 }finally{cleanup(dir);}
});

test('a resolved launch carries multi-line arguments verbatim to the child',{timeout:20000},async()=>{
 const dir=folder();
 try{
  const marker=join(dir,'argv.json');
  const script=join(dir,'echo-argv.js');
  writeFileSync(script,'require("node:fs").writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));\r\n');
  const shim=join(dir,'echo.cmd');
  writeFileSync(shim,'@ECHO off\r\nnode "%~dp0\\echo-argv.js" %*\r\n');
  const args=[marker,'line1\nline2\r\nline3','tail'];
  // On Windows go through the resolver; on POSIX launch node directly — the
  // mechanism under test is that a direct node launch never truncates argv.
  const launch=win?shimLaunch(shim,args):{file:process.execPath,args:[script,...args]};
  if(win){assert.ok(launch.file&&isAbsolute(launch.file),'the npm shim must resolve to an absolute node for this probe');}
  await runCli(launch.file,launch.args,{timeout:15000,maxBuffer:100000});
  assert.deepEqual(JSON.parse(readFileSync(marker,'utf8')),args.slice(1));
 }finally{cleanup(dir);}
});

// End-to-end: a turn through a real npm-layout claude.cmd delivers the WHOLE
// multi-line system prompt (cmd.exe would truncate it; the guard would refuse).
const fakeCli=`
const send=v=>process.stdout.write(JSON.stringify(v)+'\\r\\n');
process.stdin.setEncoding('utf8');
let buf='';
process.stdin.on('data',chunk=>{
 buf+=chunk;
 let i;
 while((i=buf.indexOf('\\n'))>=0){
  const line=buf.slice(0,i).trim();buf=buf.slice(i+1);
  if(!line)continue;
  const m=JSON.parse(line);
  if(m.type==='control_request'&&m.request_id==='owla-init'){send({type:'control_response',response:{subtype:'success',request_id:'owla-init',response:{}}});continue;}
  if(m.type==='user'){const j=process.argv.indexOf('--system-prompt');send({type:'result',subtype:'success',is_error:false,result:process.argv[j+1]});process.exit(0);}
 }
});
`;

test('a Claude turn through an npm shim delivers the whole multi-line prompt',{timeout:20000,skip:win?false:'Windows npm-shim resolution'},async()=>{
 const dir=folder();
 try{
  const shim=join(dir,'claude.cmd');
  writeFileSync(shim,NPM_SHIM);
  const scriptDir=join(dir,'node_modules','@anthropic-ai','claude-code');
  mkdirSync(scriptDir,{recursive:true});
  writeFileSync(join(scriptDir,'cli.js'),fakeCli);
  const bridge=new ClaudeBridge() as any;
  bridge.connect=async()=>{};bridge.executable=shim;
  const instructions='line1\nline2\nline3';
  const options:ProviderRunOptions={executable:shim,cwd:dir,model:'m',effort:'default',instructions,text:'hi',images:[],web:false,
   signal:new AbortController().signal,onText:()=>{},onActivity:()=>{},
   tools:[{type:'function',name:'read_note',description:'',inputSchema:{type:'object'}}],tool:async()=>'note text'};
  const result=await bridge.run(options);
  assert.equal(result.text,instructions,'the delivered prompt must be complete, never truncated at the first LF');
  assert.equal(bridge.running,false);
 }finally{cleanup(dir);}
});