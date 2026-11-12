import {test} from 'node:test';import assert from 'node:assert/strict';
import {claudeArguments} from '../src/claude';
import {integrationOverrides,assertSessionPrivacy} from '../src/codex';
import {adaptSkillContent,isolatedOpencodeEnv} from '../src/opencode';
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
 const env=isolatedOpencodeEnv({PATH:'/bin',HOME:'/Users/u',XDG_CONFIG_HOME:'/Users/u/.config',OPENCODE_CONFIG:'/x.json',OPENCODE_CONFIG_DIR:'/d',OPENCODE_CONFIG_CONTENT:'{}'},'/owla/session');
 assert.equal(env.XDG_CONFIG_HOME,'/owla/session/config');
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
