// Windows-focused RecordSplitter regressions (3.7.0-RC round 2, win-stream;
// audits/3.7.0-rc/windows-stream-leaks.md). CRLF-heavy pipe output: the cap
// counts the \r, delimiters straddle any number of chunks under CRLF, a lone
// CR is data, and overflow stays terminal. Runs on every platform.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {RecordSplitter} from '../src/stream';

test('CRLF records keep the \\r for the caller to trim, in order',()=>{
 const lines=new RecordSplitter('\n');
 assert.deepEqual(lines.push('a\r\nb\r\n'),['a\r','b\r']);
 assert.deepEqual(lines.push('c\r'),[]);
 assert.deepEqual(lines.push('\n'),['c\r']);
 // Both Claude parsers trim each record before JSON.parse, so the CR never
 // reaches the protocol decoder.
 assert.equal('a\r'.trim(),'a');
});

test('the 16 MiB cap counts the \\r of a CRLF line and fails closed one unit over',()=>{
 const MAX=16*1024*1024;
 const exact=new RecordSplitter('\n',MAX);
 const [record]=exact.push('x'.repeat(MAX-1)+'\r\n');
 assert.equal(record.length,MAX);
 assert.equal(exact.overflow,false);
 const over=new RecordSplitter('\n',MAX);
 assert.deepEqual(over.push('ok\r\n'),['ok\r']);
 assert.deepEqual(over.push('x'.repeat(MAX)+'\r\n'),[]);
 assert.equal(over.overflow,true);
 assert.deepEqual(over.push('later\r\n'),[]);
});

test('a CRLF blank-line delimiter straddling three chunks still splits (round-1 F4 under CRLF)',()=>{
 const blocks=new RecordSplitter('\r\n\r\n');
 assert.deepEqual(blocks.push('data: 1\r'),[]);
 assert.deepEqual(blocks.push('\n\r'),[]);
 assert.deepEqual(blocks.push('\ndata: 2\r\n\r\n'),['data: 1','data: 2']);
});

test('a lone CR is data, not a record boundary',()=>{
 const lines=new RecordSplitter('\n');
 assert.deepEqual(lines.push('a\rb\r\n'),['a\rb\r']);
 const blocks=new RecordSplitter('\r\n');
 assert.deepEqual(blocks.push('a\r'),[]);
 assert.deepEqual(blocks.push('x\r\n'),['a\rx']);
});

test('one-character-per-chunk CRLF flood hits the cap and stays terminal',()=>{
 const lines=new RecordSplitter('\n',8);
 const got:string[]=[];
 for(const ch of 'ab\r\ncd\r\nway-too-long\r\nshort\r\n'){got.push(...lines.push(ch));if(lines.overflow)break;}
 assert.deepEqual(got,['ab\r','cd\r']);
 assert.equal(lines.overflow,true);
 assert.deepEqual(lines.push('\r\n'),[]);
});

test('a pending CRLF record over the cap fails closed before any delimiter arrives',()=>{
 const lines=new RecordSplitter('\n',4);
 lines.push('ab');lines.push('cd');
 assert.equal(lines.overflow,false);
 lines.push('\r'); // the CR of the CRLF pair counts toward the record
 assert.equal(lines.overflow,true);
 assert.deepEqual(lines.push('\n'),[]);
});
