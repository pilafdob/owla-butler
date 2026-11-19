// RC hardening: vault-graph results are bounded; offsets are validated.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeGraphQuery,noteGraph,queryGraph,type GraphSource} from '../src/vault-graph';

const many:Record<string,number>={};for(let i=0;i<300;i++)many['n'+i+'.md']=1;
const hub:GraphSource={
 resolvedLinks:{'hub.md':many},unresolvedLinks:{'hub.md':many},
 notes:()=>['hub.md'],tags:()=>[],properties:()=>({huge:'x'.repeat(5000)}),allowed:()=>true,
};

test('noteGraph caps outgoing/unresolved lists and truncates huge properties',()=>{
 const graph=noteGraph(hub,'hub.md');
 assert.equal(graph.outgoing.length,100);
 assert.equal(graph.outgoingCount,300);
 assert.equal(graph.unresolved.length,100);
 assert.equal(graph.unresolvedCount,300);
 assert.ok((graph.properties.huge as string).length<600,'a huge property is truncated');
 assert.ok(JSON.stringify(graph).length<60_000,'the whole result stays bounded');
});

test('a property query truncates the displayed value but matches on the raw value',()=>{
 const source:GraphSource={
  resolvedLinks:{},unresolvedLinks:{},notes:()=>['a.md'],tags:()=>[],
  properties:()=>({status:'done',blob:'y'.repeat(5000)}),allowed:()=>true,
 };
 const matched=queryGraph(source,{property:'status',value:'done'}) as {items:{path:string;value:unknown}[]};
 assert.deepEqual(matched.items.map(item=>item.path),['a.md']);
 const blob=queryGraph(source,{property:'blob'}) as {items:{value:unknown}[]};
 assert.ok((blob.items[0].value as string).length<600);
});

test('offset must be a nonnegative integer',()=>{
 assert.throws(()=>decodeGraphQuery({offset:-1}),/nonnegative integer/);
 assert.throws(()=>decodeGraphQuery({offset:1.5}),/nonnegative integer/);
 assert.throws(()=>decodeGraphQuery({offset:NaN}),/nonnegative integer/);
 assert.deepEqual(decodeGraphQuery({tag:'x',offset:0}),{tag:'x',offset:0});
});
