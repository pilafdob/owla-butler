import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join} from 'node:path';
import {shimLaunch} from '../src/claude';
import {runCli,sanitizedEnv,trustedSystemDirectory} from '../src/cli';
import {HermesBridge,hermesFilteredEnv,sweepExcludedPrivateEntries} from '../src/hermes';

const win=process.platform==='win32';
const folder=()=>mkdtempSync(join(tmpdir(),'owla-followup-providers-'));
const cleanup=(root:string)=>rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});

test('resolved npm shim never searches the session cwd for node.cmd',{skip:!win},async()=>{
 const root=folder();
 try{
  const bin=join(root,'bin'),cwd=join(root,'session');mkdirSync(bin);mkdirSync(cwd);
  const shim=join(bin,'claude.cmd'),script=join(bin,'cli.js'),marker=join(root,'hijacked');
  writeFileSync(shim,'@echo off\r\nnode "%~dp0\\cli.js" %*\r\n');
  writeFileSync(script,'console.log(JSON.stringify(process.argv.slice(2)));');
  writeFileSync(join(cwd,'node.cmd'),'@echo off\r\necho hijacked > "'+marker+'"\r\necho CWD-NODE-CMD-EXECUTED\r\n');
  const args=['first\nsecond','tail'];
  const launch=shimLaunch(shim,args);
  // Exercise the real cross-spawn resolution seam, not a mocked spawn.
  const output=await runCli(launch.file,launch.args,{cwd,env:sanitizedEnv(),timeout:5000,maxBuffer:10000});
  assert.equal(existsSync(marker),false,'cwd node.cmd must never execute');
  assert.ok(isAbsolute(launch.file),'the interpreter must be an absolute binary path');
  assert.deepEqual(JSON.parse(output),args);
  assert.equal(readFileSync(script,'utf8'),'console.log(JSON.stringify(process.argv.slice(2)));');
 }finally{cleanup(root);}
});

test('the .env filter drops blocked assignments hidden after a lone CR',()=>{
 // python-dotenv splits on lone CR as well as LF/CRLF; a filter that only saw
 // LF would preserve ComSpec/PATH after a CR and re-inject them into the child.
 const out=hermesFilteredEnv('SAFE=ok\rComSpec=C:/foreign/cmd.exe\rPATH=C:/foreign\nKEEP=yes');
 assert.ok(out.includes('SAFE=ok'));
 assert.ok(!out.includes('ComSpec'),'a lone-CR assignment must not survive');
 assert.ok(!out.includes('PATH='),'a lone-CR PATH assignment must not survive');
 assert.ok(out.includes('KEEP=yes'));
});

test('a stale copied credential vault directory is swept even on reconnect',()=>{
 const root=folder();const home=join(root,'private');mkdirSync(home);
 try{
  // Marker present (firstMirror=false) + an older build's copied vault/.
  mkdirSync(join(home,'vault'));writeFileSync(join(home,'vault','vault.key'),'secret');
  sweepExcludedPrivateEntries(home,false);
  assert.equal(existsSync(join(home,'vault')),false,'the stale credential vault must be removed on every connect');
 }finally{cleanup(root);}
});

test('gateway-owned runtime directories survive a reconnect sweep',()=>{
 const root=folder();const home=join(root,'private');mkdirSync(home);
 try{
  mkdirSync(join(home,'sessions'));writeFileSync(join(home,'state.db'),'db');
  sweepExcludedPrivateEntries(home,false);
  assert.equal(existsSync(join(home,'sessions')),true,'the live session store must not be torn down');
  assert.equal(existsSync(join(home,'state.db')),true,'the live state database must not be deleted');
 }finally{cleanup(root);}
});

test('the first mirror pass removes every excluded entry, including runtime directories',()=>{
 const root=folder();const home=join(root,'private');mkdirSync(home);
 try{
  mkdirSync(join(home,'sessions'));writeFileSync(join(home,'state.db'),'db');
  mkdirSync(join(home,'vault'));writeFileSync(join(home,'vault','vault.key'),'secret');
  sweepExcludedPrivateEntries(home,true);
  assert.equal(existsSync(join(home,'sessions')),false);
  assert.equal(existsSync(join(home,'state.db')),false);
  assert.equal(existsSync(join(home,'vault')),false);
 }finally{cleanup(root);}
});

test('a planted foreign SystemRoot is not trusted when it lacks real system artifacts',{skip:!win},()=>{
 const root=folder();
 try{
  mkdirSync(join(root,'System32'));writeFileSync(join(root,'System32','cmd.exe'),'');
  const dir=trustedSystemDirectory({SystemRoot:root});
  assert.notEqual(dir.toLowerCase(),root.toLowerCase(),'a cmd.exe-only folder must fall back to the default');
  // The fallback literal must be C:\Windows (an unescaped \W would collapse to W).
  assert.equal(dir,['C:',String.fromCharCode(92),'Windows'].join(''));
 }finally{cleanup(root);}
});
