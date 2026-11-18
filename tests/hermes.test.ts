import {test} from 'node:test';import assert from 'node:assert/strict';
import {HermesBridge,hermesPrivateConfig,HERMES_PRIVATE_EXCLUDED,hermesMirrorExcluded,hermesDefaultModel,hermesFilteredEnv,hermesChildEnv,friendlyHermesError} from '../src/hermes';
import type {ToolOutput,ToolSpec} from '../src/provider';
import {canonicalModelKey,sameModelRoute,type AutoEntry} from '../src/auto-route';
import {PROVIDER_IDS,toolName} from '../src/provider';
import {migrateSettings} from '../src/core';
import type {ProviderModel} from '../src/provider';

const model=(id:string,providerID?:string):ProviderModel=>({id,model:id,providerID,displayName:id,isDefault:false,defaultReasoningEffort:'default',supportedReasoningEfforts:[{reasoningEffort:'default',description:''}]});

// Exercise the real loopback transport without launching a model or reading credentials.
type McpHarness={ensureCallback():Promise<void>;setToolSpecs(tools:ToolSpec[]):void;callbackPort:number;mcpToken:string;toolHandler:((name:string,args:unknown)=>Promise<ToolOutput>)|null};
test('Hermes MCP handles authenticated single JSON-RPC discovery and guarded tool calls',async()=>{
 const bridge=new HermesBridge(),mcp=bridge as unknown as McpHarness;
 const tools:ToolSpec[]=['read_canvas','read_excalidraw','propose_excalidraw','read_reference'].map(name=>({type:'function',name,description:name,inputSchema:{type:'object',properties:{}}}));
 mcp.setToolSpecs(tools);
 const calls:unknown[]=[];
 mcp.toolHandler=async(name,args)=>{calls.push({name,args});return 'OWLA guarded result';};
 await mcp.ensureCallback();
 const post=(body:unknown,token=mcp.mcpToken)=>fetch('http://127.0.0.1:'+mcp.callbackPort+'/mcp',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 try{
  const unauthorized=await post({jsonrpc:'2.0',id:1,method:'tools/list'},'wrong');
  assert.equal(unauthorized.status,401);
  const initialized=await post({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'probe',version:'1'}}});
  assert.equal(initialized.status,200,'initialize must return a response, not silently accept an object as an empty batch');
  assert.equal((await initialized.json()).id,2);
  assert.equal((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status,202);
  const listed=await post({jsonrpc:'2.0',id:'list',method:'tools/list',params:{}});
  assert.equal(listed.status,200);
  assert.deepEqual((await listed.json()).result.tools,tools.map(({type:_,...tool})=>tool));
  const called=await post({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'read_excalidraw',arguments:{path:'Drawing.excalidraw'}}});
  assert.equal((await called.json()).result.content[0].text,'OWLA guarded result');
  for(const name of ['terminal','execute_code','search_files','mcp__user__tool']){
   const refused=await post({jsonrpc:'2.0',id:5,method:'tools/call',params:{name,arguments:{}}});
   assert.equal((await refused.json()).error.code,-32602,name);
  }
  assert.deepEqual(calls,[{name:'read_excalidraw',args:{path:'Drawing.excalidraw'}}]);
 }finally{bridge.disconnect();}
});

test('Hermes is a provider and reaches OWLA tools as mcp__owla__<name>, the name Hermes registers',()=>{
 assert.ok(PROVIDER_IDS.includes('hermes'));
 // Hermes: tools/mcp_tool_schema.py mcp_prefixed_tool_name → mcp__<server>__<tool>.
 assert.equal(toolName('hermes','read_note'),'mcp__owla__read_note');
});

