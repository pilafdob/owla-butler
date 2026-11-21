// Windows attachment reading (src/attachments.ts): UTF-16 BOM and ANSI text
// that File.text() (UTF-8 only) cannot decode, CRLF normalisation so line
// endings do not inflate the character budget, and the binary-refusal guard.
// Also: PDF page citations with Windows paths, and the selection clip contract.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attachmentTextEncoding,convertFile} from '../src/attachments';
import {pdfPageReference} from '../src/pdf';
import {clip} from '../src/core';

const u8=(...bytes:number[])=>new Uint8Array(bytes);
const enc=(bytes:Uint8Array,extension='.txt',type='text/plain')=>attachmentTextEncoding(bytes,extension,type);

test('a UTF-16 LE BOM is detected (Windows Notepad "Unicode")',()=>{
 assert.equal(enc(u8(0xFF,0xFE,0x48,0x00,0x69,0x00)),'utf-16le');
});
test('a UTF-16 BE BOM is detected',()=>{
 assert.equal(enc(u8(0xFE,0xFF,0x00,0x48,0x00,0x69)),'utf-16be');
});
test('a UTF-8 BOM still reads as UTF-8',()=>{
 assert.equal(enc(u8(0xEF,0xBB,0xBF,0x48,0x69)),'utf-8');
});
test('plain ASCII and valid UTF-8 read as UTF-8',()=>{
 assert.equal(enc(u8(0x48,0x69)),'utf-8');
 assert.equal(enc(new TextEncoder().encode('Grüße')),'utf-8');
});
test('a NUL byte marks the sample binary',()=>{
 assert.equal(enc(u8(0x48,0x00,0x69)),null);
});
test('invalid UTF-8 in a prose extension falls back to windows-1252 (ANSI)',()=>{
 // 0xFC is ü in windows-1252 but not valid UTF-8 on its own.
 assert.equal(enc(u8(0x47,0x72,0xFC,0xDF,0x65)),'windows-1252');
});
test('the ANSI fallback is limited to prose extensions',()=>{
 assert.equal(enc(u8(0x47,0x72,0xFC,0xDF,0x65),'.bin'),null);
 assert.equal(enc(u8(0x47,0x72,0xFC,0xDF,0x65),'.dat'),null);
});
test('the ANSI fallback refuses control bytes so binary stays refused',()=>{
 // 0x81 is an undefined windows-1252 byte that decodes to a C1 control.
 assert.equal(enc(u8(0x47,0x72,0x81,0x65)),null);
});
test('valid UTF-8 control bytes keep their previous text treatment',()=>{
 // The original guard refused only NUL bytes and invalid UTF-8; unchanged.
 assert.equal(enc(u8(0x47,0x72,0x01,0x65)),'utf-8');
});
test('image types and known binary extensions are never text',()=>{
 assert.equal(enc(u8(0x48,0x69),'.png','image/png'),null);
 assert.equal(enc(u8(0x48,0x69),'.png',''),null);
 assert.equal(enc(u8(0x48,0x69),'.doc',''),null);
 assert.equal(enc(u8(0x48,0x69),'.heic',''),null);
});

// End-to-end through convertFile: a UTF-16 file is decoded, not refused.
test('convertFile decodes a UTF-16 LE attachment to text',async()=>{
 const body=Buffer.from('Grüße\r\nWelt\r\n','utf16le');
 const data=Buffer.concat([Buffer.from([0xFF,0xFE]),body]);
 const file=new File([data],'note.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.equal(result.text,'Grüße\nWelt\n');
 assert.equal(result.notice,undefined);
});
test('convertFile decodes a UTF-16 BE attachment to text',async()=>{
 // Node's Buffer has no utf16be encoding: build it by swapping LE bytes.
 const body=Buffer.from(Buffer.from('Hallo\r\nWelt\r\n','utf16le'));
 for(let i=0;i<body.length;i+=2){const t=body[i];body[i]=body[i+1];body[i+1]=t;}
 const data=Buffer.concat([Buffer.from([0xFE,0xFF]),body]);
 const file=new File([data],'note.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.equal(result.text,'Hallo\nWelt\n');
});
test('convertFile decodes an ANSI (windows-1252) attachment to text',async()=>{
 const data=Buffer.from('Grüße\r\n','latin1');
 const file=new File([data],'note.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.equal(result.text,'Grüße\n');
});
test('CRLF is normalised to LF so it does not inflate the budget',async()=>{
 const file=new File(['a\r\nb\r\nc\r\n'],'note.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.equal(result.text,'a\nb\nc\n');
});
test('a large UTF-16 attachment is still bounded and marked shortened',async()=>{
 const body=Buffer.from('x'.repeat(200000),'utf16le');
 const data=Buffer.concat([Buffer.from([0xFF,0xFE]),body]);
 const file=new File([data],'big.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.match(result.text,/shortened/);
 assert.match(result.text,/first 256 KB/);
});

// PDF page citations: Windows separators, spaces and commas in file names.
test('pdfPageReference accepts Windows backslash paths',()=>{
 assert.equal(pdfPageReference('Bio\\Kernbereiche Biologie 6.pdf',15),'[[Bio/Kernbereiche Biologie 6.pdf#page=15|Kernbereiche Biologie 6,p.15]]');
 assert.equal(pdfPageReference('School/Bio\\Book.pdf',3),'[[School/Bio/Book.pdf#page=3|Book,p.3]]');
});
test('pdfPageReference keeps the name,p.page alias for vault paths, spaces and commas',()=>{
 assert.equal(pdfPageReference('School/Bio/Kernbereiche Biologie 6.pdf',15),'[[School/Bio/Kernbereiche Biologie 6.pdf#page=15|Kernbereiche Biologie 6,p.15]]');
 assert.equal(pdfPageReference('Bio, Chapter 3.pdf',15),'[[Bio, Chapter 3.pdf#page=15|Bio, Chapter 3,p.15]]');
 assert.equal(pdfPageReference('My Book.PDF',2),'[[My Book.PDF#page=2|My Book,p.2]]');
});

// Selection clip contract: clip counts characters. Editor selections arrive
// LF-normalised (CodeMirror), so CRLF never inflates the 3000-char selection
// budget in the product; raw CRLF text would, which is why convertFile now
// normalises attachment text. This pins both halves of that contract.
test('clip shortens by character count with an explicit notice',()=>{
 const text='word '.repeat(1000);
 const clipped=clip(text,3000);
 assert.ok(clipped.startsWith(text.slice(0,3000)));
 assert.match(clipped,/\[Context shortened\. Read a specific passage if needed\.\]$/);
 assert.equal(clip('short selection',3000),'short selection');
});
test('raw CRLF would consume the clip budget character by character',()=>{
 const raw='a\r\n'.repeat(1500);
 const clipped=clip(raw,3000);
 assert.ok(clipped.startsWith(raw.slice(0,3000)));
 assert.equal(clipped.slice(0,3000).split('\r').length-1,1000,'the raw clip carries 1000 carriage returns');
});