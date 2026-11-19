import {test} from 'node:test';import assert from 'node:assert/strict';
import {decodeOpencodeModel,findOpencodeExecutable,opencodePermissions,adaptSkillContent,supportedOpencodeVersion,friendlyOpencodeError,opencodeRegionRestricted,OPENCODE_TOOL_NAMESPACE} from '../src/opencode';
import {decodeOpencodeUsage} from '../src/usage';
import {skillDefinitions} from '../src/knowledge';
import {OPENCODE_PLUGIN_SOURCE} from '../src/opencode-plugin';
import {prefixToolNames,toolName} from '../src/provider';
import {codexExhaustion,describeProviders,exhaustionLabel,opencodeExhaustion} from '../src/exhaustion';

test('OpenCode version checks require the tested 2.2 protocol',()=>{
 assert.equal(supportedOpencodeVersion('opencode v2.2.7'),true);
 assert.equal(supportedOpencodeVersion('2.3.0'),true);
 assert.equal(supportedOpencodeVersion('2.2.0'),true);
 assert.equal(supportedOpencodeVersion('2.1.9'),false);
 assert.equal(supportedOpencodeVersion('1.9.0'),false);
 assert.equal(supportedOpencodeVersion('unknown'),false);
});

test('OpenCode discovery uses executable files in absolute directories',async()=>{
 const {mkdtempSync,mkdirSync,writeFileSync,chmodSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join,delimiter}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'owla-opencode-discovery-'));
 try{
  const first=join(root,'first'),second=join(root,'second');
  mkdirSync(first);mkdirSync(second);
  if(process.platform==='win32'){
   writeFileSync(join(first,'opencode.txt'),'not executable');
   writeFileSync(join(second,'opencode.cmd'),'@echo off\r\nexit /b 0\r\n');
   assert.equal(findOpencodeExecutable(['.',first,second].join(delimiter),[]),join(second,'opencode.cmd'));
   rmSync(join(second,'opencode.cmd'));
   assert.equal(findOpencodeExecutable([first,second].join(delimiter),[]),'');
  }else{
   writeFileSync(join(first,'opencode'),'not executable',{mode:0o600});
   writeFileSync(join(second,'opencode'),'#!/bin/sh\nexit 0\n',{mode:0o700});
   assert.equal(findOpencodeExecutable(['.',first,second].join(delimiter),[]),join(second,'opencode'));
   chmodSync(join(second,'opencode'),0o600);
   assert.equal(findOpencodeExecutable([first,second].join(delimiter),[]),'');
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('OpenCode models become OWLA models with variant reasoning levels',()=>{
 const model=decodeOpencodeModel({
  id:'deepseek-v4.1-flash-free',modelID:'deepseek-v4.1-flash-free',providerID:'opencode',
  name:'DeepSeek V4.1 Flash Free',type:'chat',enabled:true,
  capabilities:{tools:true,input:['text','image'],output:['text']},
  variants:[{id:'low'},{id:'high'},{id:'max'}],
  cost:[{input:0,output:0,cache:{read:0,write:0}}],
  limit:{context:200000}
 });
 assert.equal(model?.id,'opencode/deepseek-v4.1-flash-free');
 assert.equal(model?.model,'deepseek-v4.1-flash-free');
 assert.equal(model?.providerID,'opencode');
 assert.equal(model?.displayName,'DeepSeek V4.1 Flash Free');
 assert.deepEqual(model?.supportedReasoningEfforts.map(e=>e.reasoningEffort),['low','high','max']);
 assert.equal(model?.defaultReasoningEffort,'low');
 assert.deepEqual(model?.inputModalities,['text','image']);
 assert.equal(model?.cost?.input,0);
 assert.equal(model?.context,200000);
 assert.equal(decodeOpencodeModel({providerID:'opencode',modelID:'x',enabled:false}),null);
 assert.equal(decodeOpencodeModel({providerID:'opencode',modelID:'x',type:'image'}),null);
 assert.equal(decodeOpencodeModel({modelID:'x'}),null);
});

test('a model without variants still offers one reasoning level',()=>{
 const model=decodeOpencodeModel({providerID:'opencode',modelID:'plain',type:'chat',capabilities:{tools:true,input:['text'],output:['text']}});
 assert.deepEqual(model?.supportedReasoningEfforts.map(e=>e.reasoningEffort),['default']);
});

test('the OpenCode session allows only the OWLA tools and the bundled skills',()=>{
 const rules=opencodePermissions(true,['read_note','propose_edit','read_note']);
 assert.deepEqual(rules[0],{action:'*',resource:'*',effect:'deny'});
 // Exact names only: a wildcard would also allow another plugin's owla_ tools.
 assert.equal(rules.some(rule=>rule.action.includes('*')&&rule.effect==='allow'),false);
 const nonSkillAllows=rules.filter(rule=>rule.effect==='allow'&&rule.action!=='skill').map(rule=>rule.action);
 assert.deepEqual(nonSkillAllows,['owla_read_note','owla_propose_edit','websearch']);
 const skills=rules.filter(rule=>rule.action==='skill');
 assert.equal(skills.length,skillDefinitions().length);
 assert.ok(skills.every(rule=>rule.effect==='allow'));
 const offlineRules=opencodePermissions(false,['read_note']);
 assert.deepEqual(offlineRules.filter(rule=>rule.effect==='allow'&&rule.action!=='skill').map(rule=>rule.action),['owla_read_note']);
 assert.equal(offlineRules.some(rule=>rule.action==='websearch'),false);
});

test('bundled skills keep their content and name the OpenCode tools',()=>{
 const skills=skillDefinitions();
 assert.equal(skills.length,11);
 for(const id of ['owla-excalidraw','owla-canvas','owla-bases'])assert.ok(skills.some(skill=>skill.id===id&&skill.name.startsWith('OWLA ')),id);
 assert.equal(adaptSkillContent('Use read_excalidraw, then propose_canvas.'),'Use owla_read_excalidraw, then owla_propose_canvas.');
 assert.ok(skills.every(skill=>skill.id&&skill.name&&skill.description&&skill.content.length>0));
 assert.ok(skills.some(skill=>skill.id==='owla-formatting'));
 const adapted=adaptSkillContent('Use read_pdf for the page.');
 assert.equal(adapted,'Use owla_read_pdf for the page.');
 assert.equal(adaptSkillContent('Already owla_read_pdf.'),'Already owla_read_pdf.');
});

test('the instruction text names the tools the active provider exposes',()=>{
 assert.equal(toolName('codex','read_note'),'read_note');
 assert.equal(toolName('opencode','read_note'),'owla_read_note');
 assert.equal(prefixToolNames('use read_note and propose_edit', 'codex'),'use read_note and propose_edit');
 assert.equal(prefixToolNames('use read_note and propose_edit', 'opencode'),'use owla_read_note and owla_propose_edit');
 assert.equal(prefixToolNames('owla_read_note', 'opencode'),'owla_read_note');
});

test('OpenCode usage meters and budgets become the shared usage shape',()=>{
 const usage=decodeOpencodeUsage({
  workspace:{id:'w',usageURL:'https://example.com'},
  go:{rolling:{percent:40,limited:true,resetsAt:1800000000000},weekly:{percent:0,limited:false,resetsAt:0},monthly:{percent:90,limited:true,resetsAt:1900000000000}},
  budgets:[{id:'daily',limit:10,spent:2.5}]
 });
 assert.ok(usage);
 const buckets=usage?.rateLimitsByLimitId??{};
 assert.equal(buckets['opencode-go-rolling']?.primary?.usedPercent,40);
 assert.equal(buckets['opencode-go-rolling']?.primary?.resetsAt,1800000000);
 assert.equal(buckets['opencode-go-monthly']?.primary?.usedPercent,90);
 assert.equal(buckets['opencode-go-weekly'],undefined);
 assert.equal(buckets['opencode-budget-daily']?.primary?.usedPercent,25);
 assert.equal(decodeOpencodeUsage(null),null);
 assert.equal(decodeOpencodeUsage({}),null);
});

test('a provider limit is reported as exhausted with the moment it resets',()=>{
 assert.equal(codexExhaustion(null).exhausted,false);
 const usage={rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:100,resetsAt:1800000000}}}};
 const state=codexExhaustion(usage);
 assert.equal(state.exhausted,true);
 assert.equal(state.resetsAt,1800000000);
 assert.match(exhaustionLabel(state),/resets/i);
 const partial=codexExhaustion({rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:80}}}});
 assert.equal(partial.exhausted,false);
 const opencode=opencodeExhaustion('Free usage limit reached.',1800000000);
 assert.equal(opencode.exhausted,true);
 assert.equal(opencode.provider,'opencode');
 assert.equal(opencodeExhaustion('network error',null).exhausted,false);
 assert.match(describeProviders([codexExhaustion(usage),opencode]),/Codex/);
 assert.match(describeProviders([codexExhaustion(usage),opencode]),/OpenCode/);
});

