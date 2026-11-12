import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join,win32} from 'node:path';
import {defaultStorageDirectory,findCliExecutable,isCliExecutable,runCli} from '../src/cli';

test('Windows storage defaults to local per-user application data',()=>{
 assert.equal(defaultStorageDirectory('win32','C:\\Users\\Ada',{LOCALAPPDATA:'C:\\Users\\Ada\\AppData\\Local'}),win32.join('C:\\Users\\Ada\\AppData\\Local','OWLA Butler'));
 assert.equal(defaultStorageDirectory('win32','C:\\Users\\Ada',{}),win32.join('C:\\Users\\Ada','AppData','Local','OWLA Butler'));
});

test('CLI discovery resolves Windows command shims from PATH',()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-discovery-'));
 try{
  const bin=join(root,'bin');
  mkdirSync(bin);
  const shim=join(bin,'example.cmd');
  writeFileSync(shim,'@echo off\r\nexit /b 0\r\n');
  assert.equal(findCliExecutable('example',[bin].join(delimiter),[]),shim);
  assert.equal(isCliExecutable(shim),true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows command shims preserve arguments without shell interpretation',async()=>{
 if(process.platform!=='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-args-'));
 try{
  const script=join(root,'echo.mjs');
  const shim=join(root,'echo.cmd');
  writeFileSync(script,'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
  writeFileSync(shim,'@echo off\r\n\"'+process.execPath+'\" \"'+script+'\" %*\r\n');
  const args=['space value','left&right','%PATH%','(group)'];
  assert.deepEqual(JSON.parse(await runCli(shim,args,{timeout:10000,maxBuffer:10000})),args);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('POSIX CLI discovery still requires an executable file',()=>{
 if(process.platform==='win32')return;
 const root=mkdtempSync(join(tmpdir(),'owla-cli-posix-'));
 try{
  const bin=join(root,'bin');
  mkdirSync(bin);
  const notExecutable=join(bin,'example');
  writeFileSync(notExecutable,'not executable',{mode:0o600});
  assert.equal(findCliExecutable('example',bin,[]),'');
  writeFileSync(notExecutable,'#!/bin/sh\nexit 0\n',{mode:0o700});
  assert.equal(findCliExecutable('example',bin,[]),notExecutable);
 }finally{rmSync(root,{recursive:true,force:true});}
});
