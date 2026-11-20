// RC hardening: a colour value with surrounding whitespace is normalised before the preview comparison.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {Workspace} from 'obsidian';
import {PluginTurn} from '../src/plugin-api';

const propose='propose_pilafdob_plugin_change';

function fixture(){
 let color='#000000';
 // A real companion plugin normalises the colour it stores, returning the trimmed form.
 const provider={version:1,read:()=>color,prepare:(_key:string,_path:string|undefined,value:string)=>{
  const after=value.trim();
  return {before:color,after,apply:async()=>{color=after;}};
 }};
 const workspace={app:{plugins:{enabledPlugins:new Set(['folderandgraphs-plus'])}},trigger:(event:string,reply:(api:unknown)=>void)=>{
  if(event==='pilafdob:folderandgraphs-plus:api:v1')reply(provider);
 }} as unknown as Workspace;
 return {turn:new PluginTurn(workspace,()=>true,()=>true),get color(){return color;}};
}

test('a padded colour is accepted and stored trimmed, not rejected as an invalid preview',()=>{
 const f=fixture();
 const result=f.turn.invoke(propose,{plugin:'folderandgraphs-plus',key:'nodeColor',value:'  #ff0000  ',reason:'Match the theme'});
 assert.match(result,/must accept/);
 assert.equal(f.turn.changes[0].after,'#ff0000');
});

test('an already-trimmed colour still stages normally',()=>{
 const f=fixture();
 assert.match(f.turn.invoke(propose,{plugin:'folderandgraphs-plus',key:'nodeColor',value:'#00ff00',reason:'Green'}),/must accept/);
 assert.equal(f.turn.changes[0].after,'#00ff00');
});
