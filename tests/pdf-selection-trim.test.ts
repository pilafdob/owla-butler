// Regression: the context-window trim must splice PDF selections too. Their
// context block carries a page citation, so a splice that rebuilt the legacy
// 'SELECTED TEXT from <path>' shape never matched and left the payload untrimmed.
import {test,before} from 'node:test';import assert from 'node:assert/strict';
import {loadMain} from './helpers/load-main';
import {selectionContextBlock,type SelectionItem} from '../src/pdf-selection';

/* eslint-disable @typescript-eslint/no-explicit-any */
let ButlerView:any;
before(async()=>{({ButlerView}=await loadMain());});

test('trimSelectionsForWindow shortens a PDF selection and keeps its page citation',()=>{
 const selected:SelectionItem[]=[{path:'Books/Guide.pdf',text:'x'.repeat(40000),pdf:{page:4,pages:[4,5]}},{path:'a.md',text:'short'}];
 const head='PROMPT CONTEXT';
 const context=head+selected.map(selectionContextBlock).join('')+'\nTAIL';
 const routingContext:any={estimatedTokens:Math.ceil(context.length/3.5),selectedChars:40005,selections:2};
 const activity={createDiv:()=>({})};
 const next=ButlerView.prototype.trimSelectionsForWindow.call({},selected,routingContext,[{context:4000}],context,activity,head.length);
 assert.ok(next.length<context.length,'payload was trimmed');
 assert.equal(selected[0].pdf?.page,4,'pdf marker survives the trim');
 assert.deepEqual(selected[0].pdf?.pages,[4,5]);
 assert.ok(next.startsWith(head+selectionContextBlock(selected[0])),'trimmed block keeps the PDF citation');
 assert.ok(next.endsWith('\nTAIL'));
});
