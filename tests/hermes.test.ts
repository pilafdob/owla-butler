import {test} from 'node:test';import assert from 'node:assert/strict';
import {hermesPrivateConfig,HERMES_PRIVATE_EXCLUDED,friendlyHermesError} from '../src/hermes';
import {canonicalModelKey,sameModelRoute,type AutoEntry} from '../src/auto-route';
import {PROVIDER_IDS,toolName} from '../src/provider';
import {migrateSettings} from '../src/core';
import type {ProviderModel} from '../src/provider';

const model=(id:string,providerID?:string):ProviderModel=>({id,model:id,providerID,displayName:id,isDefault:false,defaultReasoningEffort:'default',supportedReasoningEfforts:[{reasoningEffort:'default',description:''}]});

test('Hermes is a provider and reaches OWLA tools as mcp__owla__<name>, the name Hermes registers',()=>{
 assert.ok(PROVIDER_IDS.includes('hermes'));
 // Hermes: tools/mcp_tool_schema.py mcp_prefixed_tool_name → mcp__<server>__<tool>.
 assert.equal(toolName('hermes','read_note'),'mcp__owla__read_note');
});

test('Hermes private home: no built-in tools, plugins, MCP servers, memory or user skills',()=>{
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
