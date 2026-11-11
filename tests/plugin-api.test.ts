import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Workspace} from 'obsidian';
import {PluginTurn} from '../src/plugin-api';

const inspect='inspect_pilafdob_plugin';
const propose='propose_pilafdob_plugin_change';
const request={plugin:'pinup',key:'pin',path:'Projects/Plan.md',value:'pin-up',reason:'Keep the plan visible'};

function fixture() {
 let pin:string|null=null;
 let writes=0;
 let allowed=true;
 let enabled=true;
 const provider={version:1,read:()=>pin,prepare:(_key:string,_path:string,value:string)=>{
  const before=pin;
  return {before,after:value,apply:async()=>{if(pin!==before)throw Error('Stale pin');pin=value;writes++;}};
 }};
 const replies:unknown[]=[provider];
 const workspace={trigger:(event:string,reply:(api:unknown)=>void)=>{
  if(event==='pilafdob:pinup:api:v1')replies.forEach(reply);
 }} as unknown as Workspace;
 return {provider,replies,turn:()=>new PluginTurn(workspace,()=>allowed,()=>enabled),deny:()=>{allowed=false;},disable:()=>{enabled=false;},changePin:(value:string)=>{pin=value;},get writes(){return writes;}};
}

test('plugin tools expose only available providers and stage changes without writes',async()=>{
 const f=fixture(),turn=f.turn();
 assert.deepEqual(turn.specs.map(spec=>spec.name),[inspect,propose]);
 assert.deepEqual(JSON.parse(turn.invoke(inspect,request)).value,null);
 assert.match(turn.invoke(propose,request),/must accept/);
 assert.equal(f.writes,0);
 assert.deepEqual(turn.changes.map(({path,before,after})=>({path,before,after})),[{path:request.path,before:'Unpinned',after:'Pinned up'}]);
 await turn.changes[0].apply();
 assert.equal(f.writes,1);
 assert.equal(JSON.parse(turn.invoke(inspect,request)).value,'pin-up');
});

test('approval rechecks provider identity, vault permissions and the prior option',async()=>{
 const f=fixture(),turn=f.turn();
 turn.invoke(propose,request);
 const change=turn.changes[0];
 f.changePin('normal');
 await assert.rejects(change.apply(),/Stale pin/);
 f.replies[0]={...f.provider};
 await assert.rejects(change.apply(),/disabled or reloaded/);
 f.replies[0]=f.provider;
 f.deny();
 await assert.rejects(change.apply(),/allowed vault path/);
 assert.equal(f.writes,0);
});

test('unavailable, duplicated and malformed plugin APIs cannot advertise tools',()=>{
 const f=fixture();
 f.replies.push(f.provider);
 assert.deepEqual(f.turn().specs,[]);
 f.replies.splice(0,2,{...f.provider,version:2});
 assert.deepEqual(f.turn().specs,[]);
});

test('runtime validation blocks arbitrary settings and unsupported values',()=>{
 const f=fixture(),turn=f.turn();
 assert.throws(()=>turn.invoke(propose,{...request,key:'clear-all-pins'}),/supported option/);
 assert.throws(()=>turn.invoke(propose,{...request,value:'everything'}),/supported value/);
 assert.throws(()=>turn.invoke(inspect,{plugin:'nicons',query:'book'}),/disabled or reloaded/);
 assert.deepEqual(turn.changes,[]);
 assert.equal(f.writes,0);
});

test('the integration toggle hides tools and revokes prepared changes',async()=>{
 const f=fixture(),turn=f.turn();
 turn.invoke(propose,request);
 const change=turn.changes[0];
 f.disable();
 assert.deepEqual(f.turn().specs,[]);
 assert.deepEqual(turn.changes,[]);
 assert.throws(()=>turn.invoke(inspect,request),/turned off/);
 await assert.rejects(change.apply(),/turned off/);
 assert.equal(f.writes,0);
});
