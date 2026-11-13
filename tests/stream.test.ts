import {test} from 'node:test';import assert from 'node:assert/strict';
import {RecordSplitter} from '../src/stream';

test('records split across chunks, several per chunk, and empty records are kept in order',()=>{
 const lines=new RecordSplitter('\n');
 assert.deepEqual(lines.push('a'),[]);
 assert.deepEqual(lines.push('b\nc\n\nd'),['ab','c','']);
 assert.deepEqual(lines.push('\n'),['d']);
 assert.deepEqual(lines.push(''),[]);
});

test('a delimiter of two characters may straddle two chunks',()=>{
 const blocks=new RecordSplitter('\n\n');
 assert.deepEqual(blocks.push('data: 1\n'),[]);
 assert.deepEqual(blocks.push('\ndata: 2\n'),['data: 1']);
 assert.deepEqual(blocks.push('\n'),['data: 2']);
 assert.deepEqual(blocks.push('x\n\ny\n'),['x']);
 assert.deepEqual(blocks.push('\nz'),['y']);
});

test('a record over the limit stops the splitter after the records before it',()=>{
 const lines=new RecordSplitter('\n',4);
 assert.deepEqual(lines.push('ok\ntoolong\nlater\n'),['ok']);
 assert.equal(lines.overflow,true);
 assert.deepEqual(lines.push('more\n'),[]);
 const pending=new RecordSplitter('\n',4);
 pending.push('abc');pending.push('de');
 assert.equal(pending.overflow,true);
});

test('one large record in many chunks is reassembled in linear time',()=>{
 const lines=new RecordSplitter('\n');
 const chunk='x'.repeat(16*1024);
 const started=performance.now();
 for(let i=0;i<1024;i++)assert.deepEqual(lines.push(chunk),[]);
 const [record]=lines.push('\n');
 assert.equal(record.length,16*1024*1024);
 // The quadratic version took 0.3–1.4 s here; allow a wide margin for slow machines.
 assert.ok(performance.now()-started<250,'took '+String(performance.now()-started)+' ms');
});
