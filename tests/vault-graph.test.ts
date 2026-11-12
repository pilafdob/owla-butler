import {test} from 'node:test';import assert from 'node:assert/strict';
import {decodeGraphQuery,queryGraph,tagMatches,type GraphSource} from '../src/vault-graph';

const source:GraphSource={
 resolvedLinks:{'a.md':{'b.md':2,'private/x.md':1},'b.md':{'a.md':1},'c.md':{'b.md':1},'private/x.md':{'c.md':1}},
 unresolvedLinks:{'a.md':{'Missing note':1},'c.md':{}},
 notes:()=>['a.md','b.md','c.md','d.md','private/x.md'],
 tags:p=>({'a.md':['#project/alpha','#todo'],'b.md':['#Project'],'c.md':[]} as Record<string,string[]>)[p]??[],
 properties:p=>({'a.md':{status:'active',tags:['x']},'b.md':{Status:'Done'},'c.md':{related:['[[a]]','[[b]]']}} as Record<string,Record<string,unknown>>)[p]??null,
 allowed:p=>!p.startsWith('private/'),
};

test('a note graph lists links, backlinks, tags and properties, hiding excluded paths',()=>{
 const g=queryGraph(source,{path:'b.md'}) as ReturnType<typeof queryGraph>&{backlinks:{path:string}[];outgoing:string[]};
 assert.deepEqual(g.outgoing,['a.md']);
 assert.deepEqual(g.backlinks.map(b=>b.path),['a.md','c.md']);
 const a=queryGraph(source,{path:'a.md'}) as {outgoing:string[];unresolved:string[]};
 assert.deepEqual(a.outgoing,['b.md']);
 assert.deepEqual(a.unresolved,['Missing note']);
 assert.throws(()=>queryGraph(source,{path:'private/x.md'}));
});

test('tags match nested tags case-insensitively',()=>{
 assert.ok(tagMatches('#project/alpha','project'));
 assert.ok(!tagMatches('#projects','project'));
 assert.deepEqual((queryGraph(source,{tag:'#project'}) as {items:string[]}).items,['a.md','b.md']);
});

test('properties match by name and value, including lists and wikilinks',()=>{
 assert.deepEqual((queryGraph(source,{property:'status'}) as {items:{path:string}[]}).items.map(i=>i.path),['a.md','b.md']);
 assert.deepEqual((queryGraph(source,{property:'status',value:'done'}) as {items:{path:string}[]}).items.map(i=>i.path),['b.md']);
 assert.deepEqual((queryGraph(source,{property:'related',value:'a'}) as {items:{path:string}[]}).items.map(i=>i.path),['c.md']);
});

test('reports find broken links, orphans and tag counts without excluded notes',()=>{
 assert.deepEqual((queryGraph(source,{report:'unresolved'}) as {items:unknown[]}).items,[{from:'a.md',link:'Missing note'}]);
 // c.md is linked only from an excluded note, so it counts as an orphan; d.md has no links.
 assert.deepEqual((queryGraph(source,{report:'orphans'}) as {items:string[]}).items,['c.md','d.md']);
 assert.deepEqual((queryGraph(source,{report:'tags'}) as {items:unknown[]}).items,[{tag:'project',count:1},{tag:'project/alpha',count:1},{tag:'todo',count:1}]);
});

test('queries are validated',()=>{
 assert.throws(()=>decodeGraphQuery({report:'all'}));
 assert.throws(()=>decodeGraphQuery({path:3}));
 assert.throws(()=>queryGraph(source,{}));
 assert.deepEqual(decodeGraphQuery({tag:'x',offset:100}),{tag:'x',offset:100});
});
