// Windows hardening (round 2): CRLF notes and canvases keep their bytes.
// findBlock paragraph ranges, tableAt capture, updateProperties frontmatter and
// the canvas serializer must treat \r\n exactly like \n — and LF output must
// stay byte-identical to the POSIX behaviour.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findBlock,noteHeadings,tableAt,updateProperties,type Yaml} from '../src/note-tools';
import {parseCanvas,serializeCanvas} from '../src/canvas';
import {isExcalidrawText,newExcalidrawFile,parseExcalidraw,serializeExcalidraw} from '../src/excalidraw';

const yaml:Yaml={parse:text=>JSON.parse(text),stringify:value=>JSON.stringify(value)};
const crlf=(text:string)=>text.replace(/\n/g,'\r\n');

test('findBlock returns the paragraph, not the whole note, on CRLF text',()=>{
 const lf='Intro\n\nPara one ^blk\n\nPara two\n';
 const text=crlf(lf);
 const range=findBlock(text,'^blk');
 assert.ok(range);
 assert.equal(text.slice(range.start,range.end),'Para one ^blk');
 // Same paragraph as the LF note, offsets shifted by the \r characters.
 const lfRange=findBlock(lf,'^blk')!;
 assert.equal(range.start,lfRange.start+2);
 assert.equal(range.end,lfRange.end+2);
});

test('findBlock LF ranges are unchanged (POSIX regression guard)',()=>{
 const text='Intro\n\nPara one ^blk\n\nPara two\n';
 assert.deepEqual(findBlock(text,'^blk'),{start:7,end:20});
 assert.deepEqual(findBlock('Only ^x\n','^x'),{start:0,end:8});
 assert.deepEqual(findBlock('A\n\nB ^y','^y'),{start:3,end:7});
 assert.equal(findBlock(text,'^missing'),null);
});

test('findBlock handles first and last paragraphs and mixed endings',()=>{
 const text='First ^a\r\n\r\nSecond ^b\r\n\r\nThird ^c';
 assert.equal(text.slice(findBlock(text,'^a')!.start,findBlock(text,'^a')!.end),'First ^a');
 assert.equal(text.slice(findBlock(text,'^b')!.start,findBlock(text,'^b')!.end),'Second ^b');
 assert.equal(text.slice(findBlock(text,'^c')!.start,findBlock(text,'^c')!.end),'Third ^c');
 const mixed='One\r\n\nTwo ^m\n\r\nThree';
 assert.equal(mixed.slice(findBlock(mixed,'^m')!.start,findBlock(mixed,'^m')!.end),'Two ^m');
});

test('noteHeadings keeps CRLF offsets into the raw text',()=>{
 const text='# Title\r\n\r\nBody\r\n\r\n## Sub\r\nMore\r\n';
 const headings=noteHeadings(text);
 // A level-1 section runs to the next level-1 heading (here: end of note).
 assert.deepEqual(headings.map(h=>[h.title,h.start,h.end]),[['Title',0,text.length],['Sub',19,text.length]]);
 assert.equal(text.slice(headings[1].start,headings[1].end),'## Sub\r\nMore\r\n');
 assert.equal(text.slice(headings[0].start,headings[0].end),text);
});

test('tableAt captures a CRLF table raw, without a dangling half-terminator',()=>{
 const text='Intro\r\n| Name | Age |\r\n| --- | ---: |\r\n| Ana | 2 |\r\nAfter\r\n';
 const at=tableAt(text,2);
 assert.ok(at);
 assert.deepEqual({start:at.start,end:at.end},{start:1,end:3});
 assert.equal(at.text,'| Name | Age |\r\n| --- | ---: |\r\n| Ana | 2 |');
 // Every row of the table yields the same capture.
 assert.equal(tableAt(text,1)?.text,at.text);
 assert.equal(tableAt(text,3)?.text,at.text);
 assert.equal(tableAt(text,0),null);
 assert.equal(tableAt(text,4),null);
});

test('tableAt CRLF single-hyphen delimiters, one-column tables and fences',()=>{
 assert.equal(tableAt('| a | b |\r\n|-|:-:|\r\n| 1 | 2 |',2)?.start,0);
 assert.equal(tableAt('| only |\r\n| - |\r\n| x |',1)?.end,2);
 assert.equal(tableAt('| a | b |\r\n| -1 | -2 |',0),null);
 assert.equal(tableAt('```\r\n| a | b |\r\n| --- | --- |\r\n```\r\n',2),null);
 assert.equal(tableAt('~~~\r\n| a |\r\n| - |\r\n~~~\r\n| real |\r\n| --- |\r\n| row |',5)?.start,4);
});

test('tableAt LF capture is unchanged (POSIX regression guard)',()=>{
 const text='Intro\n| Name | Age |\n| --- | ---: |\n| Ana | 2 |\n| Bo | 4 |\nAfter\n';
 const table='| Name | Age |\n| --- | ---: |\n| Ana | 2 |\n| Bo | 4 |';
 assert.deepEqual(tableAt(text,1),{start:1,end:4,text:table});
 assert.equal(tableAt(text,5),null);
});

