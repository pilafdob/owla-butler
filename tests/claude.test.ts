import {test} from 'node:test';import assert from 'node:assert/strict';
import {claudeArguments,webSources,decodeClaudeModels,friendlyClaudeError,imageBlock,supportedClaudeVersion,toolContent,CLAUDE_NO_EFFORT,CLAUDE_TOOL_PREFIX} from '../src/claude';
import {decodeClaudeRateLimit,usageWindows} from '../src/usage';
import {claudeExhaustion,describeProviders} from '../src/exhaustion';
import {prefixToolNames,toolName} from '../src/provider';
import {migrateSettings} from '../src/core';
import {claudeTaskFit,modelKey,routingModels} from '../src/routing';

// Shapes below are trimmed from a real Claude Code 2.1.322 initialize response and rate_limit_event.
const catalogue=[
 {value:'default',resolvedModel:'claude-opus-5-5',displayName:'Default (recommended)',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'opus',resolvedModel:'claude-opus-5-5',displayName:'Opus 5.5',description:'For complex work',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'haiku',resolvedModel:'claude-haiku-5-5',displayName:'Haiku 5.5',description:'Fastest for quick answers',supportsEffort:true,supportedEffortLevels:['low','medium','high','xhigh','max']},
 {value:'claude-haiku-4-5-20251001',resolvedModel:'claude-haiku-4-5-20251001',displayName:'Haiku 4.5',supportsThinkingOff:true},
 {value:42},
];
const event={status:'allowed',resetsAt:1794517200,rateLimitType:'five_hour',unifiedWindows:{five_hour:{utilization:0.04,resetsAt:1794517200,status:'allowed'},seven_day:{utilization:0.47,resetsAt:1794790800,status:'allowed'}}};

test('Claude Code version check requires the verified stream-json protocol',()=>{
 assert.equal(supportedClaudeVersion('2.1.322 (Claude Code)'),true);
 assert.equal(supportedClaudeVersion('2.2.0 (Claude Code)'),true);
 assert.equal(supportedClaudeVersion('3.0.0'),true);
 assert.equal(supportedClaudeVersion('2.1.321 (Claude Code)'),false);
 assert.equal(supportedClaudeVersion('1.0.99'),false);
 assert.equal(supportedClaudeVersion('unknown'),false);
});

test('the Claude model catalogue drops the default alias and keeps real effort levels',()=>{
 const models=decodeClaudeModels(catalogue);
 assert.deepEqual(models.map(model=>model.id),['opus','haiku','claude-haiku-4-5-20251001']);
 assert.equal(models.find(model=>model.isDefault)?.id,'opus');
 assert.equal(models[0].defaultReasoningEffort,'medium');
 assert.deepEqual(models[2].supportedReasoningEfforts.map(e=>e.reasoningEffort),[CLAUDE_NO_EFFORT]);
 assert.ok(models.every(model=>model.inputModalities?.includes('image')));
 // Routing keeps every model and identifies Claude models by their alias.
 assert.equal(routingModels(models,true).length,3);
 assert.equal(modelKey('claude',models[1]),'haiku');
 assert.match(claudeTaskFit(models[1]),/least costly/);
 assert.match(claudeTaskFit(models[2]),/Fixed reasoning effort/);
});

test('each Claude turn is isolated from the user’s Claude Code setup and built-in tools',()=>{
 const args=claudeArguments('haiku','low','SYSTEM',[{type:'function',name:'read_note',description:'',inputSchema:{}}],false);
 for(const flag of ['--safe-mode','--strict-mcp-config','--no-session-persistence','--disable-slash-commands'])assert.ok(args.includes(flag),flag);
 assert.equal(args[args.indexOf('--tools')+1],'');
 assert.equal(args[args.indexOf('--setting-sources')+1],'');
 assert.equal(args[args.indexOf('--permission-mode')+1],'dontAsk');
 assert.equal(args[args.indexOf('--allowedTools')+1],'mcp__owla__read_note');
 assert.equal(args[args.indexOf('--effort')+1],'low');
 assert.equal(args[args.indexOf('--system-prompt')+1],'SYSTEM');
 assert.deepEqual(JSON.parse(args[args.indexOf('--mcp-config')+1]),{mcpServers:{owla:{type:'sdk',name:'owla'}}});
 const web=claudeArguments('haiku',CLAUDE_NO_EFFORT,'S',[],true);
 assert.equal(web[web.indexOf('--tools')+1],'WebSearch');
 assert.equal(web.includes('--effort'),false);
});

test('OWLA tool names and outputs match Claude Code’s MCP conventions',()=>{
 assert.equal(toolName('claude','read_note'),CLAUDE_TOOL_PREFIX+'read_note');
 assert.equal(prefixToolNames('Use read_reference then propose_edit.','claude'),'Use mcp__owla__read_reference then mcp__owla__propose_edit.');
 assert.deepEqual(toolContent('plain'),[{type:'text',text:'plain'}]);
 assert.deepEqual(toolContent({text:'page',imageUrl:'data:image/png;base64,AAAA'}),[{type:'text',text:'page'},{type:'image',data:'AAAA',mimeType:'image/png'}]);
 assert.equal(imageBlock('https://example.com/a.png'),null);
});

