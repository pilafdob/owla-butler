import {test} from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {archiveParts,convertFile} from '../src/attachments';

test('office archive reader keeps relevant parts and ignores executable and traversal entries',async()=>{
 const data=zipSync({'word/document.xml':strToU8('<document/>'),'ppt/slides/slide10.xml':strToU8('<slide/>'),'../private.txt':strToU8('secret'),'word/vbaProject.bin':strToU8('macro')});
 assert.deepEqual(Object.keys(await archiveParts(data)).sort(),['ppt/slides/slide10.xml','word/document.xml']);
});
test('large text attachments carry explicit shortening information',async()=>{
 const file=new File(['Study note.\n'.repeat(30000)],'notes.txt',{type:'text/plain'});
 const result=await convertFile(file,'',()=>{throw Error('Not XML');});
 assert.match(result.text,/Study note/);
 assert.match(result.text,/shortened/);
 assert.match(result.text,/first 256 KB/);
});
