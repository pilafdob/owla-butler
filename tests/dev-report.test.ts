import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildDiagnosticsReport,classifyToolError,redactSensitive,renderMarkdownReport} from '../src/dev-report';
import {DEV_LIMITS,computeDevTotals,percentile,type DevEvent,type DevToolCall,type DevTurn,type DiagnosticsInput,type ProviderDiagnostics,type ToolErrorClass} from '../src/dev-types';
import type {ButlerSettings} from '../src/core';
import type {SavedChat} from '../src/chats';
import {usageWindows} from '../src/usage';

// Credential-shaped fixtures are assembled at runtime so no complete key
// shape exists as a literal in this source file.
const SK='sk-'+'abcdefgh12345678';
const GHP='ghp_'+'1234567890ABCDEF';
const XOX='xoxb-'+'123456789012-abcdef';
const AKV='abcd'+'1234efgh';
const RED='[redacted]';
const T0='2026-11-21T10:00:00.000Z';
const iso=(offsetMs:number)=>new Date(Date.parse(T0)+offsetMs).toISOString();
function makeCall(overrides:Partial<DevToolCall>={}):DevToolCall{
 return {index:0,name:'read_note',args:'{"path":"Note.md"}',startedAt:T0,durationMs:120,ok:true,result:'note text',...overrides};
}
function makeTurn(overrides:Partial<DevTurn>={}):DevTurn{
 return {id:'turn-1',chatId:'chat-1',startedAt:T0,endedAt:iso(5000),prompt:'Summarize Note.md',reply:'Done.',provider:'codex',model:'gpt-5-codex',effort:'medium',automatic:false,web:false,ok:true,error:null,latencyMs:5000,estimatedInputTokens:100,estimatedOutputTokens:50,contextChars:350,attempts:1,escalations:0,retries:0,toolCalls:[makeCall()],...overrides};
}
function makeEvent(overrides:Partial<DevEvent>={}):DevEvent{
 return {id:1,at:T0,kind:'developer-mode-enabled',chatId:'chat-1',detail:'',...overrides};
}
function makeProvider(overrides:Partial<ProviderDiagnostics>={}):ProviderDiagnostics{
 return {id:'codex',name:'Codex',connected:true,status:'Connected to Codex · Plus',version:'0.162.1',plan:'Plus',accountType:'chatgpt',executable:'codex',sessionDirectory:'/Users/test/.codex/sessions',usage:{rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1793890000},secondary:{usedPercent:80,windowDurationMins:10080,resetsAt:1794000000}}}},usageUpdatedAt:1793880000,usageError:'',exhaustion:{provider:'codex',exhausted:false,resetsAt:null,reason:'',scope:'provider'},modelPrefs:{model:'gpt-5-codex',reasoning:'medium'},offeredModels:8,selectableModels:8,ready:true,running:false,needsSignIn:false,...overrides};
}
function makeSettings():ButlerSettings{
 return {schemaVersion:3,provider:'codex',automaticProvider:false,codexConnected:true,opencodeConnected:false,claudeConnected:false,hermesConnected:false,codexExecutable:'codex',hermesExecutable:'',fallback:'opencode',opencodeExecutable:'opencode',claudeExecutable:'',models:{codex:{model:'gpt-5-codex',reasoning:'medium'},opencode:{model:'',reasoning:''},claude:{model:'',reasoning:''},hermes:{model:'',reasoning:''}},modelUnavailability:[],automaticRouting:true,routingMode:'balance',routingPrivacyMode:false,routingThorough:true,showRoutingDetails:true,webSearch:true,pluginInterconnectivity:false,visualScreenshots:true,diffView:'highlights',storageRoot:'/Users/test/.owla',excludedFolders:'Private',developerMode:true};
}
function makeInput(overrides:Partial<DiagnosticsInput>={}):DiagnosticsInput{
 return {generatedAt:iso(300000),pluginVersion:'3.7.0',minAppVersion:'1.8.0',obsidianVersion:'1.10.0',platform:'darwin',platformKey:'mac',vaultName:'Test Vault',vaultStoragePath:'/Users/test/.owla/Test Vault',storageRoot:'/Users/test/.owla',settings:makeSettings(),automaticSelectionAvailable:true,visualFeatures:{canvas:true,bases:false,excalidraw:true},providers:[makeProvider(),makeProvider({id:'opencode',name:'OpenCode',connected:false,status:'Not connected',version:'',plan:'',accountType:'',executable:'opencode',sessionDirectory:'/Users/test/.local/share/opencode',usage:null,usageError:'OpenCode did not return readable usage limits.',exhaustion:{provider:'opencode',exhausted:false,resetsAt:null,reason:'',scope:'provider'},modelPrefs:{model:'',reasoning:''},offeredModels:0,selectableModels:0,ready:false,running:false,needsSignIn:false})],modelUnavailability:[],routingHistory:{codex:{'gpt-5-codex':{lookup:{success:3,fail:1,latencyMs:[900,1100,1300],lastUsedAt:1793880000},edit:{success:2,fail:0,latencyMs:[2000,2400],lastUsedAt:1793880500}}}},savedChats:[{id:'0b9d6a62-1c4f-4c9e-9b2a-7d5e8f1a2b3c',title:'Saved chat',created:'2026-11-20T09:00:00.000Z',messages:[{role:'user',content:'Hi'},{role:'assistant',content:'Hello'}]}],journal:{chatId:'chat-1',turns:[makeTurn()],events:[makeEvent()]},pendingEdits:[],pendingLoadError:'',editBackupCount:0,...overrides};
}

