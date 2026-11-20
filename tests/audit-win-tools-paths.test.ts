// Windows hardening (round 2): Windows-style path arguments get actionable
// errors (forward-slash hint) instead of opaque refusals; vault-relative
// forward-slash paths remain the only accepted form.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import type {Workspace} from 'obsidian';
import {stubObsidian} from './helpers/load-main';
import {PluginTurn} from '../src/plugin-api';
import {noteGraph,type GraphSource} from '../src/vault-graph';
import {allowedPath} from '../src/core';

stubObsidian();
let decodeMoves:(value:unknown)=>{from:string;to:string}[];
before(async()=>{({decodeMoves}=await import('../src/organization'));});

const inspect='inspect_pilafdob_plugin';
const propose='propose_pilafdob_plugin_change';

test('decodeMoves explains forward slashes for backslash path arguments',()=>{
 assert.throws(()=>decodeMoves([{from:'Notes\\A.md',to:'Archive/A.md'}]),/forward slashes/);
 assert.throws(()=>decodeMoves([{from:'Notes/A.md',to:'Archive\\A.md'}]),/forward slashes/);
 // The generic validation still covers everything else.
 assert.throws(()=>decodeMoves([{from:'Notes/A.md',to:'C:/Archive/A.md'}]),/vault-relative/);
 assert.throws(()=>decodeMoves([]),/between 1 and 100/);
 assert.deepEqual(decodeMoves([{from:'Notes/A.md',to:'Archive/A.md'}]),[{from:'Notes/A.md',to:'Archive/A.md'}]);
});

function fixture(){
 const provider={version:1,read:()=>null,prepare:(_key:string,_path:string,value:string)=>({before:null,after:value,apply:async()=>{}})};
 const workspace={trigger:(event:string,reply:(api:unknown)=>void)=>{
  if(event==='pilafdob:pinup:api:v1')reply(provider);
 }} as unknown as Workspace;
 return new PluginTurn(workspace,()=>true,()=>true);
}

test('plugin tools explain forward slashes for backslash vault paths',()=>{
 const turn=fixture();
 assert.throws(()=>turn.invoke(inspect,{plugin:'pinup',key:'pin',path:'Projects\\Plan.md'}),/forward slashes/);
 assert.throws(()=>turn.invoke(propose,{plugin:'pinup',key:'pin',path:'Projects\\Plan.md',value:'pin-up',reason:'Keep it visible'}),/forward slashes/);
 // Forward-slash paths still work.
 assert.equal(JSON.parse(turn.invoke(inspect,{plugin:'pinup',key:'pin',path:'Projects/Plan.md'})).value,null);
 assert.match(turn.invoke(propose,{plugin:'pinup',key:'pin',path:'Projects/Plan.md',value:'pin-up',reason:'Keep it visible'}),/must accept/);
});

test('graph and path gates refuse Windows absolute, UNC and backslash forms',()=>{
 const source:GraphSource={resolvedLinks:{},unresolvedLinks:{},notes:()=>['Notes/A.md'],tags:()=>[],properties:()=>null,allowed:path=>allowedPath(path,'',null)};
 assert.throws(()=>noteGraph(source,'Notes\\A.md'),/allowed Markdown note/);
 assert.throws(()=>noteGraph(source,'C:/Vault/Notes/A.md'),/allowed Markdown note/);
 assert.throws(()=>noteGraph(source,'\\\\server\\share\\A.md'),/allowed Markdown note/);
 assert.equal(allowedPath('Notes/A.md','',null),true);
 assert.equal(allowedPath('Notes\\A.md','',null),false);
 assert.equal(allowedPath('C:/Vault/Notes/A.md','',null),false);
 assert.equal(allowedPath('Notes/A.md','',null,'win32'),true);
 // Spaces and long segments are fine; trailing dots/spaces are Windows-only refusals.
 assert.equal(allowedPath('My Notes/Long Folder Name/A.md','',null,'win32'),true);
 assert.equal(allowedPath('Dr./A.md','',null,'win32'),false);
 assert.equal(allowedPath('Dr./A.md','',null,'darwin'),true);
});
