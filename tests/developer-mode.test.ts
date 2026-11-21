// Developer mode: settings contract, Butler wiring, diagnostics assembly and
// session save/export gating. The journal and report internals have their own
// suites (dev-journal.test.ts, dev-report.test.ts); this file pins the seams.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {migrateSettings,readSettings,writeSettings,DEFAULTS} from '../src/core';
import {loadMain} from './helpers/load-main';

/* eslint-disable @typescript-eslint/no-explicit-any */
let Butler:any,obsidian:any;
let scratch:string;

before(async()=>{
 ({Butler,obsidian}=await loadMain());
 scratch=mkdtempSync(join(tmpdir(),'owla-dev-mode-'));
 (globalThis as any).window??=new EventTarget();
});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

function makeApp(vault:string):any{
 return {
  vault:{adapter:new obsidian.FileSystemAdapter(vault),getName:()=>'Vault',getMarkdownFiles:()=>[],getFileByPath:()=>null},
  workspace:{on:()=>{},onLayoutReady:()=>{},getActiveViewOfType:()=>null,getLeavesOfType:()=>[]},
  metadataCache:{resolvedLinks:{},unresolvedLinks:{},getFileCache:()=>null},
 };
}
function makeButler(storage:string,app:any=makeApp(join(storage,'Vault'))){
 const butler=new Butler(app,{id:'owla-butler',version:'t',minAppVersion:'1.14.5'});
 butler.app=app;
 Object.assign(butler.prefs,{storageRoot:storage});
 return butler;
}

// ---------------------------------------------------------------- settings contract

test('developerMode defaults off and only a real true enables it',()=>{
 assert.equal(DEFAULTS.developerMode,false);
 assert.equal(migrateSettings({}).developerMode,false);
 assert.equal(migrateSettings({developerMode:true}).developerMode,true);
 assert.equal(migrateSettings({developerMode:'true'}).developerMode,false);
 assert.equal(migrateSettings({schemaVersion:3,developerMode:true}).developerMode,true);
});

test('developerMode survives the platform settings round trip and is shared',()=>{
 const prefs={...DEFAULTS,developerMode:true};
 const stored=writeSettings(prefs,{},'mac');
 assert.equal((stored as any).developerMode,true);
 // Another platform reads the shared toggle, not a per-platform copy.
 assert.equal(readSettings(stored,'windows').developerMode,true);
 const off=readSettings(writeSettings({...prefs,developerMode:false},stored,'mac'),'mac');
 assert.equal(off.developerMode,false);
});

// ---------------------------------------------------------------- onload wiring

test('onload enables the journal from saved settings and registers gated commands',async()=>{
 const storage=join(scratch,'onload');
 const app=makeApp(join(storage,'Vault'));
 const fake=Object.create(Butler.prototype);
 const commands=new Map<string,any>();
 const stopped=Symbol('stopped');
 Object.assign(fake,{
  app,
  loadData:async()=>({schemaVersion:3,developerMode:true,platforms:{mac:{}}}),
  saveData:async()=>{},
  saveQueue:Promise.resolve(),
  prefs:{...DEFAULTS,storageRoot:storage},
  devJournal:new (await import('../src/dev-journal')).DevJournal(),
  sessionAvailability:{load:()=>{}},
  codexBridge:{onStatus:null},opencodeBridge:{onStatus:null},claudeBridge:{onStatus:null},hermesBridge:{onStatus:null},
  registerEditorExtension:()=>{},registerView:()=>{},addRibbonIcon:()=>{},
  addCommand:(command:any)=>{commands.set(command.id,command);},
  registerEvent:()=>{},registerDomEvent:()=>{},
  addSettingTab:()=>{throw stopped;},
 });
 try{await fake.onload();}catch(e){if(e!==stopped)throw e;}
 assert.equal(fake.prefs.developerMode,true);
 assert.equal(fake.devJournal.enabled,true);
 const save=commands.get('save-developer-session'),download=commands.get('download-diagnostics');
 assert.ok(save&&download,'developer commands are registered');
 assert.equal(save.checkCallback(true),true);
 assert.equal(download.checkCallback(true),true);
 fake.prefs.developerMode=false;
 assert.equal(save.checkCallback(true),false,'commands hide while developer mode is off');
 assert.equal(download.checkCallback(true),false);
});

test('onload with developer mode off leaves the journal disabled',async()=>{
 const storage=join(scratch,'onload-off');
 const app=makeApp(join(storage,'Vault'));
 const fake=Object.create(Butler.prototype);
 const stopped=Symbol('stopped');
 Object.assign(fake,{
  app,
  loadData:async()=>({}),saveData:async()=>{},
  saveQueue:Promise.resolve(),
  prefs:{...DEFAULTS,storageRoot:storage},
  devJournal:new (await import('../src/dev-journal')).DevJournal(),
  sessionAvailability:{load:()=>{}},
  codexBridge:{onStatus:null},opencodeBridge:{onStatus:null},claudeBridge:{onStatus:null},hermesBridge:{onStatus:null},
  registerEditorExtension:()=>{},registerView:()=>{},addRibbonIcon:()=>{},
  addCommand:()=>{},registerEvent:()=>{},registerDomEvent:()=>{},
  addSettingTab:()=>{throw stopped;},
 });
 try{await fake.onload();}catch(e){if(e!==stopped)throw e;}
 assert.equal(fake.devJournal.enabled,false);
 assert.equal(fake.devJournal.startTurn({prompt:'x',provider:'codex',model:'m',effort:'',automatic:false,web:true,contextChars:0,estimatedInputTokens:0}),null);
});

// ---------------------------------------------------------------- toggle + persistence

