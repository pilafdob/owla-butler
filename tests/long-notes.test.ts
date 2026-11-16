// Long-note reading and runaway-turn protection (3.4.0). Regression for a live
// School-vault turn that made 50+ read_note calls on a 61k-character note: the
// note was clipped to 4,000 characters with only 30 of 63 headings listed,
// there was no offset, and once an edit was staged every read returned the
// same opening of the preview regardless of the heading asked for.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {findBlock,findSection,headingOutline,noteChunk,noteHeadings,NOTE_CHUNK} from '../src/note-tools';
import {ToolGuard} from '../src/tool-guard';
import {germanWriteIntent,calibrateTask} from '../src/auto-route';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
const longNote=()=>{
 const parts=['---\ntitle: Latin\n---\n# Checklist\nintro\n'];
 for(let i=1;i<=62;i++)parts.push('## Section '+i+'\n'+('row '+i+' | x\n').repeat(60));
 parts.push('# Vokabel\n## Vokabeln (Units 1–17)\n| Latein | Deutsch |\n'+'| amare | lieben |\n'.repeat(2000)+'\n```md\n# not a heading\n```\nend ^tail\n');
 return parts.join('');
};

test('every heading is found, fenced code is skipped and sections end at the next same-level heading',()=>{
 const text=longNote(),headings=noteHeadings(text);
 assert.equal(headings.length,65);
 assert.ok(!headings.some(h=>h.title==='not a heading'));
 const vocab=findSection(text,'Vokabeln (Units 1–17)')!;
 assert.ok(text.slice(vocab.start,vocab.end).startsWith('## Vokabeln (Units 1–17)'));
 assert.equal(vocab.end,text.length);
 assert.equal(findSection(text,'vokabel#VOKABELN  (units 1–17)')?.start,vocab.start);
 assert.equal(findSection(text,'Missing'),null);
 const s1=findSection(text,'Section 1')!;
 assert.ok(text.slice(s1.start,s1.end).trimEnd().endsWith('row 1 | x'));
});

test('a long section is read in parts with an exact continuation, and the outline lists all headings',()=>{
 const text=longNote(),vocab=findSection(text,'Vokabeln (Units 1–17)')!,body=text.slice(vocab.start,vocab.end);
 assert.ok(body.length>NOTE_CHUNK*1.5);
 const first=noteChunk(body,0,next=>({path:'a.md',heading:'Vokabeln (Units 1–17)',offset:next}));
 const next=JSON.parse(first.match(/\[Continue with read_note (\{.*\})\]$/)![1]);
 assert.equal(next.offset,NOTE_CHUNK);
 const second=noteChunk(body,next.offset,n=>({offset:n}));
 assert.match(second,/^\[Characters 12000–24000 of \d+\.\]/);
 assert.throws(()=>noteChunk(body,body.length+1,n=>({offset:n})),/past the end/);
 const outline=headingOutline(text);
 assert.ok(outline.includes('## Vokabeln (Units 1–17)'));
 assert.ok(outline.includes('# Vokabel'));
 assert.equal(findBlock(text,'^tail')?.end,text.length);
});

test('ToolGuard refuses the third identical result, then asks for an answer, then stops',()=>{
 const guard=new ToolGuard(5,7);
 for(let i=0;i<2;i++){assert.equal(guard.before(),'ok');assert.equal(guard.after('read_note',{path:'a'},'same'),null);}
 assert.equal(guard.before(),'ok');assert.match(guard.after('read_note',{path:'a'},'same')!.message,/already returned the same result/);
 assert.equal(guard.after('read_note',{path:'a'},'changed'),null,'a changed result is fine');
 assert.equal(guard.before(),'ok');assert.equal(guard.before(),'ok');
 assert.match((guard.before() as Error).message,/Answer now/);
 assert.match((guard.before() as Error).message,/Answer now/);
 assert.equal(guard.before(),'stop');
 guard.reset();assert.equal(guard.before(),'ok');
});

