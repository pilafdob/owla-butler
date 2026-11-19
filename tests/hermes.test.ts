import {test} from 'node:test';import assert from 'node:assert/strict';
import {LIMIT_ERROR} from '../src/exhaustion';
import {HermesBridge,hermesRpcErrorMessage,hermesPrivateConfig,HERMES_PRIVATE_EXCLUDED,hermesMirrorExcluded,hermesDefaultModel,hermesFilteredEnv,hermesChildEnv,hermesEnvKeyBlocked,hermesInheritedInstructions,friendlyHermesError,hermesModelModalities,resetModelsDevCatalogCacheForTests} from '../src/hermes';
import {existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readlinkSync,realpathSync,rmSync,symlinkSync,utimesSync,writeFileSync} from 'node:fs';import {homedir,tmpdir} from 'node:os';import {join} from 'node:path';
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
 // OWLA's tools stay visible: no tool_search deferral in the confined session.
 assert.match(hermesPrivateConfig(false),/tools:\n {2}tool_search:\n {4}enabled: off/);
 // A usage limit comes straight back to OWLA's fallback instead of 600 s Hermes retries.
 assert.match(hermesPrivateConfig(false),/agent:\n {2}api_max_retries: 1\n {2}auto_recovery_cycles: 0/);
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
 // The crash-recovery checkpoint would adopt the user's live background PIDs
 // (tools/process_registry.py), and writable state writes back through links
 // (SECURITY-AUDIT-3.6.2 M9).
 for(const entry of ['processes.json','processes.json.lock','cache','audio_cache','image_cache','bootstrap-cache','bot_relay','platforms','kanban','backups','.curator_backups','state-snapshots','.skills_prompt_snapshot.json','ui-preferences.json','channel_directory.json','import-sync.json','install_id','log_hash_salt','.auto_prune_estimate.json','.hermes-update-in-progress.lock','.env.lock','.mcp-discovery.lock','.install_id.lock','lsp','source-checks','plugin-update-checks'])
  assert.equal(hermesMirrorExcluded(entry),true,entry);
 // The install and the sign-ins stay reachable, so Hermes needs no re-download;
 // the locks of shared files serialize their refresh with the user's daemon.
 for(const entry of ['auth.json','auth.lock','shared','installs','hermes-agent','hermes-setup','tools','assets','provider_models_cache.json','provider_models_cache.json.lock','models_dev_cache.json','context_length_cache.yaml'])
  assert.equal(hermesMirrorExcluded(entry),false,entry);
 // APFS/NTFS are case-insensitive: another spelling is the same file.
 for(const entry of ['Config.yaml','CONFIG.YAML','Skills','Plugins','soul.md','Gateway.sock','Processes.json','CACHE','Bot_relay'])
  assert.equal(hermesMirrorExcluded(entry),true,entry);
});

// SECURITY-AUDIT-3.6.2 H1: Hermes loads <HERMES_HOME>/.env with override=True,
// and HERMES_TUI_GATEWAY_URL dials a remote gateway past the private home.
test('Hermes .env is a filtered copy and HERMES_* never reaches the child',()=>{
 assert.equal(hermesMirrorExcluded('.env'),true,'.env must never be linked');
 // Key names are joined at runtime so the fixture reads as data, not a secret.
 const openrouter='OPENROUTER_API_KEY',aiGateway='AI_GATEWAY_API_KEY';
 const filtered=hermesFilteredEnv(['# comment',openrouter+'=k1','export HERMES_TUI_GATEWAY_URL=wss://evil.example','HERMES_ACP_AUTO_APPROVE=1',' hermes_acp_auth_method = x',aiGateway+'=k2','not a line'].join('\n')+'\n');
 assert.equal(filtered,[openrouter+'=k1',aiGateway+'=k2'].join('\n')+'\n');
 assert.equal(hermesFilteredEnv('HERMES_TUI_GATEWAY_URL=x\n'),'');
 const env=hermesChildEnv({HERMES_TUI_GATEWAY_URL:'wss://evil.example',HERMES_HOME:'/Users/me/.hermes',hermes_acp_auto_approve:'1',Path:'/old',HOME:'/Users/me'},'/private/home','/bin');
 assert.deepEqual(env,{HOME:'/Users/me',HERMES_HOME:'/private/home',PATH:'/bin'});
});

