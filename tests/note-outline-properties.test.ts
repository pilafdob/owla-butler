// 3.8.0 handoff 4: outline edits, hardened property edits and the bounded
// active-note context block. Pure functions only; wiring is tested separately.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {editOutline,headingLinkBreaks,headingLinkWarning,lostHeadings,matchHeadings,noteContextBlock,NOTE_CONTEXT_LIMIT,resolveHeading,updateProperties,type Yaml} from '../src/note-tools';
import {miniYaml as yaml} from './helpers/mini-yaml';

const crlf=(text:string)=>text.replace(/\n/g,'\r\n');
const json:Yaml={parse:text=>JSON.parse(text),stringify:value=>JSON.stringify(value)};

// ---------------------------------------------------------------- properties

const note='---\n# project metadata\nstatus: draft\ntags:\n  - a\n  - b\ndue: 2026-11-20\ndone: false\ncount: 3\n---\n# Title\nBody\n';

test('setting one property rewrites only its line and keeps comments, order and dates',()=>{
 const result=updateProperties(note,{status:'done'},[],yaml);
 assert.equal(result.text,note.replace('status: draft','status: done'));
 assert.equal(result.preserved,true);
 assert.ok(note.startsWith(result.before));
 assert.ok(result.text.startsWith(result.after));
});

test('removing and renaming keep the position and raw value of other entries',()=>{
 const result=updateProperties(note,{},['TAGS'],yaml,{status:'state'});
 assert.equal(result.text,'---\n# project metadata\nstate: draft\ndue: 2026-11-20\ndone: false\ncount: 3\n---\n# Title\nBody\n');
});

test('new properties are appended; date text stays an unquoted date',()=>{
 const result=updateProperties(note,{reviewed:'2026-12-01',owner:'Ana'},[],yaml);
 assert.ok(result.text.includes('count: 3\nreviewed: 2026-12-01\nowner: Ana\n---\n'),result.text);
});

test('existing types are kept: checkbox, number and list values sent as text',()=>{
 const result=updateProperties(note,{done:'true',count:'7',tags:'c'},[],yaml);
 assert.ok(result.text.includes('done: true\n'));
 assert.ok(result.text.includes('count: 7\n'));
 assert.ok(result.text.includes('tags:\n  - c\n'));
 assert.deepEqual(result.notes.sort(),['count kept as a number','done kept as a checkbox','tags kept as a list']);
});

test('invalid values and invalid YAML are refused',()=>{
 assert.throws(()=>updateProperties(note,{x:Number.NaN},[],yaml),/finite number/);
 assert.throws(()=>updateProperties(note,{x:()=>1},[],yaml),/must be text/);
 assert.throws(()=>updateProperties(note,{x:'y'.repeat(10_001)},[],yaml),/longer than/);
 assert.throws(()=>updateProperties('---\nnot a mapping line\n---\nBody',{a:1},[],yaml),/not valid YAML/);
});

test('rename errors name the problem',()=>{
 assert.throws(()=>updateProperties(note,{},[],yaml,{missing:'x'}),/no property "missing"/);
 assert.throws(()=>updateProperties(note,{},[],yaml,{status:'Count'}),/already exists/);
 assert.throws(()=>updateProperties(note,{},[],yaml,{status:' '}),/non-empty name/);
});

test('CRLF frontmatter stays CRLF and the body is byte-identical',()=>{
 const text=crlf(note);
 const result=updateProperties(text,{status:'done'},['due'],yaml);
 assert.equal(result.text,crlf(note.replace('status: draft','status: done').replace('due: 2026-11-20\n','')));
 assert.ok(!/(?<!\r)\n/.test(result.text),'no lone LF');
});

test('flow-style frontmatter still falls back to a full re-serialization',()=>{
 const result=updateProperties('---\n{"a":1}\n---\nBody',{b:2},[],json);
 assert.equal(result.text,'---\n{"a":1,"b":2}\n---\nBody');
 assert.equal(result.preserved,false);
});

test('a block scalar and indented comments travel with their entry',()=>{
 const text='---\nsummary: |\n  line one\n\n  line two\n  # not a comment\nstatus: draft\n---\nBody';
 const result=updateProperties(text,{status:'done'},[],{parse:t=>{if(t.includes('summary: |'))return {summary:'line one\n\nline two\n# not a comment\n',status:/status: (\w+)/.exec(t)![1]};return yaml.parse(t);},stringify:yaml.stringify});
 assert.equal(result.text,text.replace('status: draft','status: done'));
});

// ---------------------------------------------------------------- outline

const outline='---\ntitle: x\n---\nIntro\n\n# A\na\n\n## A1\na1\n\n### A1x\nx\n\n## A2\na2\n\n# B\nb\n\n```\n# not a heading\n```\n\n## Notes\nb notes\n\n# C\n\n## Notes\nc notes\n';