test('setDeveloperMode persists the shared toggle and gates recording',async()=>{
 const storage=join(scratch,'toggle');
 const butler=makeButler(storage);
 const saved:any[]=[];
 butler.loadData=async()=>({});
 butler.saveData=async(data:any)=>{saved.push(data);};
 await butler.setDeveloperMode(true);
 assert.equal(butler.prefs.developerMode,true);
 assert.equal(butler.devJournal.enabled,true);
 assert.equal(saved.at(-1).developerMode,true);
 assert.ok(butler.devJournal.events().some((e:any)=>e.kind==='developer-mode-enabled'));
 const turn=butler.devJournal.startTurn({prompt:'hello',provider:'codex',model:'m',effort:'',automatic:false,web:true,contextChars:10,estimatedInputTokens:3});
 assert.ok(turn,'recording works while enabled');
 await butler.setDeveloperMode(false);
 assert.equal(butler.devJournal.enabled,false);
 assert.ok(butler.devJournal.events().some((e:any)=>e.kind==='developer-mode-disabled'),'the stop marker is recorded before the gate closes');
 assert.equal(butler.devJournal.startTurn({prompt:'again',provider:'codex',model:'m',effort:'',automatic:false,web:true,contextChars:0,estimatedInputTokens:0}),null);
 assert.equal(saved.at(-1).developerMode,false);
});

// ---------------------------------------------------------------- diagnostics assembly

test('developerDiagnostics collects every report section from the live plugin state',()=>{
 const storage=join(scratch,'diag');
 const butler=makeButler(storage);
 butler.prefs.developerMode=true;
 butler.devJournal.enabled=true;
 const report=butler.developerDiagnostics();
 assert.equal(report.kind,'owla-diagnostics');
 assert.equal(report.plugin.version,'t');
 assert.equal(report.vault.name,'Vault');
 for(const key of ['developerMode','webSearch','pluginInterconnectivity','visualScreenshots','automaticProvider','automaticRouting','routingMode','diffView','fallback','codexConnected','opencodeConnected','claudeConnected','hermesConnected','canvas','bases','excalidraw']){
  assert.ok(key in report.features,'features include '+key);
 }
 assert.equal(report.providers.length,4);
 for(const provider of report.providers){
  assert.ok('usageWindows' in provider&&'exhaustion' in provider&&'sessionDirectory' in provider);
 }
 assert.ok(Array.isArray(report.savedChats));
 assert.ok(Array.isArray(report.routingHistory));
 assert.ok(report.currentSession&&Array.isArray(report.currentSession.turns));
 assert.ok(report.totals&&report.performance&&report.ruleViolations&&report.loss);
 assert.ok(report.loss.data&&report.loss.tokens&&report.loss.quality);
 assert.ok(report.notes.length>=3,'honest limitations are listed');
 assert.equal(report.settings.developerMode,true);
});

// ---------------------------------------------------------------- session save/export

test('developer session save is gated, then persists a readable session',()=>{
 const storage=join(scratch,'session');
 const butler=makeButler(storage);
 assert.throws(()=>butler.saveDeveloperSession(),/Developer mode/);
 assert.throws(()=>butler.downloadDeveloperSession(),/Developer mode/);
 assert.throws(()=>butler.downloadDeveloperDiagnostics(),/Developer mode/);
 butler.prefs.developerMode=true;
 butler.devJournal.enabled=true;
 assert.throws(()=>butler.saveDeveloperSession(),/No recorded turns/);
 const turn=butler.devJournal.startTurn({prompt:'Summarise my note',provider:'codex',model:'gpt-5',effort:'medium',automatic:false,web:true,contextChars:120,estimatedInputTokens:40});
 assert.ok(turn);
 const call=butler.devJournal.toolStart(turn,'read_note',{path:'Notes/A.md'});
 assert.notEqual(call,null);
 butler.devJournal.toolEnd(turn,call,{ok:true,result:'# A',durationMs:5});
 butler.devJournal.endTurn(turn,{ok:true,reply:'Done.',latencyMs:120,estimatedOutputTokens:2,provider:'codex',model:'gpt-5',effort:'medium',attempts:1,escalations:0,retries:0});
 const meta=butler.saveDeveloperSession();
 assert.equal(meta.turns,1);
 assert.equal(meta.toolCalls,1);
 const sessions=butler.devJournal.listSessions(butler.vaultStorage());
 assert.equal(sessions.length,1);
 const read=butler.devJournal.readSession(butler.vaultStorage(),meta.id);
 assert.equal(read.kind,'owla-developer-session');
 assert.equal(read.turns[0].toolCalls[0].name,'read_note');
 assert.equal(read.totals.toolCalls,1);
 // The session file lives in OWLA private storage, never the vault.
 const dir=join(butler.vaultStorage(),'developer','sessions');
 assert.ok(existsSync(dir)&&readdirSync(dir).length===1);
 assert.ok(!existsSync(join(storage,'Vault','developer')));
 butler.clearDeveloperData();
 assert.equal(butler.devJournal.listSessions(butler.vaultStorage()).length,0);
 assert.equal(butler.devJournal.counts().turns,0);
});

test('a disabled journal records nothing through the Butler seam',()=>{
 const storage=join(scratch,'off-seam');
 const butler=makeButler(storage);
 assert.equal(butler.developerMode,false);
 assert.equal(butler.devJournal.startTurn({prompt:'x',provider:'codex',model:'m',effort:'',automatic:false,web:true,contextChars:0,estimatedInputTokens:0}),null);
 butler.devJournal.event('turn-error','should not be stored');
 assert.equal(butler.devJournal.counts().events,0);
 assert.equal(butler.devJournal.exportSession({pluginVersion:'t',vaultName:'Vault',history:[]}),null);
});