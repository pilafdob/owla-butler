// RC hardening: Excalidraw parse/summary tolerate damage; sizes, text and operations are bounded.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExcalidraw,summarizeExcalidraw,applyExcalidrawOperations,EXCALIDRAW_TEXT_LIMIT,EXCALIDRAW_OPERATIONS_LIMIT,type ElementFactory,type ExcalidrawElement} from '../src/excalidraw';

const base=(over:Partial<ExcalidrawElement>):ExcalidrawElement=>({id:'x',type:'rectangle',x:0,y:0,width:10,height:10,version:1,...over});
const scene={type:'excalidraw',version:2,elements:[] as ExcalidrawElement[]};
const json=(elements:unknown[])=>JSON.stringify({type:'excalidraw',version:2,elements});

function fakeFactory():ElementFactory{
 let elements:ExcalidrawElement[]=[];let n=0;
 const add=(element:ExcalidrawElement)=>{elements.push(element);return element.id;};
 return {
  load:list=>{elements=list;},
  shape:(kind,x,y,width,height,style,text)=>{const id='new'+(++n);add(base({id,type:kind,x,y,width,height,...style}));if(text){const t='new'+(++n);add(base({id:t,type:'text',x,y,width,height:25,text,originalText:text,containerId:id}));elements.find(e=>e.id===id)!.boundElements=[{id:t,type:'text'}];}return id;},
  text:(x,y,text,style)=>add(base({id:'new'+(++n),type:'text',x,y,width:text.length*8,height:25,text,originalText:text,...style})),
  connect:(from,to,style,label)=>{const id='new'+(++n);add(base({id,type:'arrow',startBinding:{elementId:from},endBinding:{elementId:to},...style}));if(label)add(base({id:'new'+(++n),type:'text',text:label,originalText:label,containerId:id}));return id;},
  frame:(x,y,width,height,name)=>add(base({id:'new'+(++n),type:'frame',x,y,width,height,name})),
  measure:text=>({width:text.length*8,height:25}),
  elements:()=>elements,
 };
}

test('excalidraw: a non-object element is an actionable parse error, not a crash',()=>{
 assert.throws(()=>parseExcalidraw(json([null])),/not an object/);
 assert.throws(()=>parseExcalidraw(json([{id:'a',type:'rectangle',x:0,y:0,width:1,height:1},null])),/not an object/);
});

test('excalidraw: malformed boundElements and groupIds summarise without crashing',()=>{
 const file=parseExcalidraw(json([{id:'a',type:'rectangle',x:0,y:0,width:10,height:10,boundElements:'oops',groupIds:'bad'}]));
 assert.match(summarizeExcalidraw(file),/rectangle \[a\]/);
});

test('excalidraw: move and delete tolerate malformed boundElements',()=>{
 const parsed=parseExcalidraw(json([{id:'a',type:'rectangle',x:0,y:0,width:10,height:10,boundElements:'oops'}]));
 const moved=applyExcalidrawOperations(parsed.scene,[{op:'move',id:'a',dx:5}],fakeFactory());
 assert.equal(moved.elements.find(e=>e.id==='a')!.x,5);
 const deleted=applyExcalidrawOperations(parsed.scene,[{op:'delete',id:'a'}],fakeFactory());
 assert.equal(deleted.elements.find(e=>e.id==='a')!.isDeleted,true);
});

test('excalidraw: new shapes and frames need a positive size',()=>{
 assert.throws(()=>applyExcalidrawOperations(scene,[{op:'add_shape',shape:'rectangle',x:0,y:0,width:-50,height:20}],fakeFactory()),/size must be positive/);
 assert.throws(()=>applyExcalidrawOperations(scene,[{op:'add_shape',shape:'ellipse',x:0,y:0,width:10,height:0}],fakeFactory()),/size must be positive/);
 assert.throws(()=>applyExcalidrawOperations(scene,[{op:'add_frame',x:0,y:0,width:0,height:0,name:'F',contains:[]}],fakeFactory()),/size must be positive/);
 const ok=applyExcalidrawOperations(scene,[{op:'add_shape',shape:'rectangle',x:0,y:0,width:10,height:20}],fakeFactory());
 assert.equal(ok.elements[0].width,10);
});

test('excalidraw: oversized text and operations are refused',()=>{
 assert.throws(()=>applyExcalidrawOperations(scene,[{op:'add_text',x:0,y:0,text:'x'.repeat(EXCALIDRAW_TEXT_LIMIT+1)}],fakeFactory()),/too long/);
 assert.throws(()=>applyExcalidrawOperations(scene,[{op:'add_text',x:0,y:0,text:'x'.repeat(EXCALIDRAW_OPERATIONS_LIMIT+1)}],fakeFactory()),/too large/);
 const parsed=parseExcalidraw(json([{id:'a',type:'text',x:0,y:0,width:10,height:10,text:'hi',originalText:'hi'}]));
 assert.throws(()=>applyExcalidrawOperations(parsed.scene,[{op:'update_text',id:'a',text:'x'.repeat(EXCALIDRAW_TEXT_LIMIT+1)}],fakeFactory()),/too long/);
});
