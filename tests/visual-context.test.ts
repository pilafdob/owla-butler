// Regression tests for the current-file context (visualContext) and the
// one-message image routing decision. A drawing the Excalidraw plugin opens
// can be a `.excalidraw.md`, a `.excalidraw` JSON file or a plain `.md` note
// with the plugin's `excalidraw-plugin` frontmatter key; all three must be
// recognised as the active file, by their open view or by their frontmatter.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */

let Butler:any,ButlerView:any,obsidian:any;
let scratch:string,vault:string;

const FILES=['Notes/Drawing.md','Notes/Plain.md','Excalidraw/Drawing.excalidraw.md','Excalidraw/Legacy.excalidraw','Excalidraw/Map.canvas'];
const DRAWING_NOTE='---\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n';

before(async()=>{
 ({Butler,ButlerView,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-visual-context-'));
 vault=join(scratch,'Vault');
 mkdirSync(join(vault,'Notes'),{recursive:true});
 mkdirSync(join(vault,'Excalidraw'),{recursive:true});
 writeFileSync(join(vault,'Notes/Drawing.md'),DRAWING_NOTE);
 writeFileSync(join(vault,'Notes/Plain.md'),'# Plain note\n');
 writeFileSync(join(vault,'Excalidraw/Drawing.excalidraw.md'),DRAWING_NOTE);
 writeFileSync(join(vault,'Excalidraw/Legacy.excalidraw'),'{"type":"excalidraw","version":2,"elements":[]}');
 writeFileSync(join(vault,'Excalidraw/Map.canvas'),'{"nodes":[],"edges":[]}');
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

/** A workspace whose most recent leaf is `leaf`; `frontmatter` is the metadata cache. */
function makeApp(leaf:any,frontmatter:Record<string,Record<string,unknown>|null>={},activeFile:any=null){
 const fileMap=new Map(FILES.map(path=>[path,(()=>{const file=new obsidian.TFile(path);file.stat={size:10};return file;})()]));
 return {
  vault:{
   adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',
   getMarkdownFiles:()=>[...fileMap.values()].filter(file=>file.extension==='md'),
   getFiles:()=>[...fileMap.values()],getAllFolders:()=>[],getFolderByPath:()=>null,
   getFileByPath:(path:string)=>fileMap.get(path)??null,
   getAbstractFileByPath:(path:string)=>fileMap.get(path)??null,
   cachedRead:async(file:any)=>file.path==='Notes/Drawing.md'?DRAWING_NOTE:'',
   read:async(file:any)=>file.path==='Notes/Drawing.md'?DRAWING_NOTE:'',
  },
  workspace:{
   getMostRecentLeaf:()=>leaf??null,getLeavesOfType:()=>leaf?[leaf]:[],
   getActiveViewOfType:()=>null,getActiveFile:()=>activeFile??leaf?.view?.file??null,
  },
  metadataCache:{resolvedLinks:{},getFileCache:(file:any)=>({frontmatter:frontmatter[file.path]??null})},
 };
}
function makeButler(app:any){
 const butler=new Butler(app,{id:'owla-butler',version:'test'});
 butler.app=app;
 butler.prefs.storageRoot=join(scratch,'storage');
 butler.visualFeatures=()=>({canvas:true,bases:true,excalidraw:true});
 return butler;
}
function leafOf(path:string,viewType:string){
 const file=new obsidian.TFile(path);file.stat={size:10};
 const view={file,getViewType:()=>viewType};
 return {view,app:null,file};
}
function contextFor(path:string,viewType:string,frontmatter:Record<string,Record<string,unknown>|null>={},notes:string[]=[]){
 const leaf=leafOf(path,viewType);
 const app=makeApp(leaf,frontmatter);
 const view=new ButlerView({app},makeButler(app));
 return view.visualContext(undefined,notes);
}

test('a plain .md drawing opened in the Excalidraw view is the active file',()=>{
 const frontmatter={[('Notes/Drawing.md')]:{'excalidraw-plugin':'parsed'}};
 const result=contextFor('Notes/Drawing.md','excalidraw',frontmatter);
 assert.match(result.context,/ACTIVE FILE: Notes\/Drawing\.md \(Obsidian excalidraw\)\. Read it with read_excalidraw/);
 assert.equal(result.active,'Notes/Drawing.md');
 assert.equal(result.needsImage,true);
});

test('a plain .md drawing opened as Markdown is recognised by its frontmatter',()=>{
 const frontmatter={[('Notes/Drawing.md')]:{'excalidraw-plugin':'parsed'}};
 const result=contextFor('Notes/Drawing.md','markdown',frontmatter);
 assert.match(result.context,/ACTIVE FILE: Notes\/Drawing\.md \(Obsidian excalidraw\)/);
 assert.equal(result.active,'Notes/Drawing.md');
 assert.equal(result.needsImage,true);
});

test('a plain note without the frontmatter key is not a drawing',()=>{
 const result=contextFor('Notes/Plain.md','markdown',{[('Notes/Plain.md')]:null});
 assert.equal(result.context,'');
 assert.equal(result.active,undefined);
 assert.equal(result.needsImage,false);
});

test('the active file is used when the most recent leaf has no file',()=>{
 const frontmatter={[('Notes/Drawing.md')]:{'excalidraw-plugin':'parsed'}};
 const active=new obsidian.TFile('Notes/Drawing.md');active.stat={size:10};
 const app=makeApp({view:{getViewType:()=>'empty'}},frontmatter,active);
 const view=new ButlerView({app},makeButler(app));
 const result=view.visualContext(undefined,[]);
 assert.match(result.context,/ACTIVE FILE: Notes\/Drawing\.md \(Obsidian excalidraw\)/);
 assert.equal(result.active,'Notes/Drawing.md');
 assert.equal(result.needsImage,true);
 assert.equal(view.activeCanvasOrDrawingNeedsImage(),true);
});

test('.excalidraw.md, .excalidraw JSON and canvas views keep their kinds',()=>{
 for(const [path,viewType] of [['Excalidraw/Drawing.excalidraw.md','excalidraw'],['Excalidraw/Legacy.excalidraw','excalidraw'],['Excalidraw/Map.canvas','canvas']] as const){
  const result=contextFor(path,viewType);
  assert.match(result.context,new RegExp('ACTIVE FILE: '+path.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+' \\(Obsidian '+(viewType==='canvas'?'canvas':'excalidraw')+'\\)'));
  assert.equal(result.active,path);
  assert.equal(result.needsImage,true);
 }
});

test('an attached plain .md drawing is listed and asks for an image-capable model',()=>{
 const frontmatter={[('Notes/Drawing.md')]:{'excalidraw-plugin':'parsed'}};
 const result=contextFor('Notes/Plain.md','markdown',frontmatter,['Notes/Drawing.md']);
 assert.equal(result.context,'\nATTACHED FILES: Notes/Drawing.md → read_excalidraw (visual=true to see it)');
 assert.deepEqual(result.attached,['Notes/Drawing.md']);
 assert.equal(result.needsImage,true);
});

test('the one-message image decision follows the open drawing',()=>{
 const frontmatter={[('Notes/Drawing.md')]:{'excalidraw-plugin':'parsed'}};
 const leaf=leafOf('Notes/Drawing.md','excalidraw');
 const app=makeApp(leaf,frontmatter);
 const view=new ButlerView({app},makeButler(app));
 assert.equal(view.activeCanvasOrDrawingNeedsImage(),true);
 const plain=leafOf('Notes/Plain.md','markdown');
 const plainApp=makeApp(plain,{[('Notes/Plain.md')]:null});
 const plainView=new ButlerView({app:plainApp},makeButler(plainApp));
 assert.equal(plainView.activeCanvasOrDrawingNeedsImage(),false);
});

test('picture cache keys follow the exact content drawn',async()=>{
 const {pictureKey}=await import('../src/main');
 assert.equal(pictureKey('canvas','a.canvas','{}'),pictureKey('canvas','a.canvas','{}'));
 assert.notEqual(pictureKey('canvas','a.canvas','{}'),pictureKey('canvas','a.canvas','{"nodes":[]}'));
 assert.notEqual(pictureKey('canvas','a.canvas','{}'),pictureKey('excalidraw','a.canvas','{}'));
});
