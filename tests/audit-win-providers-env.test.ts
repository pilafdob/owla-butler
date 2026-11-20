// Windows hardening (round 2): OpenCode env isolation under Windows'
// case-insensitive environment keys, binary detection across the Windows
// install shapes (Go .exe, npm/bun/scoop shims), and the version probe's
// CRLF/OEM console output. Fake CLIs only — no model turn, no real daemon.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,win32} from 'node:path';
import {isolatedOpencodeEnv,findOpencodeExecutable,supportedOpencodeVersion} from '../src/opencode';
import {defaultCliDirectories,runCli,sanitizedEnv} from '../src/cli';

test('Windows env casing cannot bypass the OPENCODE_* behaviour strip',()=>{
 const directory=join(tmpdir(),'owla','session');
 const env=isolatedOpencodeEnv({
  PATH:'/usr/bin',
  opencode_config:'C:\\evil.json',
  Opencode_Config_Content:'{}',
  OPENCODE_PTY_HANDOFF:'1',
  Opencode_Models_Url:'https://example.test',
  opencode_permission:'ask',
  // A lower-cased copy of one of OWLA's own switches must not survive as a
  // duplicate key: Windows would pick one of the two spellings at spawn.
  opencode_disable_project_config:'0',
  OPENCODE_DISABLE_AUTOUPDATE:'0',
 },directory);
 for(const key of ['opencode_config','Opencode_Config_Content','OPENCODE_PTY_HANDOFF','Opencode_Models_Url','opencode_permission','opencode_disable_project_config'])
  assert.equal(env[key],undefined,key+' must not reach the isolated server');
 assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG,'1');
 assert.equal(env.OPENCODE_DISABLE_AUTOUPDATE,'1','OWLA’s switch wins over an inherited value in any casing');
 // No two surviving OPENCODE_* keys may differ only by case.
 const upper=Object.keys(env).filter(key=>key.toUpperCase().startsWith('OPENCODE_')).map(key=>key.toUpperCase());
 assert.equal(new Set(upper).size,upper.length,'case-duplicate OPENCODE_* keys must not be forwarded');
});

test('Windows env casing keeps provider credentials in every spelling',()=>{
 const env=isolatedOpencodeEnv({
  PATH:'/usr/bin',
  opencode_api_key:'***'+'key',
  OpenCode_Auth_Token:'***'+'token',
  OPENCODE_SECRET:'***'+'secret',
  ANTHROPIC_API_KEY:'***'+'test',
  OPENAI_API_KEY:'***'+'test',
  // The server password is OWLA's own, added at spawn; an inherited one is a
  // behaviour variable and must not survive.
  OPENCODE_SERVER_PASSWORD:'***',
  opencode_server_username:'someone',
 },join(tmpdir(),'owla','session'));
 assert.equal(env.opencode_api_key,'***'+'key');
 assert.equal(env.OpenCode_Auth_Token,'***'+'token');
 assert.equal(env.OPENCODE_SECRET,'***'+'secret');
 assert.equal(env.ANTHROPIC_API_KEY,'***'+'test');
 assert.equal(env.OPENAI_API_KEY,'***'+'test');
 assert.equal(env.OPENCODE_SERVER_PASSWORD,undefined);
 assert.equal(env.opencode_server_username,undefined);
});

test('the isolated env pins the system ComSpec on Windows and leaves POSIX untouched',()=>{
 const env=isolatedOpencodeEnv({PATH:'/usr/bin',COMSPEC:'C:\\evil\\cmd.exe',ComSpec:'C:\\evil\\cmd.exe'},join(tmpdir(),'owla','session'));
 if(process.platform==='win32'){
  assert.equal(env.COMSPEC,undefined,'every inherited spelling is stripped');
  assert.match(env.ComSpec??'',/\\System32\\cmd\.exe$/i,'the validated system interpreter is pinned');
 }else{
  assert.equal(env.COMSPEC,'C:\\evil\\cmd.exe','off Windows the variable is not a shim interpreter');
  assert.equal(env.ComSpec,'C:\\evil\\cmd.exe');
 }
});

