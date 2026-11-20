// Windows hardening (round 2): query_vault_graph results stay bounded under
// long Windows paths, huge tags and anchor-expanded frontmatter; case-fold
// aliases resolve to the vault's exact spelling instead of an empty graph.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeGraphQuery,noteGraph,queryGraph,type GraphSource} from '../src/vault-graph';

const LIMIT=60_000;
const empty={resolvedLinks:{},unresolvedLinks:{},notes:()=>[] as string[],tags:()=>[] as string[],properties:()=>null,allowed:()=>true};

test('noteGraph stays under 60 KB with 300-character Windows paths',()=>{
 const segment='Very Long Folder Name '.repeat(14); // ~300 chars per path
 const many:Record<string,number>={};
 for(let i=0;i<300;i++)many[segment+'/note '+i+'.md']=1;
 const back:Record<string,Record<string,number>>={};
 for(let i=0;i<300;i++)back[segment+'/back '+i+'.md']={'hub.md':1};
 const source:GraphSource={...empty,resolvedLinks:{...back,'hub.md':many},unresolvedLinks:{'hub.md':many},notes:()=>['hub.md']};
 const graph=noteGraph(source,'hub.md');
 assert.ok(JSON.stringify(graph).length<=LIMIT,'result bounded');
 assert.equal(graph.outgoingCount,300);
 assert.equal(graph.unresolvedCount,300);
 assert.equal(graph.backlinkCount,300);
 assert.ok(graph.outgoing.length>0&&graph.outgoing.length<=100);
});

test('noteGraph bounds huge tag strings',()=>{
 const source:GraphSource={...empty,notes:()=>['hub.md'],tags:()=>Array.from({length:200},(_,i)=>'t'.repeat(3000)+i)};
 const graph=noteGraph(source,'hub.md');
 assert.ok(JSON.stringify(graph).length<=LIMIT);
 assert.ok(graph.tags.every(tag=>tag.length<=520));
});

test('anchor-expanded frontmatter cannot balloon or exhaust the result',()=>{
 // YAML anchors produce shared references: cheap to hold, exponential to walk.
 // The round-1 caps alone still emitted ~65 MB for this shape; the shared
 // budget must bound it. Depth 9 also exceeds the old depth cap.
 let node:unknown='x'.repeat(500);
 for(let d=0;d<9;d++)node={a:Array.from({length:20},()=>node),b:Array.from({length:20},()=>node)};
 const source:GraphSource={...empty,notes:()=>['hub.md'],properties:()=>({p:node})};
 const graph=noteGraph(source,'hub.md');
 assert.ok(JSON.stringify(graph).length<=LIMIT);
});

test('a property query with 150 huge values stays bounded and matches raw values',()=>{
 const notes=Array.from({length:150},(_,i)=>'n'+i+'.md');
 const source:GraphSource={...empty,notes:()=>notes,properties:()=>({blob:'y'.repeat(5000)})};
 const all=queryGraph(source,{property:'blob'}) as {items:{path:string;value:unknown}[];total:number};
 assert.equal(all.total,150);
 assert.ok(JSON.stringify(all).length<=LIMIT);
 const exact=queryGraph(source,{property:'blob',value:'y'.repeat(5000)}) as {total:number};
 assert.equal(exact.total,150,'matching still runs on the raw value');
 const page2=queryGraph(source,{property:'blob',offset:100}) as {items:{path:string}[];nextOffset?:number};
 assert.equal(page2.items.length,50);
 assert.ok(page2.items.every(item=>notes.includes(item.path)));
 assert.equal(page2.nextOffset,undefined);
});

test('unresolved and orphans reports stay bounded with long links and paths',()=>{
 const long='x'.repeat(400);
 const links=Object.fromEntries(Array.from({length:300},(_,i)=>[long+i,1]));
 const source:GraphSource={...empty,notes:()=>['hub.md'],unresolvedLinks:{'hub.md':links}};
 const report=queryGraph(source,{report:'unresolved'}) as {items:{link:string}[];total:number};
 assert.equal(report.total,300);
 assert.ok(JSON.stringify(report).length<=LIMIT);
 const segment='Folder '.repeat(50);
 const orphans:GraphSource={...empty,notes:()=>Array.from({length:300},(_,i)=>segment+'/n'+i+'.md')};
 const orphanReport=queryGraph(orphans,{report:'orphans'}) as {items:string[];total:number};
 assert.equal(orphanReport.total,300);
 assert.ok(JSON.stringify(orphanReport).length<=LIMIT);
});

