import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

// The Community review rejects a release whose source disables an Obsidian rule
// (3.8.0 failed on `eslint-disable-next-line obsidianmd/prefer-file-manager-trash-file`).
test('no source file disables an obsidianmd lint rule',()=>{
 const found:string[]=[];
 const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory())walk(path);
  else if(/\.ts$/.test(entry.name))readFileSync(path,'utf8').split('\n').forEach((line,index)=>{if(/eslint-disable[^\n]*obsidianmd\//.test(line))found.push(path+':'+(index+1));});
 }};
 walk('src');
 assert.deepEqual(found,[]);
});

test('styles.css uses no !important (flagged by the Community CSS lint)',()=>{
 const css=readFileSync('styles.css','utf8').replace(/\/\*[\s\S]*?\*\//g,'');
 assert.equal(/!\s*important/i.test(css),false);
});