test('classifyToolError maps the real guard messages and falls back to other',()=>{
 const cases:[string,ToolErrorClass][]=[
  ['This tool is not available in this mode.','unoffered-tool'],
  ['OWLA did not offer that tool in this turn.','unoffered-tool'],
  ['Unknown OWLA tool.','unoffered-tool'],
  ['This note is outside the allowed Markdown context.','path-refused'],
  ['This file is excluded.','path-refused'],
  ['This file is excluded from OWLA Butler.','path-refused'],
  ['Provide an allowed vault-relative path.','path-refused'],
  ['Provide an allowed vault-relative Markdown path.','path-refused'],
  ['Choose an allowed vault folder.','path-refused'],
  ['A destination is outside the allowed vault paths.','path-refused'],
  ['A descendant would move into an excluded path.','path-refused'],
  ['The output folder is excluded.','path-refused'],
  ['This vault path is unavailable.','path-refused'],
  ['A pending edit path is no longer allowed: Private/Note.md','path-refused'],
  ['The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.','stale-snapshot'],
  ['Keep the filename out of the top Markdown heading. Revise the proposal to edit the note body.','title-rule'],
  ['The inline title setting is unavailable. Preserve the top title and edit the note body.','title-rule'],
  ['The proposed edit is too large. Make a smaller edit.','edit-too-large'],
  ['This reply has used 40 tool calls. Do not call more tools. Answer now with what you have and say what is still missing.','budget'],
  ['This exact call already returned the same result. Use that result, read a different heading or offset, or answer now.','repeat'],
  ['Stopped.','stopped'],
  ['The original passage was not found. Read the note again.','other'],
  ['Read this note before proposing an edit.','other'],
  ['Codex returned no usable models for this account.','other'],
  ['','other'],
 ];
 for(const [message,expected]of cases)assert.equal(classifyToolError(message),expected,message);
});

test('redactSensitive strips Bearer tokens, key shapes and credential assignments',()=>{
 assert.equal(redactSensitive('Authorization: '+'Bearer abc123DEF456'),'Authorization='+'[redacted] [redacted]');
 assert.equal(redactSensitive('Bearer abc123DEF456'),'Bearer [redacted]');
 assert.equal(redactSensitive('failed with Bearer abc123!def456 tail'),'failed with Bearer [redacted] tail');
 assert.equal(redactSensitive('key '+SK+' leaked'),'key '+RED+' leaked');
 assert.equal(redactSensitive('token '+GHP),'token '+RED);
 assert.equal(redactSensitive('slack '+XOX),'slack '+RED);
 assert.equal(redactSensitive('key-abcdefgh12345678'),'[redacted]');
 assert.equal(redactSensitive('password=hunter2'),'password=[redacted]');
 assert.equal(redactSensitive('api_key: "sk-secret value with spaces"'),'api'+'_key='+RED);
 assert.equal(redactSensitive("secret='top secret phrase'"),'secret=[redacted]');
 assert.equal(redactSensitive('my API'+'_KEY='+AKV),'my API'+'_KEY='+RED);
});
test('redactSensitive never mangles ordinary prose',()=>{
 const prose=[
  'The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.',
  'Read the note again and summarize the second heading.',
  'The task-1234567890 identifier and the monkey-1234567890 label stay readable.',
  'This reply has used 40 tool calls. Do not call more tools.',
 ];
 for(const text of prose)assert.equal(redactSensitive(text),text);
 assert.equal(redactSensitive(''),'');
 assert.equal(redactSensitive(redactSensitive('Bearer abc123DEF456')),'Bearer [redacted]');
});

