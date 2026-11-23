// 3.8.0 handoff 1: Excalidraw robustness — ink clustering, bulk delete
// operations, summary size bounds, limit messages and the read_note redirect
// that keeps compressed drawing data out of context.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {isExcalidrawText,inkClusters,summarizeExcalidraw,parseExcalidraw,applyExcalidrawOperations,revertExcalidraw,serializeExcalidraw,EXCALIDRAW_RENDER_LIMIT,excalidrawRenderLimitNotice,type ElementFactory,type ExcalidrawElement,type ExcalidrawScene} from '../src/excalidraw';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */

const stroke=(id:string,x:number,y:number,width=9,height=9):ExcalidrawElement=>({id,type:'freedraw',x,y,width,height,version:1});
const rectangle=(id:string):ExcalidrawElement=>({id,type:'rectangle',x:0,y:0,width:100,height:60,version:1});
const scene=(elements:ExcalidrawElement[]):ExcalidrawScene=>({type:'excalidraw',version:2,elements});
const sceneJson=(elements:ExcalidrawElement[])=>JSON.stringify(scene(elements));

function fakeFactory():ElementFactory{
 let elements:ExcalidrawElement[]=[];let n=0;
 const add=(element:ExcalidrawElement)=>{elements.push(element);return element.id;};
 return {
  load:list=>{elements=list;},
  shape:(kind,x,y,width,height,style,text)=>{const id='new'+(++n);add({id,type:kind,x,y,width,height,version:1,...style} as ExcalidrawElement);if(text){const t='new'+(++n);add({id:t,type:'text',x,y,width,height:25,text,originalText:text,containerId:id,version:1} as ExcalidrawElement);elements.find(e=>e.id===id)!.boundElements=[{id:t,type:'text'}];}return id;},
  text:(x,y,text,style)=>add({id:'new'+(++n),type:'text',x,y,width:text.length*8,height:25,text,originalText:text,version:1,...style} as ExcalidrawElement),
  connect:(from,to,style,label)=>{const id='new'+(++n);add({id,type:'arrow',startBinding:{elementId:from},endBinding:{elementId:to},version:1,...style} as ExcalidrawElement);if(label)add({id:'new'+(++n),type:'text',text:label,originalText:label,containerId:id,version:1} as ExcalidrawElement);return id;},
  frame:(x,y,width,height,name)=>add({id:'new'+(++n),type:'frame',x,y,width,height,name,version:1} as ExcalidrawElement),
  measure:text=>({width:text.length*8,height:25}),
  elements:()=>elements,
 };
}

// -------------------------------------------------- summary + clustering

test('ink: hundreds of strokes collapse into clusters and the summary stays small',()=>{
 const elements=[];
 for(let i=0;i<260;i++)elements.push(stroke('s'+i,-447+(i%13)*12,-270+Math.floor(i/13)*10));
 for(let i=0;i<40;i++)elements.push(stroke('f'+i,3000+i*5,2000+i*5));
 elements.push(rectangle('box1'));
 elements.push({id:'t1',type:'text',x:0,y:70,width:50,height:20,text:'Hello',originalText:'Hello',version:1});
 const summary=summarizeExcalidraw(parseExcalidraw(sceneJson(elements)));
 assert.match(summary,/302 elements/);
 // Groups larger than one 240×120 tile are split by position, so each cluster marks where its ink is.
 assert.match(summary,/ink cluster c1: \d+ strokes at \(-447,-270\) \d+×\d+/);
 assert.match(summary,/ink cluster c3: \d+ strokes at \(3000,2000\) \d+×\d+/);
 const clusters=inkClusters(parseExcalidraw(sceneJson(elements)).scene);
 assert.equal(clusters.length,4);
 assert.equal(clusters[0].count+clusters[1].count,260);
 assert.equal(clusters[2].count+clusters[3].count,40);
 for(const cluster of clusters)assert.ok(cluster.width<=240+9&&cluster.height<=120+9,cluster.cluster+' stays within one tile');
 assert.equal(new Set(clusters.flatMap(cluster=>cluster.ids)).size,300,'every stroke is in exactly one cluster');
 assert.ok(summary.length<2000,'summary is compact: '+summary.length);
 assert.match(summary,/rectangle \[box1\]/);
 assert.match(summary,/text \[t1\] .*text "Hello"/);
 assert.ok(!summary.includes('freedraw [s1]'),'cluster members are not listed individually');
});

