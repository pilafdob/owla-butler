// Canvas, Bases and Excalidraw file handling (3.5.0): parsing, validation,
// summaries, reviewed operations and serialisation. The Obsidian engines
// (canvas screenshot, Bases validation, Excalidraw export) are verified live.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCanvasOperations,canvasProblems,parseCanvas,serializeCanvas,summarizeCanvas} from '../src/canvas';
import {baseProblems,baseReferences,parseBase,summarizeBase} from '../src/bases';
import {applyExcalidrawOperations,revertExcalidraw,isExcalidrawText,newExcalidrawFile,parseExcalidraw,readableExcalidraw,serializeExcalidraw,summarizeExcalidraw,type ElementFactory,type ExcalidrawElement} from '../src/excalidraw';

const canvasText=JSON.stringify({nodes:[
 {id:'g1',type:'group',label:'Trip',x:-40,y:-60,width:800,height:360},
 {id:'a1',type:'text',text:'# Idea\nPlan',x:0,y:0,width:260,height:140,color:'4'},
 {id:'b2',type:'file',file:'Notes/Plan.md',x:400,y:0,width:320,height:240},
],edges:[{id:'e1',fromNode:'a1',fromSide:'right',toNode:'b2',toSide:'left',label:'links to'}]},null,'\t');

test('canvas: a valid canvas parses, summarises with groups and edges, and round-trips its formatting',()=>{
 const data=parseCanvas(canvasText);
 assert.deepEqual(canvasProblems(data),[]);
 const summary=summarizeCanvas(data);
 assert.match(summary,/\[a1\] text at \(0,0\) 260×140 color 4 in group g1/);
 assert.match(summary,/edge \[e1\] a1\.right → b2\.left \("# Idea" → Notes\/Plan\.md\) label "links to"/);
 assert.equal(serializeCanvas(data,canvasText),canvasText);
 assert.deepEqual(parseCanvas(''),{nodes:[],edges:[]});
 assert.throws(()=>parseCanvas('{nodes:'),/not valid JSON/);
});

test('canvas: operations add, update and remove; removing a node removes its edges; invalid results are refused',()=>{
 let n=0;const random=()=>((n=(n*1103515245+12345)%2147483648)/2147483648);
 const next=applyCanvasOperations(parseCanvas(canvasText),[
  {op:'add_node',node:{type:'text',text:'Budget',x:0,y:200,width:200,height:80}},
  {op:'update_node',id:'a1',changes:{text:'# Idea\nPlan the trip',color:null}},
  {op:'add_edge',edge:{fromNode:'a1',toNode:'b2',toEnd:'none'}},
 ],random);
 const added=next.nodes.find(node=>node.text==='Budget')!;
 assert.match(added.id,/^[0-9a-f]{16}$/);
 assert.equal(next.nodes.find(node=>node.id==='a1')!.color,undefined);
 assert.equal(next.edges.length,2);
 const removed=applyCanvasOperations(next,[{op:'remove_node',id:'b2'}]);
 assert.equal(removed.edges.length,0);
 assert.throws(()=>applyCanvasOperations(next,[{op:'add_edge',edge:{fromNode:'a1',toNode:'zzz'}}]),/missing node "zzz"/);
 assert.throws(()=>applyCanvasOperations(next,[{op:'add_node',node:{type:'link',url:'javascript:x',x:0,y:0,width:1,height:1}}]),/http\(s\) url/);
 assert.throws(()=>applyCanvasOperations(next,[{op:'update_node',id:'a1',changes:{id:'x'}}]),/id cannot be changed/);
 assert.throws(()=>applyCanvasOperations(next,[{op:'paint'}]),/unknown op/);
 assert.throws(()=>applyCanvasOperations(next,[]),/between 1 and 200/);
});

const yaml=(text:string)=>{
 // A tiny YAML stand-in for the shapes used here; the plugin uses Obsidian's parseYaml.
 return JSON.parse(text);
};

test('bases: structure checks, references and summary',()=>{
 const good={filters:{and:['file.inFolder("Notes")','note.status != "done"']},formulas:{words:'file.size / 5'},views:[{type:'table',name:'Open',order:['file.name','status','formula.words'],limit:20}]};
 const data=parseBase(JSON.stringify(good),yaml);
 assert.deepEqual(baseProblems(data),[]);
 assert.deepEqual(baseReferences(data),['file.inFolder','file.name','file.size','formula.words','note.status']);
 assert.match(summarizeBase(data),/View "Open" \(table\) columns file.name, status, formula.words limit 20/);
 const bad=parseBase(JSON.stringify({filter:'x',filters:{and:[]},formulas:{w:''},views:[{name:'No type'},{type:'table',name:'T',limit:0,order:'name'}]}),yaml);
 const problems=baseProblems(bad).join('\n');
 for(const expected of ['unknown top-level key "filter"','filters.and must be a non-empty list','formulas.w must be an expression','views[0] needs a type','views[1].order must be a list','views[1].limit must be a positive integer'])assert.ok(problems.includes(expected),expected);
 assert.throws(()=>parseBase('[1,2]',yaml),/YAML mapping/);
 assert.deepEqual(parseBase('',yaml),{});
});

