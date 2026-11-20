// RC hardening: a damaged or encrypted PDF reports an actionable error, not an opaque pdf-lib parse error.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {annotatePdf,validatePdfComments} from '../src/pdf-tools';

const garbage=new Uint8Array([1,2,3,4,5,6,7,8]);

test('validatePdfComments reports an actionable error for an unreadable PDF',async()=>{
 await assert.rejects(()=>validatePdfComments(garbage,[{page:1,text:'hi'}]),/could not be opened/);
});

test('annotatePdf reports an actionable error for an unreadable PDF',async()=>{
 await assert.rejects(()=>annotatePdf(garbage,[{page:1,text:'hi'}]),/could not be opened/);
});
