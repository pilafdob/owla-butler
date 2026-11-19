// Regression tests for the 3.7.0-RC stream-leak audit (audits/3.7.0-rc/stream-leaks.md).
// RecordSplitter must notice a delimiter that straddles ANY number of chunks,
// not just the last two, and must keep its straddle window bounded.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {RecordSplitter} from '../src/stream';

test('a delimiter spread over three or more chunks still splits the record',()=>{
 const blocks=new RecordSplitter('abcd');
 assert.deepEqual(blocks.push('Xab'),[]);
 assert.deepEqual(blocks.push('c'),[]);
 assert.deepEqual(blocks.push('dY'),['X']);
 assert.deepEqual(blocks.push('ZabcdW'),['YZ']);
 assert.deepEqual(blocks.push('abcd'),['W']);
});

test('an SSE-style CRLF delimiter may arrive one character per chunk',()=>{
 const blocks=new RecordSplitter('\r\n\r\n');
 assert.deepEqual(blocks.push('data: 1\r'),[]);
 assert.deepEqual(blocks.push('\n'),[]);
 assert.deepEqual(blocks.push('\r'),[]);
 assert.deepEqual(blocks.push('\ndata: 2\r\n\r\ndata: 3'),['data: 1','data: 2']);
 assert.deepEqual(blocks.push('\r\n\r\n'),['data: 3']);
});

test('a two-character delimiter one character per chunk keeps working',()=>{
 const blocks=new RecordSplitter('\n\n');
 assert.deepEqual(blocks.push('a'),[]);
 assert.deepEqual(blocks.push('\n'),[]);
 assert.deepEqual(blocks.push('\n'),['a']);
 assert.deepEqual(blocks.push('b\n'),[]);
 assert.deepEqual(blocks.push('\nc'),['b']);
});

test('multi-byte UTF-8 split across chunks reassembles and counts toward the limit',()=>{
 const lines=new RecordSplitter('\n');
 const whole='a🎉b';
 assert.deepEqual(lines.push(whole.slice(0,2)),[]); // ends mid surrogate pair
 assert.deepEqual(lines.push(whole.slice(2)+'\n'),[whole]);
 const bounded=new RecordSplitter('\n',3);
 bounded.push('🎉🎉'); // 4 code units, over the limit of 3
 assert.equal(bounded.overflow,true);
});

test('overflow clears the straddle window and stays terminal',()=>{
 const blocks=new RecordSplitter('\n\n',4);
 blocks.push('abc');blocks.push('d');blocks.push('e');
 assert.equal(blocks.overflow,true);
 assert.deepEqual(blocks.push('\n\nx\n\n'),[]);
 const straddling=new RecordSplitter('\n\n',4);
 assert.deepEqual(straddling.push('ok\n'),[]);
 assert.deepEqual(straddling.push('\ntoolong\n'),['ok']);
 assert.equal(straddling.overflow,true);
});

test('a long record in many small chunks stays linear with the straddle window',()=>{
 const blocks=new RecordSplitter('\r\n\r\n');
 const chunk='x'.repeat(4096);
 const started=performance.now();
 for(let i=0;i<2048;i++)assert.deepEqual(blocks.push(chunk),[]);
 const [record]=blocks.push('\r\n\r\n');
 assert.equal(record.length,4096*2048);
 assert.ok(performance.now()-started<250,'took '+String(performance.now()-started)+' ms');
});