test('rename keeps the level, content and frontmatter',()=>{
 const result=editOutline(outline,{op:'rename',heading:'A1',title:'First part'});
 assert.equal(result.text,outline.replace('## A1\n','## First part\n'));
});

test('duplicate titles need a nested path or an occurrence',()=>{
 assert.throws(()=>editOutline(outline,{op:'rename',heading:'Notes',title:'N'}),/2 headings match/);
 assert.equal(editOutline(outline,{op:'rename',heading:'C#Notes',title:'N'}).text,outline.replace('## Notes\nc notes','## N\nc notes'));
 assert.equal(editOutline(outline,{op:'rename',heading:'Notes',occurrence:1,title:'N'}).text,outline.replace('## Notes\nb notes','## N\nb notes'));
 assert.equal(matchHeadings(outline,'B#Notes').length,1);
 assert.throws(()=>resolveHeading(outline,'Notes',3),/between 1 and 2/);
});

test('headings inside code fences are never matched or changed',()=>{
 assert.throws(()=>editOutline(outline,{op:'rename',heading:'not a heading',title:'x'}),/No heading/);
 const result=editOutline(outline,{op:'level',heading:'B',shift:1});
 assert.ok(result.text.includes('```\n# not a heading\n```'));
});

test('demote and promote carry the subsections and respect levels 1–6',()=>{
 const demoted=editOutline(outline,{op:'level',heading:'A',level:2});
 assert.ok(demoted.text.includes('## A\na\n\n### A1\na1\n\n#### A1x\nx\n\n### A2\n'));
 assert.ok(demoted.text.includes('\n# B\n'),'siblings are untouched');
 const promoted=editOutline(outline,{op:'level',heading:'A1',shift:-1});
 assert.ok(promoted.text.includes('# A1\na1\n\n## A1x\n'));
 assert.throws(()=>editOutline(outline,{op:'level',heading:'A',shift:-1}),/levels run from 1 to 6/);
 assert.throws(()=>editOutline('# A\n##### B\n',{op:'level',heading:'A',shift:2}),/level 7/);
 assert.throws(()=>editOutline(outline,{op:'level',heading:'A'}),/level \(1–6\) or shift/);
});

test('move up and down swap sibling sections with their children',()=>{
 const down=editOutline(outline,{op:'move',heading:'A1',position:'down'});
 assert.ok(down.text.includes('# A\na\n\n## A2\na2\n\n## A1\na1\n\n### A1x\nx\n\n# B\n'),down.text);
 const up=editOutline(down.text,{op:'move',heading:'A1',position:'up'});
 assert.equal(up.text,outline,'moving back restores the exact text');
 assert.throws(()=>editOutline(outline,{op:'move',heading:'A',position:'up'}),/already the first/);
 assert.throws(()=>editOutline(outline,{op:'move',heading:'A2',position:'down'}),/already the last/);
});

test('move before, after and under re-levels the section',()=>{
 const under=editOutline(outline,{op:'move',heading:'A1',position:'under',target:'C'});
 assert.ok(under.text.endsWith('# C\n\n## Notes\nc notes\n\n## A1\na1\n\n### A1x\nx\n'),under.text);
 assert.ok(!under.text.slice(0,under.text.indexOf('# C')).includes('A1'));
 const before=editOutline(outline,{op:'move',heading:'A1x',position:'before',target:'B'});
 assert.ok(before.text.includes('# A1x\nx\n\n# B\n'));
 const after=editOutline(outline,{op:'move',heading:'C',position:'after',target:'A'});
 assert.ok(after.text.includes('## A2\na2\n\n# C\n\n## Notes\nc notes\n\n# B\n'),after.text);
 assert.ok(after.text.endsWith('## Notes\nb notes\n'),'the note still ends with one line break');
 assert.throws(()=>editOutline(outline,{op:'move',heading:'A',position:'under',target:'A1x'}),/itself or one of its own subsections/);
 assert.throws(()=>editOutline('# A\n## B\n### C\n#### D\n##### E\n###### F\n# G\n',{op:'move',heading:'G',position:'under',target:'F'}),/1 to 6/);
});

test('insert adds a heading with content and blank-line spacing',()=>{
 const afterA2=editOutline(outline,{op:'insert',title:'A3',content:'new\ntext',target:'A2'});
 assert.ok(afterA2.text.includes('## A2\na2\n\n## A3\nnew\ntext\n\n# B\n'),afterA2.text);
 const under=editOutline(outline,{op:'insert',title:'Child',position:'under',target:'A1'});
 assert.ok(under.text.includes('### A1x\nx\n\n### Child\n\n## A2\n'),under.text);
 const end=editOutline('# A\ntext',{op:'insert',title:'Z'});
 assert.equal(end.text,'# A\ntext\n\n## Z\n');
 assert.throws(()=>editOutline(outline,{op:'insert',title:'x',position:'under',target:'A',level:1}),/level above 1/);
 assert.throws(()=>editOutline(outline,{op:'insert',title:'a\nb'}),/one line/);
});

