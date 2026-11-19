import {test} from 'node:test';import assert from 'node:assert/strict';
import {ocrSection,ocrSupported,formatOcrLines,ensureOcrBinary,ocrImageDataUrl} from '../src/ocr';

test('OCR is only offered on macOS with the Swift compiler',()=>{assert.equal(ocrSupported('win32'),false);assert.equal(ocrSupported('linux'),false);});
test('a non-macOS host falls back to no OCR instead of throwing',async()=>{assert.equal(await ensureOcrBinary('/tmp/owla-ocr-test','linux'),null);assert.equal(await ocrImageDataUrl('data:image/png;base64,AAAA','/tmp/owla-ocr-test','en-US','linux'),null);});
test('only raster image data URLs are OCR candidates',async()=>{assert.equal(await ocrImageDataUrl('https://example.com/a.png','/tmp/owla-ocr-test'),null);assert.equal(await ocrImageDataUrl('data:text/plain;base64,AAAA','/tmp/owla-ocr-test'),null);});
test('OCR section is empty without text and labelled with a caveat otherwise',()=>{assert.equal(ocrSection(null),'');assert.equal(ocrSection(''),'');const section=ocrSection('v = s / t');assert.ok(section.includes('v = s / t'));assert.ok(section.includes('Handwriting OCR'));});
test('recognized lines are ordered top to bottom, then left to right',()=>{
 // Vision y grows upward: the top line has the LARGEST y.
 const lines=[{text:'bottom',x:0.1,y:0.1},{text:'top',x:0.1,y:0.9},{text:'middle-right',x:0.6,y:0.5},{text:'middle-left',x:0.1,y:0.5}];
 assert.equal(formatOcrLines(lines),'top\nmiddle-left\nmiddle-right\nbottom');
});
test('empty or textless observations yield no OCR text',()=>{assert.equal(formatOcrLines([]),null);assert.equal(formatOcrLines([{text:'   '},{x:0.1,y:0.2}]),null);});