// ---------------------------------------------------------------- Excalidraw

const base=(over:Partial<ExcalidrawElement>):ExcalidrawElement=>({id:'x',type:'rectangle',x:0,y:0,width:10,height:10,version:1,...over});
const scene={type:'excalidraw',version:2,source:'test',elements:[
 base({id:'box1',type:'rectangle',x:100,y:100,width:200,height:80,boundElements:[{id:'txt1',type:'text'},{id:'arr1',type:'arrow'}]}),
 base({id:'txt1',type:'text',x:110,y:120,width:180,height:25,text:'Start',originalText:'Start',containerId:'box1'}),
 base({id:'box2',type:'ellipse',x:500,y:100,width:160,height:80,boundElements:[{id:'arr1',type:'arrow'}]}),
 base({id:'arr1',type:'arrow',x:300,y:140,width:200,height:0,startBinding:{elementId:'box1'},endBinding:{elementId:'box2'}}),
 base({id:'note1',type:'text',x:100,y:300,width:120,height:25,text:'Loose note',originalText:'Loose note'}),
],appState:{viewBackgroundColor:'#ffffff'},files:{}};
const fileText=(drawing:object)=>'---\n\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n\n---\n==⚠  Switch to EXCALIDRAW VIEW ⚠==\n\n\n# Excalidraw Data\n\n## Text Elements\nStart ^txt1\n\nLoose note ^note1\n\n## Element Links\nbox2: [[Notes/Plan]]\n\n%%\n## Drawing\n```json\n'+JSON.stringify(drawing,null,'\t')+'\n```\n%%';

/** A stand-in for ExcalidrawAutomate: plain elements with sequential ids. */
function fakeFactory():ElementFactory{
 let elements:ExcalidrawElement[]=[];let n=0;
 const add=(element:ExcalidrawElement)=>{elements.push(element);return element.id;};
 return {
  load:list=>{elements=list;},
  shape:(kind,x,y,width,height,style,text)=>{const id='new'+(++n);add(base({id,type:kind,x,y,width,height,...style}));if(text){const t='new'+(++n);add(base({id:t,type:'text',x,y,width,height:25,text,originalText:text,containerId:id}));elements.find(e=>e.id===id)!.boundElements=[{id:t,type:'text'}];}return id;},
  text:(x,y,text,style)=>add(base({id:'new'+(++n),type:'text',x,y,width:text.length*8,height:25,text,originalText:text,...style})),
  connect:(from,to,style,label)=>{const id='new'+(++n);add(base({id,type:'arrow',startBinding:{elementId:from},endBinding:{elementId:to},...style}));if(label)add(base({id:'new'+(++n),type:'text',text:label,originalText:label,containerId:id}));return id;},
  frame:(x,y,width,height,name,contains)=>{const id='new'+(++n);add(base({id,type:'frame',x,y,width,height,name}));for(const item of elements)if(contains.includes(item.id))item.frameId=id;return id;},
  measure:text=>({width:text.length*8,height:25}),
  elements:()=>elements,
 };
}