test('ink: clustering is deterministic and cluster ids resolve to their strokes',()=>{
 const parsed=parseExcalidraw(sceneJson([...Array.from({length:274},(_,i)=>stroke('s'+i,-500+(i%30)*3,-300+Math.floor(i/30)*3,6,6)),rectangle('box1')]));
 const first=inkClusters(parsed.scene);
 const second=inkClusters(parsed.scene);
 assert.deepEqual(second,first,'the same scene always yields the same cluster names and members');
 const big=first.find(cluster=>cluster.count===274)!;
 assert.equal(big.cluster,'c1');
 for(const id of big.ids)assert.equal(parsed.scene.elements.find(e=>e.id===id)?.type,'freedraw',id+' resolves to a live stroke');
 const afterScene=applyExcalidrawOperations(parsed.scene,[{op:'delete_cluster',cluster:big.cluster}],fakeFactory());
 const deleted=afterScene.elements.filter(e=>e.isDeleted).map(e=>e.id).sort();
 assert.deepEqual(deleted,big.ids.slice().sort(),'delete_cluster removes exactly the cluster strokes');
 assert.equal(afterScene.elements.find(e=>e.id==='box1')!.isDeleted,undefined,'shapes outside the cluster survive');
});

test('ink: a 274-stroke cleanup is one delete_many operation and reverts cleanly',()=>{
 const elements=Array.from({length:274},(_,i)=>stroke('s'+i,-500+(i%30)*3,-300+Math.floor(i/30)*3,6,6));
 const before=sceneJson(elements);
 const afterScene=applyExcalidrawOperations(parseExcalidraw(before).scene,[{op:'delete_many',ids:elements.map(e=>e.id)}],fakeFactory(),()=>0.1);
 assert.equal(afterScene.elements.filter(e=>!e.isDeleted).length,0);
 const after=serializeExcalidraw(before,afterScene);
 const reverted=parseExcalidraw(revertExcalidraw(before,after,undefined,()=>0.2)).scene;
 assert.deepEqual(reverted.elements.filter(e=>!e.isDeleted).map(e=>e.id).sort(),elements.map(e=>e.id).sort(),'revert restores every stroke');
});

// -------------------------------------------------- bulk op validation

test('ink: delete_many rejects unknown ids by name and applies nothing',()=>{
 const parsed=parseExcalidraw(sceneJson([stroke('s1',0,0),stroke('s2',10,10)]));
 assert.throws(()=>applyExcalidrawOperations(parsed.scene,[{op:'delete_many',ids:['s1','nope','gone']}],fakeFactory()),/unknown ids "nope", "gone".*Nothing was deleted/);
});

test('ink: delete_cluster rejects unknown cluster names and lists the valid ones',()=>{
 const parsed=parseExcalidraw(sceneJson([stroke('s1',0,0),stroke('s2',5,5)]));
 assert.throws(()=>applyExcalidrawOperations(parsed.scene,[{op:'delete_cluster',cluster:'c9'}],fakeFactory()),/no cluster "c9"\. The scene has clusters c1/);
 assert.throws(()=>applyExcalidrawOperations(parsed.scene,[{op:'delete_cluster',cluster:''}],fakeFactory()),/give the cluster name/);
});

test('ink: cluster names stay as read across one proposal (deleting c1 does not renumber c2)',()=>{
 // Three far-apart ink groups: c1, c2, c3 in scene order.
 const parsed=parseExcalidraw(sceneJson([stroke('a1',0,0),stroke('a2',4,4),stroke('b1',2000,0),stroke('b2',2004,4),stroke('c1s',4000,0),stroke('c2s',4004,4)]));
 assert.deepEqual(inkClusters(parsed.scene).map(cluster=>cluster.ids),[['a1','a2'],['b1','b2'],['c1s','c2s']]);
 const afterScene=applyExcalidrawOperations(parsed.scene,[{op:'delete_cluster',cluster:'c1'},{op:'delete_cluster',cluster:'c2'}],fakeFactory());
 assert.deepEqual(afterScene.elements.filter(e=>e.isDeleted).map(e=>e.id).sort(),['a1','a2','b1','b2'],'c2 is the second group the model read, not the third');
});