test('Hermes private home: no built-in tools, plugins, user MCP servers, memory or user skills',()=>{
 assert.match(hermesPrivateConfig(false),/platform_toolsets:\n {2}acp: \[\]/);
 assert.match(hermesPrivateConfig(true),/platform_toolsets:\n {2}acp: \[web\]/);
 assert.match(hermesPrivateConfig(false),/plugins:\n {2}enabled: \[\]/);
 assert.match(hermesPrivateConfig(false),/mcp_servers: \{\}/);
 assert.match(hermesPrivateConfig(false),/memory_enabled: false/);
 assert.match(hermesPrivateConfig(false),/user_profile_enabled: false/);
 for(const entry of ['config.yaml','skills','plugins','hooks','memories','SOUL.md','cron','sessions','state.db','logs'])assert.ok(HERMES_PRIVATE_EXCLUDED.has(entry),entry);
 // Sign-ins stay reachable.
 for(const entry of ['auth.json','.env'])assert.ok(!HERMES_PRIVATE_EXCLUDED.has(entry),entry);
});

// The gateway renames ACP session MCP servers to editor_owla_<hash>, so the
// model could never call the mcp__owla__<tool> names OWLA's instructions use.
test('OWLA tools are a native config server, keeping the mcp__owla__ name and no shell toolset',()=>{
 const config=hermesPrivateConfig(true,{url:'http://127.0.0.1:4321/mcp',token:'secret-token'});
 assert.match(config,/acp: \[web, mcp-owla\]/);
 assert.match(config,/mcp_servers:\n {2}owla:\n {4}url: "http:\/\/127\.0\.0\.1:4321\/mcp"/);
 assert.match(config,/Authorization: "Bearer secret-token"/);
 // Only OWLA's toolset and the optional web toolset: never the user's shell/file tools.
 const enabled=config.split('\n')[1];
 for(const toolset of ['terminal','file','hermes-acp','browser','code','mcp-adrafinil'])assert.ok(!enabled.includes(toolset),toolset);
 assert.equal(hermesPrivateConfig(false,{url:'http://127.0.0.1:1/mcp',token:'t'}).split('\n')[1],'  acp: [mcp-owla]');
});

// A mirrored gateway socket made OWLA's private HERMES_HOME a viewer of the
// user's own daemon: the private config was never read, so the session ran with
// the user's shell/file tools, MCP servers and session database.
test('Hermes private home never mirrors the user’s live gateway, runtime or session state',()=>{
 for(const entry of ['gateway.sock','gateway.sock.path','gateway.pid','gateway.lock','gateway-connections.json','gateway-starts.log','gateway_state.json','gateway.error.log','runtime','state','locks','projects.db','projects.db-wal','spawn-ledger.json','spawn-ledger.json.lock','state.db-shm','kanban.db-wal'])
  assert.equal(hermesMirrorExcluded(entry),true,entry);
 // The install and the sign-ins stay reachable, so Hermes needs no re-download.
 for(const entry of ['auth.json','shared','installs','hermes-agent','tools','cache','assets','provider_models_cache.json'])
  assert.equal(hermesMirrorExcluded(entry),false,entry);
 // APFS/NTFS are case-insensitive: another spelling is the same file.
 for(const entry of ['Config.yaml','CONFIG.YAML','Skills','Plugins','soul.md','Gateway.sock'])
  assert.equal(hermesMirrorExcluded(entry),true,entry);
});

// SECURITY-AUDIT-3.6.2 H1: Hermes loads <HERMES_HOME>/.env with override=True,
// and HERMES_TUI_GATEWAY_URL dials a remote gateway past the private home.
test('Hermes .env is a filtered copy and HERMES_* never reaches the child',()=>{
 assert.equal(hermesMirrorExcluded('.env'),true,'.env must never be linked');
 const filtered=hermesFilteredEnv('# comment\nOPENROUTER_API_KEY=k1\nexport HERMES_TUI_GATEWAY_URL=wss://evil.example\nHERMES_ACP_AUTO_APPROVE=1\n hermes_acp_auth_method = x\nAI_GATEWAY_API_KEY=k2\nnot a line\n');
 assert.equal(filtered,'OPENROUTER_API_KEY=k1\nAI_GATEWAY_API_KEY=k2\n');
 assert.equal(hermesFilteredEnv('HERMES_TUI_GATEWAY_URL=x\n'),'');
 const env=hermesChildEnv({HERMES_TUI_GATEWAY_URL:'wss://evil.example',HERMES_HOME:'/Users/me/.hermes',hermes_acp_auto_approve:'1',Path:'/old',HOME:'/Users/me'},'/private/home','/bin');
 assert.deepEqual(env,{HOME:'/Users/me',HERMES_HOME:'/private/home',PATH:'/bin'});
});