test('buildDiagnosticsReport returns every contract key',()=>{
 const report=buildDiagnosticsReport(makeInput());
 assert.equal(report.kind,'owla-diagnostics');
 assert.equal(report.version,1);
 assert.equal(report.generatedAt,iso(300000));
 for(const key of ['generatedAt','plugin','vault','settings','features','providers','modelUnavailability','routingHistory','savedChats','currentSession','totals','performance','ruleViolations','loss','notes'])assert.ok(key in report,key);
 assert.deepEqual(report.plugin,{version:'3.7.0',minAppVersion:'1.8.0',obsidianVersion:'1.10.0',platform:'darwin',platformKey:'mac'});
 assert.deepEqual(report.vault,{name:'Test Vault',storageRoot:'/Users/test/.owla',vaultStoragePath:'/Users/test/.owla/Test Vault'});
 assert.deepEqual(report.loss.data,{editConflicts:0,proposalRejections:0,pendingEdits:0,pendingLoadError:'',editBackups:0});
 assert.equal(report.currentSession.chatId,'chat-1');
});
test('features reflect settings, visual features and provider connections',()=>{
 const report=buildDiagnosticsReport(makeInput());
 assert.deepEqual(report.features,{developerMode:true,webSearch:true,pluginInterconnectivity:false,visualScreenshots:true,automaticProvider:false,automaticRouting:true,automaticSelectionAvailable:true,routingMode:'balance',routingPrivacyMode:false,routingThorough:true,showRoutingDetails:true,diffView:'highlights',fallback:'opencode',canvas:true,bases:false,excalidraw:true,codexConnected:true,opencodeConnected:false});
});
test('settings strings are redacted without touching other values or the input',()=>{
 const input=makeInput();
 input.settings.excludedFolders='password=hunter2';
 input.settings.storageRoot=SK;
 const report=buildDiagnosticsReport(input);
 assert.equal(report.settings.excludedFolders,'password=[redacted]');
 assert.equal(report.settings.storageRoot,'[redacted]');
 assert.equal(report.settings.schemaVersion,3);
 assert.equal(report.settings.developerMode,true);
 assert.deepEqual(report.settings.models,input.settings.models);
 assert.equal(input.settings.excludedFolders,'password=hunter2');
 assert.equal(input.settings.storageRoot,SK);
});
test('modelUnavailability and savedChats pass through untouched',()=>{
 const input=makeInput();
 input.modelUnavailability=[{model:'gpt-x',reason:'blocked'}];
 const report=buildDiagnosticsReport(input);
 assert.deepEqual(report.modelUnavailability,input.modelUnavailability);
 assert.deepEqual(report.savedChats,input.savedChats);
});