test('ink: propose_excalidraw tool schema exposes delete_many and delete_cluster',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(join(__dirname,'..','src','main.ts'),'utf8');
 const spec=source.split('\n').find(line=>line.includes("name:'propose_excalidraw'"))??'';
 assert.match(spec,/enum:\[[^\]]*'delete_many','delete_cluster'\]/);
 assert.match(spec,/ids:\{type:'array',items:\{type:'string'\}\}/);
 assert.match(spec,/cluster:\{type:'string'\}/);
 assert.match(spec,/delete_many \{ids\}/);
});

// -------------------------------------------------- hard limits

test('ink: op-count and byte limits name the bulk alternatives',()=>{
 const parsed=parseExcalidraw(sceneJson([stroke('s1',0,0)]));
 const many=Array.from({length:201},(_,i)=>({op:'delete',id:'s'+(i+1)}));
 try{applyExcalidrawOperations(parsed.scene,many,fakeFactory());assert.fail('201 operations must be refused');}
 catch(error){const message=String(error);assert.match(message,/between 1 and 200/);assert.match(message,/delete_many/);assert.match(message,/delete_cluster/);}
 const unknownOp=()=>applyExcalidrawOperations(parsed.scene,[{op:'paint'}],fakeFactory());
 assert.throws(unknownOp,/unknown op "paint".*delete_many or delete_cluster/);
});

test('ink: a scene over the render limit names itself and the alternative',()=>{
 const huge=Array.from({length:EXCALIDRAW_RENDER_LIMIT+1},(_,i)=>({id:'r'+i,type:'rectangle',x:i,y:0,width:10,height:10,version:1}));
 const over=excalidrawRenderLimitNotice(scene(huge));
 assert.match(over,/too large to render visually \(1501 live elements; the limit is 1500\)/);
 assert.match(over,/delete_cluster/);
 assert.equal(excalidrawRenderLimitNotice(scene([])),'');
});

// -------------------------------------------------- read_note never leaks scene data

let Butler:any,ButlerView:any,obsidian:any;
let scratch:string;

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-excalidraw-ink-'));
 (globalThis as any).window??=new EventTarget();
});

function makeView(texts:Record<string,string>,names:string[]){
 const vault=join(scratch,'Vault');
 mkdirSync(vault,{recursive:true});
 for(const [path,content] of Object.entries(texts)){
  const dir=join(vault,path.split('/').slice(0,-1).join('/'));
  if(dir)mkdirSync(dir,{recursive:true});
  writeFileSync(join(vault,path),content);
 }
 const files=Object.entries(texts).map(([path,content])=>{const f=new obsidian.TFile(path);f.stat={size:Buffer.byteLength(content)};return f;});
 const fileMap=new Map(files.map(f=>[f.path,f]));
 const workspace={getLeavesOfType:(type:string)=>(type==='markdown'?[]:[]),getActiveFile:()=>null};
 const app={
  vault:{
   adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>[...fileMap.values()].filter(f=>f.path.endsWith('.md')),
   getFileByPath:(p:string)=>fileMap.get(p)??null,
   getAbstractFileByPath:(p:string)=>fileMap.get(p)??null,
   getFolderByPath:()=>null,
   cachedRead:async(f:any)=>texts[f.path]??'',read:async(f:any)=>texts[f.path]??'',
  },
  workspace,
  metadataCache:{getFileCache:()=>({})},
 };
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage')});
 const view=new ButlerView({app},butler);
 view.offeredToolNames=new Set(names);
 return view;
}

const drawingMd='---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n\n## Text Elements\n%%\n## Drawing\n```compressed-json\nBLOB_SENTINEL_9281_never_reach_context\n```\n%%';
const log={createDiv:()=>({})};