// An OWLA-owned daemon has no user config to supply a default model, and Hermes
// refuses a session policy whose model is empty ("invalid policy").
test('the private config carries only the default model, and Hermes accepts the session',()=>{
 const user='model:\n  # comment\n  default: "tencent/hy4-flash:free"\n  provider: "nous"\n  api_key: "must-not-leak"\ntoolsets: [terminal]\n';
 assert.deepEqual(hermesDefaultModel(user),{model:'tencent/hy4-flash:free',provider:'nous'});
 const config=hermesPrivateConfig(false,{url:'http://127.0.0.1:1/mcp',token:'t'},hermesDefaultModel(user));
 assert.match(config,/^model:\n {2}default: "tencent\/hy4-flash:free"\n {2}provider: "nous"\n/);
 assert.ok(!config.includes('must-not-leak'),'no other user config value is copied');
 assert.ok(!config.includes('toolsets: [terminal]'));
 assert.deepEqual(hermesDefaultModel(''),{model:'',provider:''});
 assert.deepEqual(hermesDefaultModel('model:\n  default: "bad;rm -rf /"\n'),{model:'',provider:''});
 assert.ok(!hermesPrivateConfig(false,undefined,hermesDefaultModel('')).startsWith('model:'));
});

test('Hermes errors: limits and missing providers are explained',()=>{
 assert.match(friendlyHermesError(Error('429 Too Many Requests: rate limit')),/usage limit/);
 assert.match(friendlyHermesError(Error('No LLM provider configured')),/connect a provider/);
});

test('Hermes settings survive migration and stay per platform',()=>{
 const settings=migrateSettings({schemaVersion:3,provider:'hermes',hermesConnected:true,hermesExecutable:'/bin/hermes',models:{hermes:{model:'nous:anthropic/claude-sonnet-5',reasoning:'default'}}});
 assert.equal(settings.provider,'hermes');
 assert.equal(settings.hermesConnected,true);
 assert.equal(settings.hermesExecutable,'/bin/hermes');
 assert.deepEqual(settings.models.hermes,{model:'nous:anthropic/claude-sonnet-5',reasoning:'default'});
 assert.deepEqual(migrateSettings({}).models.hermes,{model:'',reasoning:''});
});

test('the same model on OpenCode and Hermes has one canonical key',()=>{
 const keys=['openrouter/anthropic/claude-sonnet-5','nous:anthropic/claude-sonnet-5','anthropic:claude-sonnet-5','claude-sonnet-5'];
 assert.equal(new Set(keys.map(canonicalModelKey)).size,1);
 assert.notEqual(canonicalModelKey('nous:anthropic/claude-opus-5'),canonicalModelKey('openrouter/anthropic/claude-sonnet-5'));
});

test('a failed or exhausted model moves to the same model on the other provider',()=>{
 const entries:AutoEntry[]=[
  {provider:'opencode',model:model('openrouter/openai/gpt-6-luna','openrouter'),key:'openrouter/openai/gpt-6-luna'},
  {provider:'opencode',model:model('openrouter/anthropic/claude-sonnet-5','openrouter'),key:'openrouter/anthropic/claude-sonnet-5'},
  {provider:'hermes',model:model('nous:anthropic/claude-opus-5','nous'),key:'nous:anthropic/claude-opus-5'},
 ];
 const route=sameModelRoute(entries,{provider:'hermes',model:'nous:anthropic/claude-sonnet-5',effort:'default'});
 assert.equal(route?.provider,'opencode');
 assert.equal(route?.model,'openrouter/anthropic/claude-sonnet-5');
 // The same provider is never offered back, and an unknown model has no twin.
 assert.equal(sameModelRoute(entries,{provider:'opencode',model:'openrouter/anthropic/claude-sonnet-5',effort:'default'}),null);
 assert.equal(sameModelRoute(entries,{provider:'hermes',model:'nous:x/unknown',effort:'default'}),null);
});