test('provider usage windows come from usageWindows; usage errors and exhaustion reasons are redacted',()=>{
 const input=makeInput();
 input.providers[0].usageError='Codex failed: Bearer abc123DEF456';
 input.providers[0].exhaustion={provider:'codex',exhausted:true,resetsAt:1793890000,reason:'Codex usage limit reached. password=hunter2',scope:'provider'};
 input.providers[1].usage={rateLimitsByLimitId:{'opencode-go-rolling':{limitId:'opencode-go-rolling',limitName:'OpenCode Go',primary:{usedPercent:40,label:'Rolling window',resetsAt:1793890000}}}};
 const report=buildDiagnosticsReport(input);
 const codex=report.providers[0];
 assert.deepEqual(codex.usageWindows,usageWindows(input.providers[0].usage));
 assert.equal(codex.usageWindows.length,2);
 assert.equal(codex.usageWindows[0].used,25);
 assert.equal(codex.usageWindows[0].remaining,75);
 assert.equal(codex.usageWindows[0].window,'5-hour window');
 assert.equal(codex.usageWindows[1].window,'7-day window');
 assert.equal(codex.usageWindows[1].resetsAt,1794000000);
 assert.equal(codex.usageError,'Codex failed: Bearer [redacted]');
 assert.equal(codex.exhaustion.reason,'Codex usage limit reached. password=[redacted]');
 assert.equal(codex.exhaustion.exhausted,true);
 assert.deepEqual(report.providers[1].usageWindows,[{bucket:'OpenCode Go',window:'Rolling window',used:40,remaining:60,resetsAt:1793890000}]);
 assert.equal(input.providers[0].usageError,'Codex failed: Bearer abc123DEF456');
});
test('a provider without usage reports no windows',()=>{
 const report=buildDiagnosticsReport(makeInput());
 assert.deepEqual(report.providers[1].usageWindows,[]);
});

test('routing history rows cover each kind with shared p50 and max lastUsedAt',()=>{
 const report=buildDiagnosticsReport(makeInput());
 assert.equal(report.routingHistory.length,2);
 const lookup=report.routingHistory.find(row=>row.kind==='lookup');
 const edit=report.routingHistory.find(row=>row.kind==='edit');
 assert.ok(lookup);assert.ok(edit);
 assert.equal(lookup.provider,'codex');
 assert.equal(lookup.model,'gpt-5-codex');
 assert.equal(lookup.success,3);
 assert.equal(lookup.fail,1);
 // p50 pools both kinds: [900,1100,1300,2000,2400] → 1300.
 assert.equal(lookup.p50LatencyMs,1300);
 assert.equal(edit.p50LatencyMs,1300);
 assert.equal(lookup.lastUsedAt,1793880500);
 assert.equal(edit.lastUsedAt,1793880500);
});
test('routing rows without samples or timestamps report nulls; empty history yields no rows',()=>{
 const input=makeInput({routingHistory:{claude:{haiku:{lookup:{success:1,fail:0,latencyMs:[]}}}}});
 const report=buildDiagnosticsReport(input);
 assert.equal(report.routingHistory.length,1);
 assert.equal(report.routingHistory[0].p50LatencyMs,null);
 assert.equal(report.routingHistory[0].lastUsedAt,null);
 assert.deepEqual(buildDiagnosticsReport(makeInput({routingHistory:{}})).routingHistory,[]);
});

test('rule violations combine guard events and forbidden tool attempts, newest first',()=>{
 const input=makeInput();
 input.journal.events=[
  makeEvent({id:1,at:iso(1000),kind:'tool-budget-soft',detail:'This reply has used 40 tool calls.'}),
  makeEvent({id:2,at:iso(3000),kind:'repeat-call',detail:'read_note repeated'}),
  makeEvent({id:3,at:iso(2000),kind:'edit-conflict',detail:'conflict'}),
 ];
 input.journal.turns=[makeTurn({toolCalls:[
  makeCall({index:0,ok:false,name:'shell',error:'This tool is not available in this mode.',startedAt:iso(4000)}),
  makeCall({index:1,ok:false,name:'propose_edit',error:'This note is outside the allowed Markdown context.',startedAt:iso(500)}),
  makeCall({index:2,ok:false,name:'propose_edit',error:'The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.',startedAt:iso(5000)}),
  makeCall({index:3,ok:false,name:'propose_note',error:'Keep the filename out of the top Markdown heading. Revise the proposal to edit the note body.',startedAt:iso(6000)}),
  makeCall({index:4,ok:false,name:'propose_edit',error:'The proposed edit is too large. Make a smaller edit.',startedAt:iso(7000)}),
 ]})];
 const report=buildDiagnosticsReport(input);
 assert.equal(report.ruleViolations.length,5);
 assert.deepEqual(report.ruleViolations.map(row=>row.at),[iso(6000),iso(4000),iso(3000),iso(1000),iso(500)]);
 assert.deepEqual(report.ruleViolations.map(row=>row.kind),['title-rule','unoffered-tool','repeat-call','tool-budget-soft','path-refused']);
 assert.equal(report.ruleViolations[1].tool,'shell');
 assert.equal(report.ruleViolations[2].tool,undefined);
 assert.equal(report.totals.ruleEvents,2);
 // stale-snapshot is prevented data loss, not a rule violation.
 assert.equal(report.loss.data.editConflicts,2);
});
test('rule violations are capped at 200 rows, newest first',()=>{
 const events:DevEvent[]=[];
 for(let i=0;i<250;i++)events.push(makeEvent({id:i,at:iso(i*1000),kind:'repeat-call',detail:'repeat '+i}));
 const report=buildDiagnosticsReport(makeInput({journal:{chatId:'chat-1',turns:[],events}}));
 assert.equal(report.ruleViolations.length,200);
 assert.equal(report.ruleViolations[0].detail,'repeat 249');
 assert.equal(report.ruleViolations[199].detail,'repeat 50');
});

