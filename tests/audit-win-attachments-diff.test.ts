// Windows CRLF regression for the inline editor diff (src/editor-diff.ts).
// CodeMirror normalises the document to \n on load, so a CRLF proposal must be
// normalised before it is compared and diffed: otherwise a Windows note shows
// no highlights at all, and ranges sit \r-count characters off. LF (macOS)
// behaviour must stay byte-identical.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import type {DecorationSet} from '@codemirror/view';
import {stubObsidian} from './helpers/load-main';

let diffDecorations:(docText:string,before:string,after:string)=>DecorationSet;
before(async()=>{
 stubObsidian();
 ({diffDecorations}=await import('../src/editor-diff'));
});

/** The decorations as plain ranges; removed widgets carry their text. */
function ranges(deco:DecorationSet){
 const out:{from:number;to:number;kind:string;text?:string}[]=[];
 const cursor=deco.iter();
 while(cursor.value){
  const widget=cursor.value.spec.widget as {text?:string}|undefined;
  out.push({from:cursor.from,to:cursor.to,kind:widget?'removed':'added',...(widget?{text:widget.text}:{})});
  cursor.next();
 }
 return out;
}

const LF_BEFORE='alpha\nbeta\ngamma\n';
const LF_AFTER='alpha\nBETA\ngamma\n';
const EXPECTED=[{from:6,to:6,kind:'removed',text:'beta\n'},{from:6,to:11,kind:'added'}];

test('LF notes keep their exact decoration ranges (POSIX behaviour unchanged)',()=>{
 assert.deepEqual(ranges(diffDecorations(LF_AFTER,LF_BEFORE,LF_AFTER)),EXPECTED);
});

test('a CRLF note shows the same highlights as its LF form',()=>{
 const before='alpha\r\nbeta\r\ngamma\r\n',after='alpha\r\nBETA\r\ngamma\r\n';
 // The editor document is the LF-normalised proposal, exactly as CodeMirror stores it.
 assert.deepEqual(ranges(diffDecorations(LF_AFTER,before,after)),EXPECTED);
});

test('a CRLF note with an LF proposal diffs only the changed line, not the whole file',()=>{
 const before='alpha\r\nbeta\r\ngamma\r\n';
 assert.deepEqual(ranges(diffDecorations(LF_AFTER,before,LF_AFTER)),EXPECTED);
});

test('lone CR line endings are normalised the way the editor splits them',()=>{
 assert.deepEqual(ranges(diffDecorations(LF_AFTER,'alpha\rbeta\rgamma\r',LF_AFTER)),EXPECTED);
});

test('a document that does not show the proposal gets no decorations',()=>{
 assert.deepEqual(ranges(diffDecorations(LF_BEFORE,LF_BEFORE,LF_AFTER)),[]);
});

test('an unchanged proposal has no decorations',()=>{
 assert.deepEqual(ranges(diffDecorations(LF_AFTER,LF_AFTER,LF_AFTER)),[]);
});

test('oversized proposals stay undecorated',()=>{
 const before='x'.repeat(120000)+'\n',after='y'.repeat(120000)+'\n';
 assert.deepEqual(ranges(diffDecorations(after,before,after)),[]);
});

test('removed text widgets never carry carriage returns into the DOM',()=>{
 const before='alpha\r\nbeta\r\ngamma\r\n',after='alpha\r\nBETA\r\ngamma\r\n';
 const removed=ranges(diffDecorations(LF_AFTER,before,after)).find(r=>r.kind==='removed');
 assert.equal(removed?.text,'beta\n');
 assert.ok(!removed?.text?.includes('\r'));
});