test('OpenCode discovery covers the Windows install shapes',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-win-discovery-'));
 try{
  const dir=(name:string)=>{const path=join(root,name);mkdirSync(path,{recursive:true});return path;};
  const exe=dir('go'),cmd=dir('npm'),bat=dir('bat'),upper=dir('upper'),priority=dir('priority'),space=dir('First Last'),wrong=dir('wrong');
  writeFileSync(join(exe,'opencode.exe'),'MZ placeholder');
  writeFileSync(join(cmd,'opencode.cmd'),'@echo off\r\n');
  writeFileSync(join(bat,'opencode.bat'),'@echo off\r\n');
  writeFileSync(join(upper,'OPENCODE.CMD'),'@echo off\r\n');
  for(const name of ['opencode.com','opencode.exe','opencode.bat','opencode.cmd'])writeFileSync(join(priority,name),'placeholder');
  writeFileSync(join(space,'opencode.exe'),'MZ placeholder');
  writeFileSync(join(wrong,'opencode.txt'),'not executable');
  writeFileSync(join(wrong,'opencode'),'no extension');
  // The Go binary, the npm shim and the batch shim are all found.
  assert.equal(findOpencodeExecutable(exe,[]),join(exe,'opencode.exe'));
  assert.equal(findOpencodeExecutable(cmd,[]),join(cmd,'opencode.cmd'));
  assert.equal(findOpencodeExecutable(bat,[]),join(bat,'opencode.bat'));
  // Extensions match case-insensitively, like NTFS and PATHEXT. Discovery
  // returns the canonical candidate spelling; NTFS resolves it to the file.
  const foundUpper=findOpencodeExecutable(upper,[]);
  assert.equal(foundUpper.toLowerCase(),join(upper,'opencode.cmd').toLowerCase());
  assert.ok(existsSync(foundUpper));
  // Within one directory the PATHEXT order wins: .com before .exe before .bat before .cmd.
  assert.equal(findOpencodeExecutable(priority,[]),join(priority,'opencode.com'));
  // Quoted PATH entries and spaces in the user name are handled.
  assert.equal(findOpencodeExecutable('"'+space+'"',[]),join(space,'opencode.exe'));
  assert.equal(findOpencodeExecutable([wrong,exe].join(';'),[]),join(exe,'opencode.exe'));
  // Non-executable shapes and relative entries are refused.
  assert.equal(findOpencodeExecutable(wrong,[]),'');
  assert.equal(findOpencodeExecutable('.',[]),'');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('the default CLI directories cover every Windows per-user installer',()=>{
 const home='C:\\Users\\First Last';
 const env={APPDATA:win32.join(home,'AppData','Roaming'),LOCALAPPDATA:win32.join(home,'AppData','Local')};
 const dirs=defaultCliDirectories([],'win32',home,env);
 for(const dir of [
  win32.join(home,'.local','bin'),win32.join(home,'.claude','local'),
  win32.join(env.APPDATA,'npm'),
  win32.join(env.LOCALAPPDATA,'Programs','OpenCode'),win32.join(env.LOCALAPPDATA,'pnpm'),
  win32.join(home,'scoop','shims'),win32.join(home,'.volta','bin'),win32.join(home,'.bun','bin'),
 ])assert.ok(dirs.includes(dir),dir);
 // Without the environment variables the per-user installers are still covered.
 const bare=defaultCliDirectories([],'win32',home,{});
 assert.ok(bare.includes(win32.join(home,'.bun','bin')));
 assert.ok(!bare.includes(win32.join(home,'AppData','Local','pnpm')));
 // POSIX behaviour is unchanged.
 assert.deepEqual(defaultCliDirectories([],'linux','/home/u',{}),['/usr/local/bin','/opt/homebrew/bin',join('/home/u','.local','bin')]);
});

test('the version probe tolerates CRLF console output from a Windows shim',{timeout:20000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-win-version-'));
 try{
  const executable=join(root,process.platform==='win32'?'opencode.cmd':'opencode');
  if(process.platform==='win32')writeFileSync(executable,'@echo off\r\necho opencode v2.2.7\r\n');
  else{writeFileSync(executable,'#!/bin/sh\nprintf "opencode v2.2.7\\r\\n"\n',{mode:0o700});chmodSync(executable,0o700);}
  // The same call readVersion() makes: sanitized env, bounded output.
  const raw=await runCli(executable,['--version'],{env:sanitizedEnv(),timeout:10000,maxBuffer:100000});
  if(process.platform==='win32')assert.ok(raw.includes('\r'),'cmd echo emits CRLF');
  assert.equal(raw.trim(),'opencode v2.2.7');
  assert.equal(supportedOpencodeVersion(raw.trim()),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});