test('outline edits keep CRLF notes in CRLF',()=>{
 const text=crlf(outline);
 for(const op of [
  {op:'rename',heading:'A1',title:'R'},
  {op:'level',heading:'A',level:2},
  {op:'move',heading:'A1',position:'down'},
  {op:'move',heading:'A1',position:'under',target:'C'},
  {op:'insert',title:'New',target:'B',content:'one\ntwo'},
 ] as const){
  const result=editOutline(text,op);
  assert.ok(!/(?<!\r)\n/.test(result.text),op.op+' introduced a lone LF');
  assert.equal(result.text,crlf(editOutline(outline,op).text),op.op+' matches the LF result');
 }
 assert.equal(editOutline(editOutline(text,{op:'move',heading:'A1',position:'down'}).text,{op:'move',heading:'A1',position:'up'}).text,text);
});

test('renamed headings report the heading links that will break',()=>{
 const before=outline,after=editOutline(outline,{op:'rename',heading:'A1',title:'R'}).text;
 assert.deepEqual(lostHeadings(before,after),['A1']);
 const links=[{source:'X.md',link:'Note#A1'},{source:'Note.md',link:'#A1'},{source:'Y.md',link:'Note#A2'},{source:'Z.md',link:'Note#^blk'},{source:'W.md',link:'Note'}];
 const broken=headingLinkBreaks(before,after,links);
 assert.deepEqual(broken.map(item=>item.source),['X.md','Note.md']);
 assert.match(headingLinkWarning(broken),/\[\[Note#A1\]\] in X\.md/);
 assert.equal(headingLinkWarning([]),'');
});

// ---------------------------------------------------------------- context block

test('note context lists properties, outline, links and backlinks',()=>{
 const block=noteContextBlock({properties:{status:'draft',tags:['a','b'],due:new Date('2026-11-20T00:00:00Z')},text:outline,outgoing:['B.md','Folder/C.md'],unresolved:['Missing'],backlinks:['X.md']});
 assert.match(block,/Properties: status: draft; tags: \[a, b\]; due: 2026-11-20/);
 assert.match(block,/Outline:\n# A\n  ## A1\n    ### A1x/);
 assert.ok(!block.includes('not a heading'));
 assert.match(block,/Outgoing links \(2\): B\.md, Folder\/C\.md/);
 assert.match(block,/Unresolved links \(1, no such note\): Missing/);
 assert.match(block,/Backlinks \(1\): X\.md/);
 assert.match(noteContextBlock({properties:'invalid',text:'plain',outgoing:[],unresolved:[],backlinks:[]}),/not valid YAML[\s\S]*Outline: \(no headings\)[\s\S]*Backlinks: none/);
});

test('note context stays within its character bound on a huge note',()=>{
 const big='x'.repeat(5000);
 const props:Record<string,unknown>={};for(let i=0;i<200;i++)props['key'+i]=big;
 const text=Array.from({length:500},(_,i)=>'#'.repeat(1+i%6)+' Heading '+i+' '+big.slice(0,200)).join('\n');
 const paths=Array.from({length:400},(_,i)=>'Folder/Deep/Path/Note '+i+'.md');
 const block=noteContextBlock({properties:props,text,outgoing:paths,unresolved:paths,backlinks:paths});
 assert.ok(block.length<=NOTE_CONTEXT_LIMIT,'block is '+block.length+' characters');
 assert.match(block,/… \d+ more/);
 assert.ok(block.endsWith(']'));
 const backlinks=/Backlinks \(400\): ([^\n\]]*)/.exec(block);
 if(backlinks)assert.ok(backlinks[1].split(', ').length<=31,'at most 30 backlinks are named');
});

test('moving the last section keeps one blank line around it and one line break at the end (live 3.8.0)',()=>{
 const text='# T\n\nIntro.\n\n## Alpha\n\nA text.\n\n### Alpha child\n\nChild text.\n\n## Beta\n\nB text.\n';
 assert.equal(editOutline(text,{op:'move',heading:'Beta',position:'up'}).text,'# T\n\nIntro.\n\n## Beta\n\nB text.\n\n## Alpha\n\nA text.\n\n### Alpha child\n\nChild text.\n');
 const crlf=text.replace(/\n/g,'\r\n');
 assert.equal(editOutline(crlf,{op:'move',heading:'Beta',position:'up'}).text,'# T\n\nIntro.\n\n## Beta\n\nB text.\n\n## Alpha\n\nA text.\n\n### Alpha child\n\nChild text.\n'.replace(/\n/g,'\r\n'));
 assert.equal(editOutline(text,{op:'move',heading:'Alpha',position:'down'}).text,'# T\n\nIntro.\n\n## Beta\n\nB text.\n\n## Alpha\n\nA text.\n\n### Alpha child\n\nChild text.\n');
});
