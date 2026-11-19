// RC hardening: canvas summary tolerates damaged files; operations payload is bounded.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCanvas,summarizeCanvas,serializeCanvas,applyCanvasOperations,CANVAS_OPERATIONS_LIMIT} from '../src/canvas';

test('canvas: a damaged canvas summarises invalid entries instead of crashing',()=>{
 const summary=summarizeCanvas(parseCanvas('{"nodes":[null,{"id":"a","type":"text","text":"hi","x":0,"y":0,"width":1,"height":1}],"edges":[null]}'));
 assert.match(summary,/invalid node #0 \(not an object\)/);
 assert.match(summary,/invalid edge #0 \(not an object\)/);
 assert.match(summary,/\[a\] text/,'valid nodes are still described');
});

test('canvas: a valid canvas summary is unchanged by the defensive guards',()=>{
 const text=JSON.stringify({nodes:[{id:'a',type:'text',text:'Idea',x:0,y:0,width:10,height:10}],edges:[]},null,'\t');
 assert.match(summarizeCanvas(parseCanvas(text)),/- \[a\] text at \(0,0\) 10×10/);
});

test('canvas: an oversized operations payload is refused',()=>{
 assert.throws(()=>applyCanvasOperations(parseCanvas(''),[{op:'add_node',node:{type:'text',text:'x'.repeat(CANVAS_OPERATIONS_LIMIT+1),x:0,y:0,width:1,height:1}}]),/too large/);
});

// Obsidian's canonical canvas format, as written by the app (compact node objects).
const obsidianCanvas=`{
\t"nodes":[
\t\t{"id":"a","type":"file","file":"Notes/Plan.md","x":-400,"y":-320,"width":400,"height":1640,"color":"5"},
\t\t{"id":"b","type":"text","text":"Idea","x":0,"y":0,"width":260,"height":140}
\t],
\t"edges":[
\t\t{"id":"e","fromNode":"a","fromSide":"right","toNode":"b","toSide":"left"}
\t]
}`;

test('canvas: an untouched Obsidian-format file round-trips byte-identically',()=>{
 assert.equal(serializeCanvas(parseCanvas(obsidianCanvas),obsidianCanvas),obsidianCanvas);
});

test('canvas: a one-card change keeps every other line intact',()=>{
 const next=applyCanvasOperations(parseCanvas(obsidianCanvas),[{op:'update_node',id:'b',changes:{text:'New idea'}}]);
 const written=serializeCanvas(next,obsidianCanvas);
 const before=obsidianCanvas.split('\n'),after=written.split('\n');
 assert.equal(before.length,after.length,'no reformatting: same line count');
 const changed=after.filter((line,i)=>line!==before[i]);
 assert.equal(changed.length,1,'only the edited card line differs');
 assert.match(changed[0],/"text":"New idea"/);
});

test('canvas: a source ending in a newline keeps it; an empty canvas serialises canonically',()=>{
 assert.equal(serializeCanvas(parseCanvas(obsidianCanvas),obsidianCanvas+'\n'),obsidianCanvas+'\n');
 assert.equal(serializeCanvas(parseCanvas('')),'{\n\t"nodes":[],\n\t"edges":[]\n}');
});
