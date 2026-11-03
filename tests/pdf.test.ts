import {test} from 'node:test';import assert from 'node:assert/strict';
import {pdfPageText,pdfPageNumber,pdfSource} from '../src/pdf';
test('PDF text preserves line boundaries and source page references',()=>{assert.equal(pdfPageText([{str:'Heading',transform:[1,0,0,1,0,100],hasEOL:true},{str:'A',transform:[1,0,0,1,0,80]},{str:'sentence.',transform:[1,0,0,1,20,80],hasEOL:true},{str:'Next',transform:[1,0,0,1,0,60]}]),'Heading\nA sentence.\nNext');assert.equal(pdfSource('study.pdf',2),'study.pdf, p. 2');});
test('invalid PDF pages rejected instead of reading a different page',()=>{assert.equal(pdfPageNumber('2',3),2);for(const p of ['0','4','-1','1.5','2x',''])assert.throws(()=>pdfPageNumber(p,3));});
test('source filenames cannot inject Markdown links or line breaks',()=>assert.equal(pdfSource('a[bad]\n.pdf',1),'a_bad__.pdf, p. 1'));