// The mirrored .env loads with override semantics, so a kept execution-hijack
// line would re-inject exactly what sanitizedEnv stripped from the spawn env.
test('Hermes .env filter also drops execution-hijack and telemetry keys, keeps provider keys',()=>{
 const openrouter='OPENROUTER_API_KEY',aws='AWS_SECRET_ACCESS_KEY';
 const filtered=hermesFilteredEnv(['NODE_OPTIONS=--require /evil.js','PYTHONHOME=/evil','DYLD_INSERT_LIBRARIES=/evil.dylib','LD_PRELOAD=/evil.so','BASH_ENV=/evil.sh','OTEL_EXPORTER_OTLP_ENDPOINT=https://evil.example','OTEL_LOG_USER_PROMPTS=1',openrouter+'=k1',aws+'=aws-secret'].join('\n')+'\n');
 // Provider credentials stay (Hermes signs in with them, e.g. Bedrock); only
 // execution hijack, HERMES_* and telemetry keys are dropped.
 assert.equal(filtered,[openrouter+'=k1',aws+'=aws-secret'].join('\n')+'\n');
 for(const key of ['NODE_OPTIONS','node_options','PYTHONSTARTUP','PERL5OPT','RUBYOPT','ELECTRON_RUN_AS_NODE','OTEL_SERVICE_NAME'])
  assert.equal(hermesEnvKeyBlocked(key),true,key);
 for(const key of ['OPENROUTER_API_KEY','AI_GATEWAY_API_KEY','NOUS_API_KEY','OPENAI_API_KEY'])
  assert.equal(hermesEnvKeyBlocked(key),false,key);
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

// Gateway error detail reaches chat and status; it must not carry the loopback
// bearer token, other credentials or user-home paths (SECURITY-AUDIT-3.6.2 L15).
test('Hermes error detail is redacted before it reaches chat',()=>{
 const message=friendlyHermesError(Error('MCP connect failed: Authorization: Bearer '+'abc123DEF token='+'abc123secret at '+homedir()+'/.hermes'));
 assert.ok(!message.includes('abc123DEF'),message);
 assert.ok(!message.includes('abc123secret'),message);
 assert.ok(!message.includes(homedir()),message);
 assert.match(message,/redacted/);
 assert.ok(message.length<=800);
});

// Hermes loads AGENTS.md/CLAUDE.md/.cursorrules/.hermes.md from the session cwd
// and its ancestors (agent/prompt_builder.py); a storage root inside a shared
// folder must not feed them into every turn, as Codex already refuses.
test('Hermes refuses instruction files above the session folder, below home',()=>{
 const scratch=realpathSync(mkdtempSync(join(tmpdir(),'owla-hermes-instructions-')));
 try{
  const home=join(scratch,'home'),repo=join(home,'repo'),sub=join(repo,'sub'),session=join(sub,'session');
  mkdirSync(session,{recursive:true});
  mkdirSync(join(session,'.cursor','rules'),{recursive:true});
  writeFileSync(join(repo,'AGENTS.md'),'repo instructions');
  writeFileSync(join(sub,'CLAUDE.md'),'claude instructions');
  writeFileSync(join(session,'.cursorrules'),'cursor rules');
  writeFileSync(join(session,'.cursor','rules','x.mdc'),'rule');
  writeFileSync(join(repo,'.hermes.md'),'hermes instructions');
  writeFileSync(join(home,'AGENTS.md'),'the user own global file');
  const found=hermesInheritedInstructions(session,home);
  for(const file of [join(repo,'AGENTS.md'),join(sub,'CLAUDE.md'),join(session,'.cursorrules'),join(session,'.cursor','rules','x.mdc'),join(repo,'.hermes.md')])
   assert.ok(found.includes(file),file);
  assert.ok(!found.includes(join(home,'AGENTS.md')),'home and above are the user own files');
  assert.deepEqual(hermesInheritedInstructions(join(home,'clean'),home),[]);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// SECURITY-AUDIT-3.6.2 L2: malformed bodies must be refused, not silently
// accepted; the token compare is constant-time; disconnect ends held SSE.
test('Hermes MCP refuses malformed JSON-RPC and closes held connections on disconnect',async()=>{
 const bridge=new HermesBridge(),mcp=bridge as unknown as McpHarness;
 mcp.setToolSpecs([]);
 await mcp.ensureCallback();
 const url='http://127.0.0.1:'+mcp.callbackPort+'/mcp';
 const raw=(body:string,token=mcp.mcpToken)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+token},body});
 try{
  for(const body of ['not json','','null','5','[[{"jsonrpc":"2.0","id":1,"method":"tools/list"}]]']){
   const response=await raw(body);
   assert.equal(response.status,400,JSON.stringify(body));
   assert.ok([-32700,-32600].includes((await response.json()).error.code),body);
  }
  // A wrong-length token is refused by the length guard before timingSafeEqual.
  assert.equal((await raw('{"jsonrpc":"2.0","id":1,"method":"tools/list"}',mcp.mcpToken+'x')).status,401);
  const batch=await raw('[{"jsonrpc":"2.0","id":1,"method":"initialize"},{"jsonrpc":"2.0","method":"notifications/initialized"}]');
  assert.equal(batch.status,200);
  const reply=await batch.json();
  // One response left after the notification: a single object, not a batch.
  assert.equal(reply.id,1);
  assert.ok(reply.result.serverInfo);
  // The GET SSE stream stays open by design (the client retries on error)…
  const stream=await fetch(url,{headers:{Authorization:'Bearer '+mcp.mcpToken}});
  assert.equal(stream.status,200);
  assert.match(stream.headers.get('content-type')??'',/text\/event-stream/);
  const held=stream.body!.getReader().read().then(()=>true,()=>true);
  bridge.disconnect();
  // …and disconnect must end it instead of leaking the connection.
  const ended=await Promise.race([held,new Promise(resolve=>setTimeout(()=>resolve(false),2000))]);
  assert.equal(ended,true,'held SSE connection survived disconnect');
 }finally{bridge.disconnect();}
});

// SECURITY-AUDIT-3.6.2 M1/M3: the private home is per vault, and a planted or
// dangling symlink is replaced, never read or written through.
type HomeHarness={sessionCwd:string;privateHomePath():string;ensurePrivateHome(executable:string,web:boolean,endpoint?:{url:string;token:string},realHome?:string):void};
test('reconnecting keeps the private Hermes gateway state that OWLA itself created',()=>{
 // Live 3.7.0-RC failure: every connect deleted the private home's own state.db,
 // so the running private gateway refused session/new ("state.db was replaced").
 const scratch=mkdtempSync(join(tmpdir(),'owla-hermes-reconnect-'));
 try{
  const realHome=join(scratch,'real');mkdirSync(realHome,{recursive:true});
  for(const name of ['state.db','state.db-wal','processes.json'])writeFileSync(join(realHome,name),'user '+name);
  const session=join(scratch,'storage','vaults','v','hermes-session'),home=join(scratch,'storage','vaults','v','hermes-private');
  mkdirSync(home,{recursive:true});
  writeFileSync(join(home,'processes.json'),'stale copy from an earlier build');
  const first=new HermesBridge() as unknown as HomeHarness;first.sessionCwd=session;
  first.ensurePrivateHome('',false,undefined,realHome);
  assert.equal(existsSync(join(home,'processes.json')),false,'the first pass still removes a stale copy');
  // The private gateway now writes its own state under the same names.
  for(const name of ['state.db','state.db-wal','processes.json'])writeFileSync(join(home,name),'owla '+name);
  const again=new HermesBridge() as unknown as HomeHarness;again.sessionCwd=session;
  again.ensurePrivateHome('',false,undefined,realHome);
  for(const name of ['state.db','state.db-wal','processes.json']){
   assert.equal(readFileSync(join(home,name),'utf8'),'owla '+name,name+' must survive a reconnect');
   assert.equal(lstatSync(join(home,name)).isSymbolicLink(),false,name+' must never be linked to the user home');
  }
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

test('Hermes private home is per vault and never writes through a planted link',()=>{
 const scratch=mkdtempSync(join(tmpdir(),'owla-hermes-home-'));
 try{
  const realHome=join(scratch,'real');
  mkdirSync(join(realHome,'cache','scratch'),{recursive:true});
  mkdirSync(join(realHome,'skills','user-skill'),{recursive:true});
  mkdirSync(join(realHome,'installs'),{recursive:true});
  writeFileSync(join(realHome,'auth.json'),'{"token":"user-sign-in"}');
  writeFileSync(join(realHome,'config.yaml'),'model:\n  default: "m"\n  api_key: "must-not-leak"\n');
  writeFileSync(join(realHome,'.env'),['HERMES_TUI_GATEWAY_URL=wss://evil.example','NODE_OPTIONS=--require /evil.js','OPENROUTER_API_KEY'+'=k1'].join('\n')+'\n');
  writeFileSync(join(realHome,'gateway.lock'),'user-lock');
  writeFileSync(join(realHome,'processes.json'),'{"processes":[]}');
  writeFileSync(join(realHome,'cache','scratch','user.txt'),'user scratch');
  writeFileSync(join(realHome,'skills','user-skill','SKILL.md'),'user skill');
  const sessionA=join(scratch,'storage','vaults','aaa','hermes-session');
  const homeA=join(scratch,'storage','vaults','aaa','hermes-private');
  mkdirSync(homeA,{recursive:true});
  // Plants: a valid symlink to attacker content, a dangling symlink, a stale
  // copied checkpoint, an old mirrored gateway lock, and a linked skills dir.
  const victim=join(scratch,'victim-auth.json');
  writeFileSync(victim,'attacker credentials');
  symlinkSync(victim,join(homeA,'auth.json'));
  symlinkSync(join(scratch,'victim-ui.json'),join(homeA,'ui-preferences.json'));
  writeFileSync(join(homeA,'processes.json'),'stale checkpoint with user PIDs');
  symlinkSync(join(realHome,'gateway.lock'),join(homeA,'gateway.lock'));
  const attackerSkills=join(scratch,'attacker-skills');
  mkdirSync(attackerSkills,{recursive:true});
  writeFileSync(join(attackerSkills,'marker'),'attacker');
  symlinkSync(attackerSkills,join(homeA,'skills'));
  const bridge=new HermesBridge() as unknown as HomeHarness;
  bridge.sessionCwd=sessionA;
  assert.equal(bridge.privateHomePath(),homeA);
  bridge.ensurePrivateHome('',false,{url:'http://127.0.0.1:9/mcp',token:'tok'},realHome);
  assert.ok(lstatSync(homeA).isDirectory());
  // The planted auth link is replaced by the real mirror; the victim is untouched.
  assert.equal(readlinkSync(join(homeA,'auth.json')),join(realHome,'auth.json'));
  assert.equal(readFileSync(victim,'utf8'),'attacker credentials');
  // The dangling link is gone and nothing was written through it.
  assert.equal(existsSync(join(homeA,'ui-preferences.json')),false);
  assert.equal(existsSync(join(scratch,'victim-ui.json')),false);
  // Stale live-state files and old links are removed, never adopted.
  assert.equal(existsSync(join(homeA,'processes.json')),false);
  assert.equal(existsSync(join(homeA,'gateway.lock')),false);
  assert.equal(existsSync(join(homeA,'cache')),false);
  // skills/ is OWLA-owned real directory; the attacker dir keeps its content.
  assert.ok(lstatSync(join(homeA,'skills')).isDirectory());
  assert.ok(existsSync(join(homeA,'skills','obsidian-markdown','SKILL.md')));
  assert.equal(existsSync(join(homeA,'skills','user-skill')),false);
  assert.equal(readFileSync(join(attackerSkills,'marker'),'utf8'),'attacker');
  // The config carries only the endpoint and the default model; .env is filtered.
  const config=readFileSync(join(homeA,'config.yaml'),'utf8');
  assert.ok(config.includes('Bearer tok'));
  assert.ok(!config.includes('must-not-leak'));
  const env=readFileSync(join(homeA,'.env'),'utf8');
  assert.equal(env,'OPENROUTER_API_KEY'+'=k1\n');
  // The install stays reachable.
  assert.equal(readlinkSync(join(homeA,'installs')),join(realHome,'installs'));
  // A second vault gets its own home (M1): no shared config/token/state.
  const other=new HermesBridge() as unknown as HomeHarness;
  other.sessionCwd=join(scratch,'storage','vaults','bbb','hermes-session');
  assert.notEqual(other.privateHomePath(),homeA);
  // A planted link at the home itself is replaced, not written through.
  const sessionC=join(scratch,'storage','vaults','ccc','hermes-session');
  const homeC=join(scratch,'storage','vaults','ccc','hermes-private');
  const elsewhere=join(scratch,'elsewhere');
  mkdirSync(elsewhere,{recursive:true});
  mkdirSync(join(scratch,'storage','vaults','ccc'),{recursive:true});
  symlinkSync(elsewhere,homeC);
  const third=new HermesBridge() as unknown as HomeHarness;
  third.sessionCwd=sessionC;
  third.ensurePrivateHome('',false,undefined,realHome);
  assert.ok(lstatSync(homeC).isDirectory());
  assert.equal(existsSync(join(elsewhere,'config.yaml')),false);
 }finally{rmSync(scratch,{recursive:true,force:true});}
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

test('Hermes model modalities come from the models.dev catalog, not a hard-coded image flag',()=>{
 const home=mkdtempSync(join(tmpdir(),'owla-hermes-modalities-'));
 try{
  const catalog={'opencode-go':{models:{
   'beam-free':{attachment:false,modalities:{input:['text'],output:['text']}},
   'glm-5.3-flash-free':{attachment:true,modalities:{input:['text','image'],output:['text']}},
   'stale-flag':{attachment:true,modalities:{input:['text'],output:['text']}},
   'attachment-only':{attachment:true},
  }}};
  writeFileSync(join(home,'models_dev_cache.json'),JSON.stringify(catalog));
  resetModelsDevCatalogCacheForTests();
  // The text-only model that mis-routed the handwriting turn must NOT claim image input.
  assert.deepEqual(hermesModelModalities('opencode-go','beam-free',home),['text']);
  assert.deepEqual(hermesModelModalities('opencode-go','glm-5.3-flash-free',home),['text','image']);
  // Explicit modalities win over a stale attachment flag (Hermes's own rule).
  assert.deepEqual(hermesModelModalities('opencode-go','stale-flag',home),['text']);
  // attachment is the fallback when modalities are absent.
  assert.deepEqual(hermesModelModalities('opencode-go','attachment-only',home),['text','image']);
  // Unknown models fail closed to text-only (excluded from image-required tasks only).
  assert.deepEqual(hermesModelModalities('opencode-go','not-in-catalog',home),['text']);
 }finally{rmSync(home,{recursive:true,force:true});resetModelsDevCatalogCacheForTests();}
});

test('a models.dev catalog that appears or changes mid-session is re-read',()=>{
 const home=mkdtempSync(join(tmpdir(),'owla-hermes-catalog-refresh-'));
 try{
  resetModelsDevCatalogCacheForTests();
  assert.deepEqual(hermesModelModalities('opencode-go','m',home),['text'],'absent catalog: text-only');
  const file=join(home,'models_dev_cache.json');
  writeFileSync(file,JSON.stringify({'opencode-go':{models:{m:{modalities:{input:['text','image']}}}}}));
  assert.deepEqual(hermesModelModalities('opencode-go','m',home),['text','image'],'a catalog written later is picked up');
  writeFileSync(file,JSON.stringify({'opencode-go':{models:{m:{modalities:{input:['text']}},pad:{}}}}));
  utimesSync(file,new Date(),new Date(Date.now()+5000));
  assert.deepEqual(hermesModelModalities('opencode-go','m',home),['text'],'a refreshed catalog replaces the cached one');
 }finally{rmSync(home,{recursive:true,force:true});resetModelsDevCatalogCacheForTests();}
});

test('a missing models.dev catalog leaves Hermes models text-only rather than guessing vision',()=>{
 const home=mkdtempSync(join(tmpdir(),'owla-hermes-no-catalog-'));
 try{resetModelsDevCatalogCacheForTests();assert.deepEqual(hermesModelModalities('opencode-go','beam-free',home),['text']);}
 finally{rmSync(home,{recursive:true,force:true});resetModelsDevCatalogCacheForTests();}
});

test('Hermes RPC errors carry the real cause from data.details, not just "Internal error"',()=>{
 const limit={code:-32603,message:'Internal error',data:{details:"Error code: 429 - OpenCode Go usage limit reached (weekly, resets in 3d 4h)"}};
 assert.match(hermesRpcErrorMessage(limit),/429 - OpenCode Go usage limit reached/);
 assert.doesNotMatch(hermesRpcErrorMessage(limit),/^Internal error/);
 assert.match(hermesRpcErrorMessage(limit),LIMIT_ERROR,'a limit error must be recognised as one');
 assert.equal(hermesRpcErrorMessage({code:-32602,message:'Invalid params',data:{details:'cwd does not exist'}}),'Invalid params: cwd does not exist');
 assert.equal(hermesRpcErrorMessage({code:-32603,message:'Session is busy'}),'Session is busy');
 assert.equal(hermesRpcErrorMessage({}),'Hermes error.');
 assert.equal(hermesRpcErrorMessage({message:'Internal error',data:{details:'x'.repeat(5000)}}).length,2000);
});
test('a bare HTTP 429 counts as a usage limit',()=>{assert.match('HTTP 429',LIMIT_ERROR);assert.doesNotMatch('error 4290 in file',LIMIT_ERROR);});
