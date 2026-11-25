import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,readFileSync,rmSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DevJournal} from '../src/dev-journal';
import {DEV_LIMITS} from '../src/dev-types';
import {redactSensitive} from '../src/validation';
import {loadMain} from './helpers/load-main';

test('diagnostics report the Obsidian API version (app.appVersion does not exist)',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-review-appversion-'));
 try{
  const {Butler,obsidian}=await loadMain();
  const app={
   vault:{adapter:new obsidian.FileSystemAdapter(join(root,'Vault')),getName:()=>'Vault',getMarkdownFiles:()=>[],getFileByPath:()=>null},
   workspace:{on:()=>{},onLayoutReady:()=>{},getActiveViewOfType:()=>null,getLeavesOfType:()=>[]},
   metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null},
  };
  const butler=new Butler(app,{id:'owla-butler',version:'3.7.0',minAppVersion:'1.8.0'});
  Object.assign(butler.prefs,{storageRoot:root});
  const report=butler.developerDiagnostics();
  assert.equal(typeof obsidian.apiVersion,'string','the obsidian module exposes apiVersion');
  assert.equal(report.plugin.obsidianVersion,obsidian.apiVersion);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('disabling developer mode persists its final marker before recording stops',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-review-disable-'));
 try{
  const {Butler}=await loadMain();
  const app={vault:{getName:()=>'Test'},workspace:{}};
  const butler=new Butler(app,{id:'owla-butler',version:'3.7.0'});
  butler.vaultStorage=()=>root;butler.save=async()=>{};
  await butler.setDeveloperMode(true);
  await butler.setDeveloperMode(false);
  const persisted=JSON.parse(readFileSync(join(root,'developer','journal.json'),'utf8'));
  assert.ok(persisted.events.some((event:{kind:string})=>event.kind==='developer-mode-disabled'));
  const before=readFileSync(join(root,'developer','journal.json'),'utf8');
  butler.devJournal.event('turn-error','must not be written');butler.devJournal.save(root);
  assert.equal(readFileSync(join(root,'developer','journal.json'),'utf8'),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('diagnostic error redaction handles JSON-quoted credential keys',()=>{
 const value=['synthetic','credential','with spaces'].join('-');
 for(const key of ['api'+'_key','access'+'_token','client'+'_secret','password']){
  const redacted=redactSensitive(JSON.stringify({[key]:value}));
  assert.ok(!redacted.includes(value),key+' must not escape in a JSON error');
  assert.ok(redacted.includes('[redacted]'));
 }
});

function session(journal:DevJournal){
 return journal.exportSession({pluginVersion:'3.7.0',vaultName:'Test',history:[]})!;
}
function recorded(){
 const journal=new DevJournal();journal.enabled=true;
 const id=journal.startTurn({prompt:'test',provider:'codex',model:'test',effort:'',automatic:false,web:false,contextChars:0,estimatedInputTokens:1})!;
 journal.endTurn(id,{ok:true,reply:'done',latencyMs:1,estimatedOutputTokens:1,provider:'codex',model:'test',effort:'',attempts:1,escalations:0,retries:0});
 return journal;
}

test('starting a new chat persists the rotated chat id (survives a reload)',async()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-review-newchat-'));
 try{
  const {Butler,ButlerView}=await loadMain();
  const app={vault:{getName:()=>'Test'},workspace:{}};
  const butler=new Butler(app,{id:'owla-butler',version:'3.7.0'});
  butler.vaultStorage=()=>root;
  butler.organization={blocked:false,review:undefined,progress:undefined,busy:false,loadError:''};
  butler.prefs.developerMode=true;butler.devJournal.enabled=true;
  const turn=butler.devJournal.startTurn({prompt:'old chat',provider:'codex',model:'m',effort:'',automatic:false,web:false,contextChars:0,estimatedInputTokens:1})!;
  butler.devJournal.endTurn(turn,{ok:true,reply:'done',latencyMs:1,estimatedOutputTokens:1,provider:'codex',model:'m',effort:'',attempts:1,escalations:0,retries:0});
  butler.devJournal.save(root);
  const oldChat=butler.devJournal.chatId;
  const view=new ButlerView({app},butler);
  // newChat() touches rendered DOM; stand-ins keep the seam test renderer-free.
  view.automaticLabel={setText(){}};view.renderAttachments=()=>{};view.feed={empty(){}};
  view.composer={value:'draft'};view.status={setText(){}};view.stop=()=>{};view.clearWarmup=()=>{};
  assert.equal(view.newChat(),true);
  assert.notEqual(butler.devJournal.chatId,oldChat);
  const reloaded=new DevJournal();reloaded.load(root);
  assert.equal(reloaded.chatId,butler.devJournal.chatId,'the rotation must survive a plugin reload');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('load never follows a symlinked journal file (F8 parity with sessions)',t=>{
 const root=mkdtempSync(join(tmpdir(),'owla-review-symlink-'));
 try{
  const outside=join(root,'outside.json');
  writeFileSync(outside,JSON.stringify({version:1,chatId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',turns:[],events:[]}));
  mkdirSync(join(root,'developer'),{recursive:true});
  try{symlinkSync(outside,join(root,'developer','journal.json'));}
  catch(error){
   // Windows needs Developer Mode or admin rights for a file symlink.
   if(process.platform==='win32'&&(error as NodeJS.ErrnoException).code==='EPERM'){t.skip('file symlinks need Developer Mode or admin rights on Windows');return;}
   throw error;
  }
  const journal=new DevJournal();const fresh=journal.chatId;
  journal.load(root);
  assert.equal(journal.chatId,fresh,'a symlinked journal must be ignored');
  assert.equal(journal.turns().length,0);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('session retention reserves a slot for the new file after the clock moves backwards',()=>{
 const root=mkdtempSync(join(tmpdir(),'owla-review-retention-'));
 try{
  const journal=recorded();
  const newer=session(journal);newer.savedAt='2030-01-01T00:00:00.000Z';
  for(let i=0;i<DEV_LIMITS.maxSavedSessions;i++)journal.saveSession(root,newer);
  const older=session(journal);older.savedAt='2020-01-01T00:00:00.000Z';
  const saved=journal.saveSession(root,older);
  assert.ok(journal.readSession(root,saved.id),'the new file is protected');
  assert.equal(readdirSync(join(root,'developer','sessions')).length,DEV_LIMITS.maxSavedSessions);
  assert.ok(journal.listSessions(root).some(meta=>meta.id===saved.id),'the protected file remains accessible in settings');
 }finally{rmSync(root,{recursive:true,force:true});}
});
