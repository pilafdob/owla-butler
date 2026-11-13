import {test} from 'node:test';import assert from 'node:assert/strict';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {claudeArguments} from '../src/claude';
import {integrationOverrides,assertSessionPrivacy} from '../src/codex';
import {adaptSkillContent,isolatedOpencodeEnv,opencodeConfigPath} from '../src/opencode';
import {sanitizedEnv} from '../src/cli';
import {OPENCODE_PLUGIN_SOURCE} from '../src/opencode-plugin';
import {PROVIDER_IDS,prefixToolNames,toolName} from '../src/provider';

// Every provider OWLA drives must reach the vault only through OWLA's own tools,
// and must not inherit the user's plugins, MCP servers, skills or instructions.

test('Codex: inherited plugins and MCP servers are switched off, telemetry must be off',()=>{
 assert.deepEqual(integrationOverrides({mcp_servers:{fs:{}},plugins:{x:{enabled:true}}}),['mcp_servers={"fs"={enabled=false}}','plugins={"x"={enabled=false}}']);
 assert.throws(()=>assertSessionPrivacy({analytics:{enabled:true},feedback:{enabled:false},otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'}}));
});

test('Claude Code: safe mode, no built-in tools, only OWLA tools allowed',()=>{
 const args=claudeArguments('haiku','low','S',[{type:'function',name:'read_note',description:'',inputSchema:{}}],false);
 for(const flag of ['--safe-mode','--strict-mcp-config','--disable-slash-commands','--no-session-persistence'])assert.ok(args.includes(flag),flag);
 assert.equal(args[args.indexOf('--tools')+1],'');
 assert.equal(args[args.indexOf('--allowedTools')+1],'mcp__owla__read_note');
});

test('OpenCode: the user’s global config, Claude Code skills and config overrides are not inherited',()=>{
 const directory=join(tmpdir(),'owla','session');
 const env=isolatedOpencodeEnv({PATH:'/bin',HOME:'/Users/u',XDG_CONFIG_HOME:'/Users/u/.config',XDG_DATA_HOME:'/Users/u/.local/share',OPENCODE_API_KEY:'test-opencode-key',OPENAI_API_KEY:'test-openai-key',OPENCODE_CONFIG:'/x.json',OPENCODE_CONFIG_DIR:'/d',OPENCODE_CONFIG_CONTENT:'{}',NODE_OPTIONS:'--require /x.js',LD_PRELOAD:'/x.so',DYLD_INSERT_LIBRARIES:'/x.dylib',NODE_TLS_REJECT_UNAUTHORIZED:'0',HTTPS_PROXY:'http://proxy'},directory);
 // Ancestor opencode.json, .opencode/ config and .opencode/plugins are not discovered.
 assert.equal(env.OPENCODE_DISABLE_PROJECT_CONFIG,'1');
 assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE,'1');
 assert.equal(opencodeConfigPath(directory),join(env.XDG_CONFIG_HOME??'','opencode','opencode.json'));
 // Execution hooks are dropped; enterprise proxies stay.
 for(const key of ['NODE_OPTIONS','LD_PRELOAD','DYLD_INSERT_LIBRARIES','NODE_TLS_REJECT_UNAUTHORIZED'])assert.equal(env[key],undefined,key);
 assert.equal(env.HTTPS_PROXY,'http://proxy');
 assert.equal(env.XDG_CONFIG_HOME,join(directory,'config'));
 assert.equal(env.XDG_DATA_HOME,'/Users/u/.local/share');
 assert.equal(env.OPENCODE_API_KEY,'test-opencode-key');
 assert.equal(env.OPENAI_API_KEY,'test-openai-key');
 assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE,'1');
 assert.equal(env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS,'1');
 for(const key of ['OPENCODE_CONFIG','OPENCODE_CONFIG_DIR','OPENCODE_CONFIG_CONTENT'])assert.equal(env[key],undefined,key);
 // Sign-ins stay reachable: the data folder and home are untouched.
 assert.equal(env.HOME,'/Users/u');
 assert.equal(env.PATH,'/bin');
 for(const tool of ['shell','write','edit','read','glob','grep','webfetch','subagent'])assert.ok(OPENCODE_PLUGIN_SOURCE.includes('"'+tool+'"'),tool);
 assert.match(OPENCODE_PLUGIN_SOURCE,/ctx\.mcp\.transform/);
});

test('skill text names the tools each provider actually exposes',()=>{
 const skill='Use read_note, then propose_pdf_annotation or propose_edit.';
 assert.equal(adaptSkillContent(skill),'Use owla_read_note, then owla_propose_pdf_annotation or owla_propose_edit.');
 for(const provider of PROVIDER_IDS){
  const text=prefixToolNames(skill,provider);
  for(const base of ['read_note','propose_pdf_annotation','propose_edit'])assert.ok(text.includes(toolName(provider,base)),provider+' '+base);
  // Renaming twice must not stack prefixes.
  assert.equal(prefixToolNames(text,provider),text);
 }
});

test('Codex and Claude Code: API keys, endpoint overrides and execution hooks are not inherited',()=>{
 const env=sanitizedEnv({PATH:'/bin',HOME:'/Users/u',OPENAI_API_KEY:'k',ANTHROPIC_API_KEY:'k',OPENAI_BASE_URL:'https://elsewhere',ANTHROPIC_BASE_URL:'https://elsewhere',NODE_OPTIONS:'--require /x.js',LD_PRELOAD:'/x.so',HTTPS_PROXY:'http://proxy',NODE_EXTRA_CA_CERTS:'/ca.pem'});
 for(const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','OPENAI_BASE_URL','ANTHROPIC_BASE_URL','NODE_OPTIONS','LD_PRELOAD'])assert.equal(env[key],undefined,key);
 for(const key of ['PATH','HOME','HTTPS_PROXY','NODE_EXTRA_CA_CERTS'])assert.ok(env[key],key);
});