test('OpenCode errors stay readable and never leak a raw body',()=>{
 assert.match(friendlyOpencodeError(Error('Free usage limit reached.')),/usage limit/i);
 assert.match(friendlyOpencodeError(Error('429 quota')),/usage limit/i);
 assert.equal(friendlyOpencodeError(Error('x'.repeat(2000))).length,800);
});

test('a privacy-regions refusal is recognised and explained without the console link',()=>{
 const notice='This OpenCode Go model is hosted outside Europe and the United States. Select Global at https://opencode.ai/console/org_00000000000000000000EXAMPLE/settings/privacy#regions to use it.';
 assert.equal(opencodeRegionRestricted(Error(notice)),true);
 assert.equal(opencodeRegionRestricted(Error('Free usage limit reached.')),false);
 assert.equal(opencodeRegionRestricted('hosted outside the allowed regions'),true);
 const friendly=friendlyOpencodeError(Error(notice));
 assert.match(friendly,/privacy regions setting does not allow/i);
 assert.match(friendly,/Choose another model/i);
 assert.ok(!friendly.includes('opencode.ai/console'),'the org-specific console URL must not be repeated');
});

test('the shipped plugin replaces the OpenCode tools with the OWLA tools',()=>{
 assert.match(OPENCODE_PLUGIN_SOURCE,/namespace: "owla"/);
 assert.match(OPENCODE_PLUGIN_SOURCE,/codemode: false/);
 for(const tool of ['shell','write','edit','read','patch','glob','grep','execute','subagent','webfetch','opencode_models','opencode_list_mcp_resources','opencode_read_mcp_resource']){
  assert.ok(OPENCODE_PLUGIN_SOURCE.includes('"'+tool+'"'),tool);
 }
 assert.match(OPENCODE_PLUGIN_SOURCE,/OWLA_TOOL_ENDPOINT/);
 assert.match(OPENCODE_PLUGIN_SOURCE,/authorization: "Bearer " \+ token/);
 assert.match(OPENCODE_PLUGIN_SOURCE,/for \(const entry of editor\.list\(\)\) editor\.remove\(entry\[0\]\)/);
 assert.ok(OPENCODE_PLUGIN_SOURCE.includes(OPENCODE_TOOL_NAMESPACE+'_')===false);
});

