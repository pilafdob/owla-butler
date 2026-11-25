// The one-message override picker: one searchable choice per model and effort.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {routeChoices} from '../src/route-picker';
import type {ProviderModel} from '../src/provider';

const model=(id:string,displayName:string,efforts:string[],defaultReasoningEffort=efforts[0],extra:Partial<ProviderModel>={}):ProviderModel=>
 ({id,model:id,displayName,isDefault:false,defaultReasoningEffort,supportedReasoningEfforts:efforts.map(reasoningEffort=>({reasoningEffort,description:''})),...extra});

const items=[
 {provider:'codex' as const,model:model('gpt-6-luna','GPT-6 Luna',['low','medium','high'],'medium')},
 {provider:'claude' as const,model:model('sonnet','Sonnet',['default'])},
 {provider:'opencode' as const,model:model('anthropic/claude-haiku','Claude Haiku',['low'],'low',{providerID:'anthropic'})},
];

test('every model and effort is one choice whose label names provider, model, id and effort',()=>{
 const choices=routeChoices(items);
 assert.equal(choices[0].kind,'automatic','without a current choice Automatic comes first');
 assert.deepEqual(choices.slice(1).map(choice=>choice.label),[
  'Codex · GPT-6 Luna · gpt-6-luna · medium (default)',
  'Codex · GPT-6 Luna · gpt-6-luna · low',
  'Codex · GPT-6 Luna · gpt-6-luna · high',
  'Claude Code · Sonnet · sonnet · default (default)',
  'OpenCode · Claude Haiku (anthropic) · anthropic/claude-haiku · low (default)',
 ]);
 const luna=choices[2];
 assert.ok(luna.kind==='route');
 assert.deepEqual(luna.route,{provider:'codex',model:'gpt-6-luna',effort:'low'});
});

test('the current override or last automatic route is listed first, then Automatic',()=>{
 const choices=routeChoices(items,{provider:'codex',model:'gpt-6-luna',effort:'high'});
 assert.equal(choices[0].label,'Codex · GPT-6 Luna · gpt-6-luna · high');
 assert.equal(choices[1].kind,'automatic');
 assert.equal(choices.length,1+5,'nothing is duplicated or lost');
 // An effort the model does not offer is not invented; Automatic leads instead.
 assert.equal(routeChoices(items,{provider:'codex',model:'gpt-6-luna',effort:'xhigh'})[0].kind,'automatic');
 assert.equal(routeChoices(items,{provider:'claude',model:'gpt-6-luna',effort:'low'})[0].kind,'automatic','the provider must match too');
});
