// 3.8.0 handoff 4 wiring: propose_outline and hardened propose_properties go
// through the normal staged-proposal path, revert restores the exact prior
// bytes (CRLF too), heading renames report the links they break, and the
// active-note context block is bounded and fed from the link cache.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';
import {miniYaml} from './helpers/mini-yaml';
import {NOTE_CONTEXT_LIMIT} from '../src/note-tools';
import {prefixToolNames,toolName,PROVIDER_IDS} from '../src/provider';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;
const initial:Record<string,string>={
 'Notes/A.md':'---\r\n# keep me\r\nstatus: draft\r\ntags:\r\n  - a\r\n---\r\n# Head\r\nalpha [[#Head]]\r\n\r\n## Sub\r\nbeta\r\n\r\n# Other\r\ngamma\r\n',
 'Notes/B.md':'see [[A#Head]] and [[A#Other]] and [[A]]\n',
 'Notes/Big.md':'# Big\n'+'word '.repeat(7000)+'\n',
 'Notes/D.canvas':'{"nodes":[]}',
 'Notes/Drawing.md':'---\nexcalidraw-plugin: parsed\n---\n# Drawing\n',
 'Private/P.md':'links [[A#Head]]\n',
};
const raw:Record<string,string>={};
const reset=()=>{for(const key of Object.keys(raw))delete raw[key];Object.assign(raw,initial);};

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 obsidian.parseYaml=miniYaml.parse;obsidian.stringifyYaml=miniYaml.stringify;
 scratch=mkdtempSync(join(tmpdir(),'owla-outline-wiring-'));
 vault=join(scratch,'Vault');
 reset();
 for(const folder of ['Notes','Private'])mkdirSync(join(vault,folder),{recursive:true});
 for(const [path,text] of Object.entries(raw))writeFileSync(join(vault,path),text);
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true,maxRetries:5,retryDelay:50});});

function makeApp(){
 const files=Object.keys(initial).map(path=>{const f=new obsidian.TFile(path);f.stat={size:initial[path].length,mtime:1};return f;});
 const fileMap=new Map(files.map(f=>[f.path,f]));
 const caches:Record<string,any>={
  'Notes/B.md':{links:[{link:'A#Head'},{link:'A#Other'},{link:'A'}]},
  'Private/P.md':{links:[{link:'A#Head'}]},
 };
 return {
  vault:{adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>files.filter(f=>f.extension==='md'),getFiles:()=>files,getAllFolders:()=>[],
   getFileByPath:(p:string)=>fileMap.get(p)??null,getAbstractFileByPath:(p:string)=>fileMap.get(p)??null,
   getFolderByPath:(p:string)=>['Notes','Private'].includes(p)?new obsidian.TFolder(p):null,
   cachedRead:async(f:any)=>raw[f.path],read:async(f:any)=>raw[f.path],
   process:async(f:any,fn:(text:string)=>string)=>{raw[f.path]=fn(raw[f.path]);return raw[f.path];}},
  workspace:{getLeavesOfType:()=>[],getActiveViewOfType:()=>null,getActiveFile:()=>null},
  metadataCache:{
   resolvedLinks:{'Notes/B.md':{'Notes/A.md':3},'Private/P.md':{'Notes/A.md':1},'Notes/A.md':{'Notes/A.md':1}},
   unresolvedLinks:{'Notes/A.md':{'Missing note':1}},
   getFileCache:(f:any)=>caches[f.path]??null,
   getFirstLinkpathDest:(link:string)=>link==='A'||link==='Notes/A'?fileMap.get('Notes/A.md'):null,
  },
 };
}
function makeButler(excluded='Private'){
 const app=makeApp();
 const butler=new Butler(app,{id:'owla-butler',version:'t'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:join(scratch,'storage'),excludedFolders:excluded});
 butler.organization={blocked:false,review:undefined,progress:undefined,busy:false,loadError:''};
 // Inline title off: the top heading is note text, not the title (the guard is tested below).
 butler.inlineTitle=()=>false;
 return butler;
}
function makeView(butler:any){
 const view=new ButlerView({app:butler.app},butler);
 view.offeredToolNames=new Set(['read_note','read_canvas','propose_outline','propose_properties','propose_edit']);
 return view;
}
const log={createDiv:()=>({})};

test('propose_outline and the rename option are offered with strict schemas',()=>{
 const butler=makeButler();
 const {specs}=butler.buildToolSpecs();
 const outline=specs.find((spec:any)=>spec.name==='propose_outline');
 assert.ok(outline,'propose_outline is offered');
 assert.deepEqual(outline.inputSchema.required,['path','op','reason']);
 assert.equal(outline.inputSchema.additionalProperties,false);
 assert.deepEqual(outline.inputSchema.properties.op.enum,['rename','level','move','insert']);
 const props=specs.find((spec:any)=>spec.name==='propose_properties');
 assert.ok(props.inputSchema.properties.rename,'propose_properties takes rename');
 for(const id of PROVIDER_IDS){
  const text=prefixToolNames('use propose_outline now',id);
  assert.ok(text.includes(toolName(id,'propose_outline')),id+' exposes propose_outline under its own name');
 }
});