test('huge query echoes are truncated, not mirrored into the result',()=>{
 const source:GraphSource={...empty,notes:()=>['a.md'],properties:()=>({status:'done'})};
 const result=queryGraph(source,{property:'status',value:'v'.repeat(50_000)}) as {value:string};
 assert.ok(result.value.length<=520);
 assert.ok(JSON.stringify(result).length<=LIMIT);
});

test('noteGraph resolves a case-fold alias to the exact vault spelling',()=>{
 const source:GraphSource={
  ...empty,
  resolvedLinks:{'Notes/A.md':{'Notes/B.md':1},'Other/C.md':{'Notes/A.md':2}},
  unresolvedLinks:{'Notes/A.md':{'Missing Note':1}},
  notes:()=>['Notes/A.md','Notes/B.md','Other/C.md'],
  tags:path=>path==='Notes/A.md'?['#project']:[] as string[],
  properties:path=>path==='Notes/A.md'?{status:'done'}:null,
 };
 const graph=noteGraph(source,'notes/a.md');
 assert.equal(graph.path,'Notes/A.md');
 assert.deepEqual(graph.outgoing,['Notes/B.md']);
 assert.deepEqual(graph.unresolved,['Missing Note']);
 assert.deepEqual(graph.backlinks,[{path:'Other/C.md',count:2}]);
 assert.deepEqual(graph.tags,['#project']);
 assert.deepEqual(graph.properties,{status:'done'});
});

test('noteGraph folds Unicode aliases the way the filesystem does',()=>{
 const source:GraphSource={...empty,resolvedLinks:{'Straße/A.md':{'Ziel/B.md':1}},notes:()=>['Straße/A.md','Ziel/B.md']};
 assert.equal(noteGraph(source,'STRAẞE/a.md').path,'Straße/A.md');
 assert.deepEqual(noteGraph(source,'strasse/a.md').outgoing,['Ziel/B.md']);
});

test('a case-sensitive allowed() still refuses aliases (POSIX preserved)',()=>{
 const exact=new Set(['Notes/A.md']);
 const source:GraphSource={...empty,resolvedLinks:{'Notes/A.md':{}},notes:()=>['Notes/A.md'],allowed:path=>exact.has(path)};
 assert.throws(()=>noteGraph(source,'notes/a.md'),/allowed Markdown note/);
 assert.equal(noteGraph(source,'Notes/A.md').path,'Notes/A.md');
});

test('exact paths skip the alias scan and small graphs keep their shape',()=>{
 let scanned=0;
 const source:GraphSource={
  ...empty,
  resolvedLinks:{'hub.md':{'a.md':1,'b.md':1}},
  notes:()=>{scanned++;return ['hub.md','a.md','b.md'];},
 };
 const graph=noteGraph(source,'hub.md');
 assert.equal(scanned,0,'no fold scan when the cache key exists');
 assert.deepEqual(graph.outgoing,['a.md','b.md']);
 assert.equal(graph.outgoingCount,2);
 assert.equal(graph.backlinkCount,0);
 assert.deepEqual(graph.backlinks,[]);
 assert.equal(graph.properties&&Object.keys(graph.properties).length,0);
});

test('offset validation holds for Windows-path queries (round-1 guard)',()=>{
 assert.throws(()=>decodeGraphQuery({path:'Notes\\A.md',offset:-1}),/nonnegative integer/);
 assert.throws(()=>decodeGraphQuery({offset:1.5}),/nonnegative integer/);
 assert.throws(()=>decodeGraphQuery({offset:NaN}),/nonnegative integer/);
 assert.throws(()=>decodeGraphQuery({offset:Infinity}),/nonnegative integer/);
 assert.deepEqual(decodeGraphQuery({path:'Notes/A.md',offset:0}),{path:'Notes/A.md',offset:0});
 const source:GraphSource={...empty,notes:()=>Array.from({length:150},(_,i)=>'n'+i+'.md'),tags:()=>['#x']};
 const page=queryGraph(source,{tag:'x',offset:100}) as {items:string[];nextOffset?:number};
 assert.equal(page.items.length,50);
 assert.equal(page.nextOffset,undefined);
});