test('missing OpenCode limits are explained, with the free-limit reset when known',async()=>{
 const {opencodeNoLimitsMessage}=await import('../src/opencode');
 assert.match(opencodeNoLimitsMessage(null),/no plan limits/);
 assert.match(opencodeNoLimitsMessage({provider:'opencode',exhausted:true,resetsAt:2000,reason:'',scope:'free models'},1000),/resets/);
 assert.match(opencodeNoLimitsMessage({provider:'opencode',exhausted:true,resetsAt:null,reason:'',scope:'provider'},1000),/did not say/);
 assert.match(opencodeNoLimitsMessage({provider:'opencode',exhausted:true,resetsAt:500,reason:'',scope:'provider'},1000),/did not say/);
});

test('a Codex window whose reset has passed no longer blocks, and the latest full reset decides',()=>{
 const now=1_000_000;
 const past={rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:100,resetsAt:now-1}}}};
 assert.equal(codexExhaustion(past,undefined,now).exhausted,false);
 const both={rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:100,resetsAt:now+600},secondary:{usedPercent:100,resetsAt:now+7200}}}};
 const state=codexExhaustion(both,undefined,now);
 assert.equal(state.exhausted,true);
 assert.equal(state.resetsAt,now+7200);
 // A full window without a reset still blocks; a non-finite percentage is unknown, not full.
 assert.equal(codexExhaustion({rateLimits:{primary:{usedPercent:100}}},undefined,now).exhausted,true);
 assert.equal(codexExhaustion({rateLimits:{primary:{usedPercent:NaN}}},undefined,now).exhausted,false);
});

test('a Codex limit error without a readable window holds back for a bounded retry',()=>{
 const now=1_000_000;
 for(const error of ['429 Too Many Requests','rate_limit_exceeded','You have reached your usage limit','quota exceeded','too many requests']){
  const state=codexExhaustion(null,error,now);
  assert.equal(state.exhausted,true,error);
  assert.equal(state.resetsAt,now+15*60);
 }
 assert.equal(codexExhaustion(null,'network unreachable',now).exhausted,false);
 // A readable full window keeps its own (later) reset instead of the retry window.
 const usage={rateLimitsByLimitId:{codex:{primary:{usedPercent:100,resetsAt:now+86400}}}};
 assert.equal(codexExhaustion(usage,'429',now).resetsAt,now+86400);
});

test('OpenCode limit errors are recognised across their wordings',()=>{
 for(const error of ['rate_limit_error','rate-limit exceeded','quota exceeded','HTTP 429','too many requests','limit reached']){
  assert.equal(opencodeExhaustion(error,2000000000).exhausted,true,error);
 }
 assert.equal(opencodeExhaustion('Free usage limit reached.',2000000000).scope,'free models');
 assert.equal(opencodeExhaustion('socket hang up',null).exhausted,false);
 assert.match(friendlyOpencodeError(Error('Your usage limit was reached')),/usage limit/i);
 assert.match(friendlyOpencodeError(Error('rate_limit_error')),/usage limit/i);
});