test('loss indicators count conflicts, rejections, trimming and empty replies',()=>{
 const input=makeInput();
 input.journal.events=[
  makeEvent({id:1,kind:'edit-conflict',at:iso(1000)}),
  makeEvent({id:2,kind:'proposal-rejected',detail:'The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.'}),
  makeEvent({id:3,kind:'proposal-rejected',detail:'User declined the edit.'}),
  makeEvent({id:4,kind:'context-shortened'}),
  makeEvent({id:5,kind:'context-shortened'}),
  makeEvent({id:6,kind:'history-trimmed'}),
  makeEvent({id:7,kind:'selections-trimmed'}),
  makeEvent({id:8,kind:'empty-reply'}),
 ];
 input.journal.turns=[
  makeTurn({id:'t1',latencyMs:1000,escalations:1,retries:2,toolCalls:[makeCall({ok:false,error:'The note changed since this proposal. Ask for a fresh edit; your newer text was preserved.'})]}),
  makeTurn({id:'t2',ok:false,error:'Codex returned no answer. Your draft is preserved.',reply:null,latencyMs:null,estimatedInputTokens:200,estimatedOutputTokens:0,toolCalls:[]}),
 ];
 input.pendingEdits=[{path:'Note.md'}];
 input.pendingLoadError='The pending edit record could not be read: password=hunter2';
 input.editBackupCount=3;
 const report=buildDiagnosticsReport(input);
 assert.equal(report.loss.data.editConflicts,3);
 assert.equal(report.loss.data.proposalRejections,2);
 assert.equal(report.loss.data.pendingEdits,1);
 assert.equal(report.loss.data.pendingLoadError,'The pending edit record could not be read: password=[redacted]');
 assert.equal(report.loss.data.editBackups,3);
 assert.equal(report.loss.tokens.contextShortened,2);
 assert.equal(report.loss.tokens.historyTrimmed,1);
 assert.equal(report.loss.tokens.selectionsTrimmed,1);
 assert.equal(report.loss.tokens.estimatedInputTokens,300);
 assert.equal(report.loss.tokens.estimatedOutputTokens,50);
 assert.ok(report.loss.tokens.note.includes('~3.5 characters per token'));
 assert.equal(report.loss.quality.escalations,1);
 assert.equal(report.loss.quality.retries,2);
 assert.equal(report.loss.quality.emptyReplies,1);
 assert.equal(report.loss.quality.turnErrors,1);
});