test('a CRLF heading rename stages a diff, applies in CRLF and reverts byte-exactly',async()=>{
 reset();
 const butler=makeButler(),view=makeView(butler),batches=new Map();
 await view.tool('read_note',{path:'Notes/A.md'},log,batches);
 const result=await view.tool('propose_outline',{path:'Notes/A.md',op:'rename',heading:'Head',title:'Start',reason:'clearer'},log,batches);
 assert.match(result,/Outline change queued/);
 assert.match(result,/\[\[A#Head\]\] in Notes\/B\.md/,'the inbound link is reported');
 assert.match(result,/\[\[#Head\]\] in Notes\/A\.md/,'the self link is reported');
 assert.ok(!result.includes('Private/P.md'),'excluded notes are never named');
 assert.ok(!result.includes('A#Other'),'links to untouched headings are not reported');
 const edit=batches.get('Notes/A.md').edit;
 assert.equal(edit.before,initial['Notes/A.md'].replace(/\r\n/g,'\n'));
 assert.equal(edit.after,edit.before.replace('# Head\n','# Start\n'));
 await butler.apply(edit);
 assert.equal(raw['Notes/A.md'],initial['Notes/A.md'].replace('# Head\r\n','# Start\r\n'),'written in CRLF');
 await butler.restoreEdit(edit);
 assert.equal(raw['Notes/A.md'],initial['Notes/A.md'],'revert restores the exact bytes');
});

test('outline changes stack on the staged preview and cancel out cleanly',async()=>{
 reset();
 const view=makeView(makeButler()),batches=new Map();
 await view.tool('read_note',{path:'Notes/A.md'},log,batches);
 await view.tool('propose_outline',{path:'Notes/A.md',op:'move',heading:'Other',position:'up',reason:'r'},log,batches);
 assert.ok(batches.get('Notes/A.md').edit.after.indexOf('# Other')<batches.get('Notes/A.md').edit.after.indexOf('# Head'));
 const back=await view.tool('propose_outline',{path:'Notes/A.md',op:'move',heading:'Head',position:'up',reason:'r'},log,batches);
 assert.match(back,/cancel out/);
 assert.equal(batches.has('Notes/A.md'),false);
});

test('propose_outline refuses unread notes, drawings, canvases and bad arguments',async()=>{
 reset();
 const view=makeView(makeButler()),batches=new Map();
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'rename',heading:'Head',title:'x',reason:'r'},log,batches),/Read this note/);
 await view.tool('read_note',{path:'Notes/Drawing.md'},log,batches);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/Drawing.md',op:'insert',title:'x',reason:'r'},log,batches),/plain Markdown notes/);
 await view.tool('read_canvas',{path:'Notes/D.canvas'},log,batches).catch(()=>{});
 await assert.rejects(view.tool('propose_outline',{path:'Notes/D.canvas',op:'insert',title:'x',reason:'r'},log,batches),/plain Markdown notes|Read this note/);
 await view.tool('read_note',{path:'Notes/A.md'},log,batches);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'explode',reason:'r'},log,batches),/op must be/);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'move',heading:'Head',reason:'r'},log,batches),/Give position/);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'level',heading:'Head',shift:'1',reason:'r'},log,batches),/must be an integer/);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'rename',heading:'Nope',title:'x',reason:'r'},log,batches),/No heading "Nope"/);
});

test('propose_properties renames and sets through the line editor, keeping comments',async()=>{
 reset();
 const butler=makeButler(),view=makeView(butler),batches=new Map();
 await view.tool('read_note',{path:'Notes/A.md'},log,batches);
 const result=await view.tool('propose_properties',{path:'Notes/A.md',rename:{status:'state'},set:{tags:'b'},reason:'r'},log,batches);
 assert.match(result,/Property changes queued/);
 assert.match(result,/tags kept as a list/);
 const edit=batches.get('Notes/A.md').edit;
 assert.ok(edit.after.startsWith('---\n# keep me\nstate: draft\ntags:\n  - b\n---\n# Head\n'),edit.after);
 await butler.apply(edit);
 await butler.restoreEdit(edit);
 assert.equal(raw['Notes/A.md'],initial['Notes/A.md']);
 await assert.rejects(view.tool('propose_properties',{path:'Notes/A.md',rename:{status:3},reason:'r'},log,batches),/rename object/);
});

test('properties on a note larger than the proposal cap stage only the new block',async()=>{
 reset();
 const view=makeView(makeButler()),batches=new Map();
 await view.tool('read_note',{path:'Notes/Big.md'},log,batches);
 const result=await view.tool('propose_properties',{path:'Notes/Big.md',set:{status:'new'},reason:'r'},log,batches);
 assert.match(result,/Property changes queued/);
 assert.ok(batches.get('Notes/Big.md').edit.after.startsWith('---\nstatus: new\n---\n# Big\n'));
});

test('the active-note context block is bounded, cache-fed and excluded-folder safe',()=>{
 reset();
 const view=makeView(makeButler());
 const block=view.noteContext('Notes/A.md',initial['Notes/A.md'].replace(/\r\n/g,'\n'));
 assert.ok(block.length<=NOTE_CONTEXT_LIMIT);
 assert.match(block,/Properties: status: draft; tags: \[a\]/);
 assert.match(block,/Outline:\n# Head\n  ## Sub\n# Other/);
 assert.match(block,/Unresolved links \(1, no such note\): Missing note/);
 assert.match(block,/Backlinks \(1\): Notes\/B\.md/);
 assert.ok(!block.includes('Private'),'excluded backlinks are left out');
 assert.match(view.noteContext('Notes/A.md','---\nnot yaml line\n---\nx'),/not valid YAML/);
});

test('propose_outline keeps the top-title guard of propose_edit',async()=>{
 reset();
 const butler=makeButler();butler.inlineTitle=()=>undefined;
 const view=makeView(butler),batches=new Map();
 await view.tool('read_note',{path:'Notes/A.md'},log,batches);
 await assert.rejects(view.tool('propose_outline',{path:'Notes/A.md',op:'rename',heading:'Head',title:'Start',reason:'r'},log,batches),/inline title|top title/i);
 const ok=await view.tool('propose_outline',{path:'Notes/A.md',op:'rename',heading:'Sub',title:'Part',reason:'r'},log,batches);
 assert.match(ok,/Outline change queued/);
});