test('read_note: a drawing file redirects to read_excalidraw at any offset, heading or block',async()=>{
 const view=makeView({'Notes/Drawing.md':drawingMd},['read_note']);
 for(const args of [{path:'Notes/Drawing.md'},{path:'Notes/Drawing.md',offset:120000},{path:'Notes/Drawing.md',heading:'Excalidraw Data'},{path:'Notes/Drawing.md',block:'^abc123'}]){
  const result=await view.tool('read_note',args,log,new Map());
  assert.equal(typeof result,'string','read_note('+JSON.stringify(args)+') answers as text');
  const text=String(result);
  assert.ok(!text.includes('BLOB_SENTINEL_9281_never_reach_context'),'no compressed scene data in the reply');
  assert.ok(!text.includes('compressed-json'),'no drawing block in the reply');
  assert.match(text,/read_excalidraw/);
  assert.match(text,/visual=true/);
  assert.match(text,/propose_excalidraw/);
 }
});

test('read_note: a plain note still reads normally',async()=>{
 const view=makeView({'Notes/Plain.md':'alpha\nbeta'},['read_note']);
 const result=String(await view.tool('read_note',{path:'Notes/Plain.md'},log,new Map()));
 assert.match(result,/alpha/);
 assert.doesNotMatch(result,/read_excalidraw/);
});

test('read_excalidraw: a scene over the render limit stays text-only and says why',async()=>{
 const huge=Array.from({length:EXCALIDRAW_RENDER_LIMIT+1},(_,i)=>({id:'r'+i,type:'rectangle',x:i,y:0,width:10,height:10,version:1}));
 const view=makeView({'Notes/Big.md':sceneJson(huge)},['read_excalidraw']);
 const result=String(await view.tool('read_excalidraw',{path:'Notes/Big.md',visual:true},log,new Map()));
 assert.match(result,/too large to render visually/);
 assert.match(result,/delete_cluster/);
 assert.ok(!result.includes('Rendered'),'no render was attempted');
});

test('search_vault: a drawing among the top matches yields a redirect, not its data',async()=>{
 const view=makeView({'Notes/Drawing.md':drawingMd,'Notes/One.md':'the story of excalidraw'},['search_vault']);
 const result=JSON.parse(String(await view.tool('search_vault',{query:'excalidraw-plugin'},log,new Map())));
 const source=result.sources.find((s:any)=>s.path==='Notes/Drawing.md');
 assert.ok(source,'the drawing was among the auto-read top matches');
 assert.ok(!source.content.includes('BLOB_SENTINEL_9281_never_reach_context'));
 assert.match(source.content,/is an Excalidraw drawing/);
});

test('ink: delete_cluster "all" removes every stroke in one operation and leaves shapes',()=>{
 const elements=[...Array.from({length:300},(_,i)=>stroke('s'+i,(i%20)*30,Math.floor(i/20)*25)),rectangle('box1')];
 const before=sceneJson(elements),parsed=parseExcalidraw(before);
 assert.ok(inkClusters(parsed.scene).length>1,'a large drawing is split into several clusters');
 const after=applyExcalidrawOperations(parsed.scene,[{op:'delete_cluster',cluster:'all'}],fakeFactory(),()=>0.1);
 assert.equal(after.elements.filter(e=>e.type==='freedraw'&&!e.isDeleted).length,0);
 assert.equal(after.elements.find(e=>e.id==='box1')?.isDeleted,undefined);
 const reverted=parseExcalidraw(revertExcalidraw(before,serializeExcalidraw(before,after),undefined,()=>0.2)).scene;
 assert.equal(reverted.elements.filter(e=>!e.isDeleted).length,301,'revert restores every stroke');
});

test('ink: a plain note that only mentions excalidraw-plugin is not a drawing',()=>{
 assert.equal(isExcalidrawText('# Notes on Excalidraw\n\nSome text.\n\n---\n\nTo make a drawing, set `excalidraw-plugin: parsed` in frontmatter.\n'),false);
 assert.equal(isExcalidrawText('---\ntags: [howto]\n---\n# Setup\n\n```yaml\nexcalidraw-plugin: parsed\n```\n'),false);
 assert.equal(isExcalidrawText('---\nexcalidraw-plugin: parsed\n---\n# Text Elements\n'),true);
 assert.equal(isExcalidrawText('\uFEFF---\r\nexcalidraw-plugin: parsed\r\n---\r\n'),true);
});