test('report events are capped to the newest while totals cover the full journal',()=>{
 const events:DevEvent[]=[];
 for(let i=0;i<DEV_LIMITS.maxEvents;i++)events.push(makeEvent({id:i,at:iso(i*1000),kind:i%2?'context-shortened':'history-trimmed',detail:'event '+i}));
 const input=makeInput({journal:{chatId:'chat-1',turns:[makeTurn()],events}});
 const report=buildDiagnosticsReport(input);
 assert.equal(report.currentSession.events.length,DEV_LIMITS.maxReportEvents);
 assert.equal(report.currentSession.events[0].detail,'event 200');
 assert.equal(report.currentSession.events.at(-1)?.detail,'event 499');
 assert.deepEqual(report.totals,computeDevTotals(input.journal.turns,events));
 assert.equal(report.totals.contextShortened,250);
 assert.equal(report.totals.historyTrimmed,250);
 assert.equal(report.loss.tokens.contextShortened,250);
});
test('current session redacts errors but keeps user content intact',()=>{
 const input=makeInput();
 input.journal.turns=[makeTurn({ok:false,prompt:'My password=hunter2 is in this prompt',reply:'Reply with '+SK,error:'Turn failed: Bearer abc123DEF456',toolCalls:[makeCall({ok:false,error:'Tool failed: api'+'_key='+AKV,result:'result mentions '+GHP})]})];
 input.journal.events=[makeEvent({kind:'turn-error',detail:'Bearer abc123DEF456'})];
 const report=buildDiagnosticsReport(input);
 const turn=report.currentSession.turns[0];
 assert.equal(turn.prompt,'My password=hunter2 is in this prompt');
 assert.equal(turn.reply,'Reply with '+SK);
 assert.equal(turn.toolCalls[0].result,'result mentions '+GHP);
 assert.equal(turn.error,'Turn failed: Bearer [redacted]');
 assert.equal(turn.toolCalls[0].error,'Tool failed: api'+'_key='+RED);
 assert.equal(report.currentSession.events[0].detail,'Bearer [redacted]');
 assert.equal(input.journal.turns[0].error,'Turn failed: Bearer abc123DEF456');
 assert.equal(input.journal.events[0].detail,'Bearer abc123DEF456');
});

test('performance stats use percentiles and report nulls for empty samples',()=>{
 const empty=buildDiagnosticsReport(makeInput({journal:{chatId:'chat-1',turns:[],events:[]}}));
 assert.deepEqual(empty.performance.turnLatency,{p50:null,p95:null,max:null,samples:0});
 assert.deepEqual(empty.performance.toolDuration,{p50:null,p95:null,max:null,samples:0});
 const input=makeInput();
 input.journal.turns=[
  makeTurn({id:'a',latencyMs:100,toolCalls:[makeCall({durationMs:10}),makeCall({index:1,durationMs:20})]}),
  makeTurn({id:'b',latencyMs:200,toolCalls:[makeCall({durationMs:30}),makeCall({index:1,durationMs:null})]}),
  makeTurn({id:'c',latencyMs:null,ok:null,endedAt:null,reply:null,toolCalls:[]}),
 ];
 const report=buildDiagnosticsReport(input);
 assert.deepEqual(report.performance.turnLatency,{p50:percentile([100,200],50),p95:percentile([100,200],95),max:200,samples:2});
 assert.deepEqual(report.performance.toolDuration,{p50:percentile([10,20,30],50),p95:percentile([10,20,30],95),max:30,samples:3});
 assert.equal(report.performance.turnLatency.p50,150);
 assert.equal(report.performance.turnLatency.p95,195);
 assert.equal(report.performance.toolDuration.p50,20);
 const single=buildDiagnosticsReport(makeInput({journal:{chatId:'chat-1',turns:[makeTurn({latencyMs:500,toolCalls:[makeCall({durationMs:42})]})],events:[]}}));
 assert.deepEqual(single.performance.turnLatency,{p50:500,p95:500,max:500,samples:1});
 assert.deepEqual(single.performance.toolDuration,{p50:42,p95:42,max:42,samples:1});
});

test('notes state the honest limitations',()=>{
 const report=buildDiagnosticsReport(makeInput());
 const joined=report.notes.join('\n');
 assert.ok(joined.includes('~3.5 characters per token'));
 assert.ok(joined.includes('no shell or file tools by design'));
 assert.ok(joined.includes('session directory'));
 assert.ok(joined.includes('Recording happens only while Developer mode is enabled'));
 assert.ok(joined.includes('last three exchanges'));
});