test('updateProperties keeps a CRLF frontmatter in CRLF and the body byte-identical',()=>{
 const note='---\r\n{"Status":"draft","tags":["a"]}\r\n---\r\n# Title\r\nBody\r\n';
 const result=updateProperties(note,{status:'done'},['tags'],yaml);
 assert.equal(result.text,'---\r\n{"Status":"done"}\r\n---\r\n# Title\r\nBody\r\n');
 assert.ok(result.text.endsWith('# Title\r\nBody\r\n'),'body bytes preserved');
 assert.ok(note.startsWith(result.before));
 assert.ok(result.text.startsWith(result.after));
 assert.ok(!/(?<!\r)\n/.test(result.after),'no lone LF inside the new frontmatter');
});

test('updateProperties LF output is unchanged (POSIX regression guard)',()=>{
 const note='---\n{"Status":"draft","tags":["a"]}\n---\n# Title\nBody\n';
 const result=updateProperties(note,{status:'done',due:'2026-11-20'},['tags'],yaml);
 assert.equal(result.text,'---\n{"Status":"done","due":"2026-11-20"}\n---\n# Title\nBody\n');
 assert.equal(updateProperties('Body',{status:'new'},[],yaml).text,'---\n{"status":"new"}\n---\nBody');
 assert.equal(updateProperties('---\n{"a":1}\n---\nBody',{},['A'],yaml).text,'Body');
});

test('updateProperties adds frontmatter in the note\'s CRLF style and removes it cleanly',()=>{
 const added=updateProperties('# Title\r\nBody\r\n',{status:'new'},[],yaml);
 assert.equal(added.text,'---\r\n{"status":"new"}\r\n---\r\n# Title\r\nBody\r\n');
 const removed=updateProperties('---\r\n{"a":1}\r\n---\r\nBody\r\n',{},['a'],yaml);
 assert.equal(removed.text,'Body\r\n');
});

const canvasLf='{\n\t"nodes":[\n\t\t{"id":"a1","type":"text","x":0,"y":0,"width":100,"height":50,"text":"hi"}\n\t],\n\t"edges":[]\n}';

test('serializeCanvas round-trips a CRLF canvas byte-identically',()=>{
 const text=crlf(canvasLf);
 assert.equal(serializeCanvas(parseCanvas(text),text),text);
 assert.equal(serializeCanvas(parseCanvas(text+'\r\n'),text+'\r\n'),text+'\r\n');
});

test('serializeCanvas LF round-trip is unchanged (POSIX regression guard)',()=>{
 assert.equal(serializeCanvas(parseCanvas(canvasLf),canvasLf),canvasLf);
 assert.equal(serializeCanvas(parseCanvas(canvasLf+'\n'),canvasLf+'\n'),canvasLf+'\n');
 assert.equal(serializeCanvas(parseCanvas(''),''),'{\n\t"nodes":[],\n\t"edges":[]\n}');
});

test('a one-card change in a CRLF canvas alters exactly one line',()=>{
 const text=crlf(canvasLf);
 const data=parseCanvas(text);
 data.nodes[0].text='changed';
 const next=serializeCanvas(data,text);
 const beforeLines=text.split('\r\n'),afterLines=next.split('\r\n');
 assert.equal(beforeLines.length,afterLines.length);
 const diff=beforeLines.map((line,i)=>line===afterLines[i]?-1:i).filter(i=>i>=0);
 assert.deepEqual(diff,[2]);
 assert.ok(next.includes('"text":"changed"'));
 assert.ok(!/(?<!\r)\n/.test(next),'no lone LF introduced');
});

test('excalidraw readers keep a CRLF wrapper parseable and preserved',()=>{
 const text=crlf(newExcalidrawFile());
 assert.ok(isExcalidrawText(text));
 const file=parseExcalidraw(text);
 assert.equal(file.scene.elements.length,0);
 const scene={...file.scene,elements:[{id:'t1',type:'text',x:0,y:0,width:50,height:20,text:'hello',originalText:'hello',rawText:'hello',version:1}]};
 const out=serializeExcalidraw(text,scene);
 assert.ok(out.startsWith('---\r\n'),'frontmatter line endings kept');
 assert.ok(out.includes('# Excalidraw Data\r\n')&&out.includes('## Text Elements\r\n'),'wrapper sections kept');
 assert.equal(parseExcalidraw(out).scene.elements.length,1);
 // Plain .excalidraw JSON with CRLF parses too.
 const json=crlf(JSON.stringify({type:'excalidraw',version:2,source:'https://github.com/zsviczian/obsidian-excalidraw-plugin',elements:[],appState:{},files:{}}));
 assert.equal(parseExcalidraw(json).scene.elements.length,0);
});
