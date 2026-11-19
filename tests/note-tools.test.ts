import {test} from 'node:test';import assert from 'node:assert/strict';
import {brokenLinks,linkTargets,linkWarning,tableAt,updateProperties,type Yaml} from '../src/note-tools';

// JSON is valid YAML, which is enough to check the property logic without Obsidian.
const yaml:Yaml={parse:text=>JSON.parse(text),stringify:value=>JSON.stringify(value)};

test('properties are set, renamed case-insensitively and removed, keeping the body',()=>{
 const note='---\n{"Status":"draft","tags":["a"]}\n---\n# Title\nBody\n';
 const result=updateProperties(note,{status:'done',due:'2026-11-20'},['tags'],yaml);
 assert.equal(result.text,'---\n{"Status":"done","due":"2026-11-20"}\n---\n# Title\nBody\n');
 assert.ok(note.startsWith(result.before));
 assert.ok(result.text.startsWith(result.after));
});

test('properties are added to a note without any and removed entirely when empty',()=>{
 assert.equal(updateProperties('Body',{status:'new'},[],yaml).text,'---\n{"status":"new"}\n---\nBody');
 assert.equal(updateProperties('---\n{"a":1}\n---\nBody',{},['A'],yaml).text,'Body');
});

test('invalid property blocks are refused',()=>{
 assert.throws(()=>updateProperties('---\n["x"]\n---\nBody',{a:1},[],yaml),/not valid YAML/);
 assert.throws(()=>updateProperties('Body',{' ':1},[],yaml),/empty/);
});

test('link targets cover wikilinks, embeds, aliases, subpaths and Markdown links, not code or URLs',()=>{
 const text='[[A|alias]] ![[img.png]] [[B#Heading]] [[#Local]] [x](C%20D.md#^blk) [web](https://x.y) `[[code]]`\n```\n[[fenced]]\n```';
 assert.deepEqual(linkTargets(text).map(l=>l.link),['A','img.png','B#Heading','#Local','C D.md#^blk']);
});

test('only new links that do not resolve are reported',()=>{
 const notes:Record<string,string>={A:'A.md',B:'B.md'};
 const resolve=(p:string)=>notes[p]??null;
 const subpath=(note:string,sub:string)=>note==='B.md'&&sub==='#Heading';
 const before='[[Old missing]]';
 const after='[[Old missing]] [[A]] [[Gone]] [[B#Heading]] [[B#Nope]] [[A#^blk]]';
 assert.deepEqual(brokenLinks(before,after,resolve,subpath),['Gone','B#Nope','A#^blk']);
 assert.equal(linkWarning([]),'');
 assert.match(linkWarning(['Gone']),/\[\[Gone\]\]/);
});

test('headings and block IDs are found in proposed text',async()=>{
 const {textHasSubpath}=await import('../src/note-tools');
 const text='# Top\n## Next step ##\nA paragraph ^abc-1\n';
 assert.ok(textHasSubpath(text,'#Next step'));
 assert.ok(textHasSubpath(text,'#Top#Next step'));
 assert.ok(textHasSubpath(text,'#^abc-1'));
 assert.ok(!textHasSubpath(text,'#^abc'));
 assert.ok(!textHasSubpath(text,'#Missing'));
});

test('tableAt returns the full raw table from any row and null outside it',()=>{
 const text='Intro\n| Name | Age |\n| --- | ---: |\n| Ana | 2 |\n| Bo | 4 |\nAfter\n';
 const table='| Name | Age |\n| --- | ---: |\n| Ana | 2 |\n| Bo | 4 |';
 assert.equal(tableAt(text,1)?.text,table);
 assert.equal(tableAt(text,2)?.text,table);
 assert.equal(tableAt(text,4)?.text,table);
 assert.deepEqual(tableAt(text,1),{start:1,end:4,text:table});
 assert.equal(tableAt(text,0),null);
 assert.equal(tableAt(text,5),null);
});

test('tableAt skips fenced code that looks like a table',()=>{
 const text='```\n| a | b |\n| --- | --- |\n```\n';
 assert.equal(tableAt(text,1),null);
 assert.equal(tableAt(text,2),null);
});

test('tableAt requires a delimiter row, not just pipe lines',()=>{
 assert.equal(tableAt('| a | b |\n| c | d |\n',0),null);
 assert.equal(tableAt('| a | b |\n| c | d |\n',1),null);
});

test('tableAt accepts GFM delimiter rows with single hyphens and one-column tables',()=>{
 assert.equal(tableAt('| a | b |\n|-|:-:|\n| 1 | 2 |',2)?.start,0);
 assert.equal(tableAt('| only |\n| --- |\n| x |',0)?.end,2);
 assert.equal(tableAt('| a | b |\n| -1 | -2 |',0),null);
});