test('markdown report has every section and stays bounded for a huge journal',()=>{
 const turns:DevTurn[]=[];
 for(let t=0;t<100;t++){
  const calls:DevToolCall[]=[];
  for(let c=0;c<60;c++)calls.push(makeCall({index:c,ok:c%10!==0,error:c%10===0?'This tool is not available in this mode.':undefined,durationMs:100+c}));
  turns.push(makeTurn({id:'turn-'+t,startedAt:iso(t*60000),prompt:'Prompt '.repeat(200),reply:'Reply '.repeat(200),latencyMs:1000+t,toolCalls:calls,estimatedInputTokens:1000,estimatedOutputTokens:500}));
 }
 const events:DevEvent[]=[];
 for(let i=0;i<500;i++)events.push(makeEvent({id:i,at:iso(i*1000),kind:'repeat-call',detail:'x'.repeat(300)}));
 const savedChats:SavedChat[]=[];
 for(let i=0;i<25;i++)savedChats.push({id:'chat-'+i,title:'Chat '+i,created:iso(-i*1000),messages:[{role:'user',content:'hi'}]});
 const report=buildDiagnosticsReport(makeInput({journal:{chatId:'chat-1',turns,events},savedChats}));
 assert.equal(report.totals.toolCalls,6000);
 assert.equal(report.totals.turns,100);
 assert.equal(report.ruleViolations.length,200);
 assert.ok(report.ruleViolations[0].at>=report.ruleViolations[199].at);
 const markdown=renderMarkdownReport(report);
 for(const header of ['# OWLA Butler diagnostics report','## Features','## Providers','## Session totals','## Performance','## Rule violations','## Loss indicators','## Saved chats','## Current session','## Notes'])assert.ok(markdown.includes(header),header);
 assert.ok(markdown.length<20000,'markdown length '+markdown.length);
 assert.ok(markdown.includes('6000'));
 assert.ok(markdown.includes('200 recorded'));
 const sessionLines=markdown.split('## Current session')[1].split('## Notes')[0].split('\n').filter(l=>l.startsWith('- '));
 assert.equal(sessionLines.length,20);
 const chatLines=markdown.split('## Saved chats')[1].split('## Current session')[0].split('\n').filter(l=>l.startsWith('- '));
 assert.equal(chatLines.length,20);
 const violationLines=markdown.split('## Rule violations')[1].split('## Loss indicators')[0].split('\n').filter(l=>l.startsWith('- '));
 assert.equal(violationLines.length,10);
});
test('markdown renders an empty journal and no providers without crashing',()=>{
 const input=makeInput({journal:{chatId:'chat-1',turns:[],events:[]},savedChats:[],providers:[],routingHistory:{}});
 const report=buildDiagnosticsReport(input);
 const markdown=renderMarkdownReport(report);
 assert.ok(markdown.includes('## Providers'));
 assert.ok(markdown.includes('no recorded turns'));
 assert.ok(markdown.includes('- none'));
 assert.ok(markdown.includes('p50 n/a'));
 assert.ok(markdown.length<20000);
});

test('provider status/version/plan/accountType are redacted in report and markdown (F1)',()=>{
 const secret='sk-'+'statusabcdef123456';
 const input=makeInput({providers:[makeProvider({status:'Connect failed: '+secret,version:'0.1.0 ('+secret+')',plan:'Plan '+secret,accountType:secret})]});
 const report=buildDiagnosticsReport(input);
 const markdown=renderMarkdownReport(report);
 assert.ok(!JSON.stringify(report).includes(secret));
 assert.ok(!markdown.includes(secret));
 assert.ok(report.providers[0].status.includes('[redacted]'));
});

test('redactSensitive covers JWT, AWS, Google, xoxe- and unquoted compound keys (F2)',()=>{
 const jwt='eyJ'+'hbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc12345';
 const aws='AKIA'+'IOSFODNN7EXAMPLE';
 const google='AIza'+'SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q';
 const xoxe='xoxe-'+'123456789012-abcdef';
 const compound='client_secret=***';
 for(const [secret,name] of [[jwt,'JWT'],[aws,'AWS'],[google,'Google'],[xoxe,'xoxe'],[compound,'client_secret']] as const){
  const out=redactSensitive('error: '+secret+' end');
  assert.ok(!out.includes(secret),name+' must be redacted');
  assert.ok(out.includes('[redacted]'),name+' marker');
 }
 assert.ok(redactSensitive('the task-12345678 monkey-12345678 bearer of record').includes('task-12345678'),'prose survives');
});