test('German edit requests count as writes for routing',()=>{
 assert.ok(germanWriteIntent('nein, füge und kombinire zu der ersten Liste die du gemacht hast.'));
 assert.ok(germanWriteIntent('Ergänze die Tabelle um die neuen Vokabeln'));
 assert.ok(germanWriteIntent('lösche den zweiten Absatz'));
 assert.ok(germanWriteIntent('korrigiere das bitte',true));
 assert.equal(germanWriteIntent('Was bedeutet amare?'),false);
 assert.equal(germanWriteIntent('korrigiere das bitte',false),false);
 const task=calibrateTask({difficulty:3,kind:'synthesis',tools:false,effort:'medium'},'füge die Vokabeln zur Liste hinzu',{attachments:[],activeNote:true,selections:0,recentMessages:0,previousImages:0,previousPdfs:0,webSearch:false});
 assert.equal(task.writes,true);
});

// ---------------------------------------------------------------- read_note through the real dispatcher

let Butler:any,ButlerView:any,obsidian:any,vault:string;
before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 vault=join(mkdtempSync(join(tmpdir(),'owla-long-')),'Vault');mkdirSync(join(vault,'Latin'),{recursive:true});
 writeFileSync(join(vault,'Latin/Exam.md'),longNote());
});
function viewWith(text:string,editorText?:string){
 const file=new obsidian.TFile('Latin/Exam.md');file.stat={size:text.length};
 const leaves=editorText===undefined?[]:[(()=>{const v=new obsidian.MarkdownView({});v.file=file;v.editor={getValue:()=>editorText};return {view:v};})()];
 const app={vault:{adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',getFileByPath:()=>file,getAbstractFileByPath:()=>file,read:async()=>text,cachedRead:async()=>text},
  workspace:{getLeavesOfType:(t:string)=>t==='markdown'?leaves:[]},metadataCache:{getFileCache:()=>null}};
 const butler=new Butler(app,{id:'owla-butler',version:'t'});butler.app=app;
 const view=new ButlerView({app},butler);view.offeredToolNames=new Set(['read_note']);
 const log={createDiv:()=>({})};
 return (args:Record<string,unknown>,batches?:Map<string,any>)=>view.tool('read_note',{path:'Latin/Exam.md',...args},log,batches);
}

test('read_note: a long note continues by offset and lists every heading',async()=>{
 const text=longNote(),read=viewWith(text);
 const first=await read({});
 assert.ok(first.includes('## Vokabeln (Units 1–17)'),'late heading is listed');
 assert.match(first,/\[Continue with read_note \{"path":"Latin\/Exam.md","offset":12000\}\]/);
 const section=await read({heading:'Vokabeln (Units 1–17)',offset:12000});
 assert.match(section,/^Source: \[\[Latin\/Exam.md#Vokabeln \(Units 1–17\)\]\]\n\[Characters 12000–24000/);
});

test('read_note: after a staged proposal, heading and offset read the staged preview',async()=>{
 const text=longNote(),read=viewWith(text);
 const after=text.replace('| amare | lieben |','| amare | lieben |\n| monere | mahnen |');
 const batches=new Map([['Latin/Exam.md',{edit:{path:'Latin/Exam.md',before:text,after,reason:'r'},reasons:['r']}]]);
 const section=await read({heading:'Vokabeln (Units 1–17)'},batches);
 assert.match(section,/^Staged preview for this reply \(#Vokabeln \(Units 1–17\)\):\n/);
 assert.ok(section.includes('| monere | mahnen |'),'the staged change is visible in its section');
 assert.notEqual(await read({},batches),section,'whole and section reads differ');
 const later=await read({offset:24000},batches);
 assert.match(later,/^Staged preview for this reply:\n\[Characters 24000–/);
});

test('read_note: unsaved editor text is read by heading instead of failing',async()=>{
 const text=longNote(),editor=text.replace('## Section 5\n','## Section 5\nunsaved line\n'),read=viewWith(text,editor);
 const section=await read({heading:'Section 5'});
 assert.ok(section.includes('unsaved line'));
 await assert.rejects(read({heading:'Nope'}),/No heading "Nope"/);
});
