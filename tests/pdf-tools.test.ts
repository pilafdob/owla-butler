import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument,PDFName,PDFDict,PDFHexString} from 'pdf-lib';
import {pdfLink,annotatePdf,validatePdfComments} from '../src/pdf-tools';

test('PDF wikilinks preserve paths and validate page fragments',()=>{
 assert.deepEqual(pdfLink('[[Books/Study.pdf#page=3|Read]]'),{path:'Books/Study.pdf',page:3});
 assert.throws(()=>pdfLink('[[Study.pdf#page=0]]'));
 assert.throws(()=>pdfLink('[[Study.md#page=3]]'));
});
test('comments are validated without changing source and annotated copies retain pages',async()=>{
 const source=await PDFDocument.create();source.addPage();
 const bytes=await source.save(),original=bytes.slice();
 await validatePdfComments(bytes,[{page:1,text:'Check this source.'}]);
 assert.deepEqual(bytes,original);
 await assert.rejects(()=>validatePdfComments(bytes,[{page:2,text:'Invalid'}]));
 const result=await annotatePdf(bytes,[{page:1,text:'Check α and β.'}]);
 const annotated=await PDFDocument.load(result);
 assert.equal(annotated.getPageCount(),1);
 const annotations=annotated.getPage(0).node.Annots()!;
 assert.equal(annotations.size(),1);
 const comment=annotated.context.lookup(annotations.get(0),PDFDict);
 assert.equal(comment.lookup(PDFName.of('Contents'),PDFHexString).decodeText(),'Check α and β.');
 assert.deepEqual(bytes,original);
});