test('Claude plan usage becomes the shared usage panel shape',()=>{
 const usage=decodeClaudeRateLimit(event);
 const rows=usageWindows(usage);
 assert.deepEqual(rows.map(row=>[row.bucket,row.window,row.used,row.resetsAt]),[['Claude','5-hour window',4,1794517200],['Claude','Weekly window',47,1794790800]]);
 assert.equal(decodeClaudeRateLimit({}),null);
 // A legacy event without unifiedWindows still reports its own window.
 const legacy=usageWindows(decodeClaudeRateLimit({status:'allowed_warning',rateLimitType:'seven_day',utilization:0.9,resetsAt:5}));
 assert.deepEqual(legacy.map(row=>[row.window,row.used]),[['Weekly window',90]]);
});

test('Claude exhaustion ends when the reported reset time passes',()=>{
 const rejected=decodeClaudeRateLimit({...event,status:'rejected',unifiedWindows:{...event.unifiedWindows,five_hour:{utilization:1,resetsAt:2000,status:'rejected'}}});
 assert.deepEqual(claudeExhaustion(rejected,undefined,1000),{provider:'claude',exhausted:true,resetsAt:2000,reason:'Claude usage limit reached.'});
 assert.equal(claudeExhaustion(rejected,undefined,2001).exhausted,false);
 assert.equal(claudeExhaustion(decodeClaudeRateLimit(event),undefined,1000).exhausted,false);
 assert.equal(claudeExhaustion(null,'API Error: 429 rate_limit_error').exhausted,true);
 assert.equal(claudeExhaustion(null,'network unreachable').exhausted,false);
 assert.match(describeProviders([claudeExhaustion(rejected,undefined,1000)]),/^Claude Code — usage exhausted/);
 assert.match(friendlyClaudeError('Claude AI usage limit reached|1794517200'),/usage limit/);
 assert.match(friendlyClaudeError('Invalid API key · Please run /login'),/sign in/);
});

test('the fallback choice replaces the Codex-only OpenCode toggle',()=>{
 assert.equal(migrateSettings({schemaVersion:3,provider:'codex',codexAutoFallback:true}).fallback,'opencode');
 assert.equal(migrateSettings({schemaVersion:3,provider:'opencode',codexAutoFallback:true}).fallback,'none');
 assert.equal(migrateSettings({schemaVersion:3,provider:'claude',fallback:'codex'}).fallback,'codex');
 // The selected provider can never be its own fallback.
 assert.equal(migrateSettings({schemaVersion:3,provider:'claude',fallback:'claude'}).fallback,'none');
 assert.equal(migrateSettings({schemaVersion:3,provider:'nope',fallback:'nope'}).provider,'codex');
 const claude=migrateSettings({schemaVersion:3,provider:'claude',claudeExecutable:'/x/claude',models:{claude:{model:'haiku',reasoning:'low'}}});
 assert.equal(claude.provider,'claude');
 assert.equal(claude.claudeExecutable,'/x/claude');
 assert.deepEqual(claude.models.claude,{model:'haiku',reasoning:'low'});
 assert.deepEqual(migrateSettings({}).models.claude,{model:'',reasoning:''});
});

test('web sources are the links the reply cites, titled from the search results',()=>{
 const results=new Map([['https://obsidian.md/changelog','Changelog - Obsidian'],['https://example.com/other','Other']]);
 assert.deepEqual(webSources('See [obsidian.md/changelog](https://obsidian.md/changelog) and [again](https://obsidian.md/changelog).',results),[{url:'https://obsidian.md/changelog',title:'Changelog - Obsidian'}]);
 assert.deepEqual(webSources('No links.',results).map(s=>s.url),['https://obsidian.md/changelog','https://example.com/other']);
});

test('provider-worded errors are not rewritten as Codex errors',async()=>{
 const {friendlyError}=await import('../src/codex');
 assert.equal(friendlyError(Error('Claude usage limit reached. Wait for your plan allowance to reset.')),'Claude usage limit reached. Wait for your plan allowance to reset.');
 assert.equal(friendlyError(Error('OpenCode usage limit reached. Wait for the reported reset time.')),'OpenCode usage limit reached. Wait for the reported reset time.');
 assert.match(friendlyError(Error('HTTP 429 rate limit')),/^Codex usage limit/);
});

test('get_usage plan limits decode without a prompt, as percentages with ISO reset times',async()=>{
 const {decodeClaudeUsage,usageWindows}=await import('../src/usage');
 const snapshot=decodeClaudeUsage({rate_limits:{five_hour:{utilization:50,resets_at:'2026-11-12T21:00:00.287635+00:00',locked_reason:null},seven_day:{utilization:53,resets_at:'2026-11-16T01:00:00+00:00'},seven_day_opus:null,extra_usage:{is_enabled:false}}});
 const rows=usageWindows(snapshot);
 assert.deepEqual(rows.map(r=>[r.used,r.resetsAt]),[[50,Math.floor(Date.parse('2026-11-12T21:00:00.287Z')/1000)],[53,Math.floor(Date.parse('2026-11-16T01:00:00Z')/1000)]]);
 assert.equal(decodeClaudeUsage({rate_limits:{}}),null);
 assert.equal(decodeClaudeUsage(null),null);
 const locked=usageWindows(decodeClaudeUsage({rate_limits:{five_hour:{utilization:80,locked_reason:'limit'}}}));
 assert.equal(locked[0].used,100);
});