test('excalidraw: parses plain and compressed drawings and summarises shapes, text and connections',()=>{
 const text=fileText(scene);
 assert.ok(isExcalidrawText(text));
 const file=parseExcalidraw(text);
 const summary=summarizeExcalidraw(file);
 assert.match(summary,/5 elements \(2 rectangle|5 elements \(1 rectangle/);
 assert.match(summary,/rectangle \[box1\] at \(100,100\) 200×80 · text "Start"/);
 assert.match(summary,/arrow \[arr1\].*from \[box1\] "Start" to \[box2\]/);
 assert.ok(!/text \[txt1\]/.test(summary),'bound text is listed with its shape');
 const compressed=text.replace(/```json\n[\s\S]*?\n```/,'```compressed-json\nAB\nCD\n```');
 assert.throws(()=>parseExcalidraw(compressed),/plugin is needed/);
 assert.equal(parseExcalidraw(compressed,data=>data==='ABCD'?JSON.stringify(scene):'').scene.elements.length,5);
 assert.throws(()=>parseExcalidraw('# plain note'),/no Excalidraw drawing block/);
});

test('excalidraw: operations edit, add and delete, and the file keeps its other sections',()=>{
 const file=parseExcalidraw(fileText(scene));
 const next=applyExcalidrawOperations(file.scene,[
  {op:'update_text',id:'box1',text:'Begin'},
  {op:'move',id:'box1',dx:10,dy:-5},
  {op:'add_shape',shape:'diamond',x:500,y:300,width:120,height:120,text:'Decide',style:{strokeColor:'#e03131',bogus:1}},
  {op:'add_arrow',from:'box2',to:'new1',label:'then'},
  {op:'set_style',id:'note1',style:{strokeColor:'#1971c2'}},
  {op:'delete',id:'box2'},
 ],fakeFactory());
 const get=(id:string)=>next.elements.find(e=>e.id===id)!;
 assert.equal(get('txt1').text,'Begin');assert.equal(get('txt1').originalText,'Begin');
 assert.equal(get('box1').x,110);assert.equal(get('txt1').x,120,'bound text moves with its shape');
 assert.equal(get('new1').strokeColor,'#e03131');assert.equal(get('new1').bogus,undefined);
 assert.equal(get('box2').isDeleted,true);
 assert.equal(get('arr1').endBinding,null,'arrows lose their binding to a deleted shape');
 assert.ok((get('txt1').version??0)>=101,'a changed element outranks an open editor\'s copy');
 const written=serializeExcalidraw(file.text,next);
 assert.match(written,/## Text Elements\nBegin \^txt1\n\nLoose note \^note1\n/);
 assert.ok(written.includes('## Element Links\nbox2: [[Notes/Plan]]'),'other sections are kept');
 assert.match(written,/## Drawing\n```json\n\{/);
 assert.equal(parseExcalidraw(written).scene.elements.length,next.elements.length);
 assert.throws(()=>applyExcalidrawOperations(file.scene,[{op:'update_text',id:'arr1',text:'x'}],fakeFactory()),/has no text/);
 assert.throws(()=>applyExcalidrawOperations(file.scene,[{op:'add_shape',shape:'star',x:0,y:0,width:1,height:1}],fakeFactory()),/rectangle, ellipse or diamond/);
 assert.throws(()=>applyExcalidrawOperations(file.scene,[{op:'move',id:'ghost',dx:1}],fakeFactory()),/no element "ghost"/);
});

test('excalidraw: a new drawing file is valid, and the readable form lists elements for review',()=>{
 const empty=newExcalidrawFile();
 assert.equal(parseExcalidraw(empty).scene.elements.length,0);
 const created=serializeExcalidraw(empty,applyExcalidrawOperations(parseExcalidraw(empty).scene,[{op:'add_text',x:0,y:0,text:'Hello'}],fakeFactory()));
 assert.match(created,/## Text Elements\nHello \^new1\n/);
 const readable=readableExcalidraw(fileText(scene));
 assert.match(readable,/## Drawing \(elements\)\n- rectangle \[box1\]/);
 assert.ok(!readable.includes('"versionNonce"')&&!readable.includes('```json'));
 assert.equal(readableExcalidraw('# plain'),'# plain');
});

test('canvas: ids stay unique even with a constant random source',()=>{
 const next=applyCanvasOperations(parseCanvas(canvasText),[1,2,3].map(i=>({op:'add_node',node:{type:'text',text:'n'+i,x:0,y:0,width:1,height:1}})),()=>0);
 assert.equal(new Set(next.nodes.map(node=>node.id)).size,next.nodes.length);
});

test('canvas: an id given on the operation names the new node, so later operations can use it',()=>{
 const next=applyCanvasOperations(parseCanvas(canvasText),[{op:'add_node',id:'bud1',node:{type:'text',text:'Budget',x:0,y:180,width:260,height:120}},{op:'add_edge',id:'e2',edge:{fromNode:'a1',toNode:'bud1',label:'costs'}}]);
 assert.ok(next.nodes.some(node=>node.id==='bud1'));
 assert.equal(next.edges.find(edge=>edge.id==='e2')?.toNode,'bud1');
 assert.throws(()=>applyCanvasOperations(next,[{op:'add_node',id:'bud1',node:{type:'text',text:'x',x:0,y:0,width:1,height:1}}]),/already exists/);
});

test('excalidraw: a revert restores the original with versions above the proposal, deleting what it added',()=>{
 const before=fileText(scene);
 const after=serializeExcalidraw(before,applyExcalidrawOperations(parseExcalidraw(before).scene,[{op:'update_text',id:'box1',text:'Kickoff'},{op:'add_text',x:0,y:400,text:'Extra'}],fakeFactory()));
 const reverted=parseExcalidraw(revertExcalidraw(before,after)).scene;
 const proposed=parseExcalidraw(after).scene;
 const get=(list:ExcalidrawElement[],id:string)=>list.find(e=>e.id===id)!;
 assert.equal(get(reverted.elements,'txt1').text,'Start');
 assert.ok(get(reverted.elements,'txt1').version!>get(proposed.elements,'txt1').version!);
 const extra=proposed.elements.find(e=>e.text==='Extra')!;
 assert.equal(get(reverted.elements,extra.id).isDeleted,true);
 assert.ok(get(reverted.elements,extra.id).version!>extra.version!);
 assert.match(revertExcalidraw(before,after),/## Text Elements\nStart \^txt1\n\nLoose note \^note1\n/);
});
