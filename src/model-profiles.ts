/**
 * What each model family is good and bad at, for automatic selection.
 *
 * The live catalogues decide which models and efforts exist. These profiles
 * describe families, so a newer version of a family keeps a sensible profile.
 * `cost` is the relative drain on the user's plan (0 = free, 5 = heaviest);
 * `capability` is the hardest difficulty (1–5) the family handles well.
 * Free OpenCode models carry no curated quality data: a known open-model
 * family is rated by what it is known for, an unknown name counts as unproven.
 */

import type {ProviderModel,ProviderId} from './provider';

/** The kinds of work automatic selection distinguishes. */
export const TASK_KINDS=['lookup','edit','writing','transcription','vision','synthesis','organisation','reasoning','research','coding'] as const;
export type TaskKind=typeof TASK_KINDS[number];

export type ModelProfile={cost:number;capability:number;strong:TaskKind[];weak:TaskKind[]};

type Rule={match:RegExp;profile:ModelProfile};

const CODEX:Rule[]=[
 {match:/luna/i,profile:{cost:1,capability:2,strong:['lookup','edit','transcription'],weak:['reasoning','synthesis','research']}},
 {match:/terra/i,profile:{cost:2,capability:3,strong:['vision','writing','edit','transcription'],weak:['synthesis','reasoning']}},
 {match:/sol/i,profile:{cost:3,capability:4,strong:['synthesis','organisation','coding','research','edit'],weak:[]}},
 {match:/astra/i,profile:{cost:5,capability:5,strong:['reasoning','research','coding'],weak:[]}},
];

const CLAUDE:Rule[]=[
 {match:/haiku/i,profile:{cost:1,capability:2,strong:['lookup','edit','transcription'],weak:['reasoning','synthesis','research']}},
 {match:/sonnet/i,profile:{cost:2,capability:4,strong:['writing','edit','synthesis','organisation','coding'],weak:[]}},
 {match:/opus/i,profile:{cost:4,capability:5,strong:['reasoning','writing','synthesis','research'],weak:[]}},
 {match:/fable/i,profile:{cost:5,capability:5,strong:['reasoning','research'],weak:[]}},
];

// Known open-model families behind OpenCode's free tier.
export const OPEN_FAMILIES:[RegExp,TaskKind[]][]=[
 [/deepseek/i,['reasoning','coding']],
 [/glm/i,['coding','organisation']],
 [/minimax/i,['synthesis','coding']],
 [/nemotron/i,['reasoning']],
 [/mimo/i,['vision','transcription']],
 [/qwen/i,['reasoning','coding']],
 [/kimi/i,['coding','synthesis']],
 [/gemini/i,['vision','synthesis']],
 [/llama/i,['lookup','writing']],
 [/mistral|devstral/i,['coding','writing']],
 [/gpt-oss/i,['reasoning']],
 [/grok/i,['reasoning']],
];

const isFree=(model:ProviderModel)=>!!model.cost&&model.cost.input===0&&model.cost.output===0;

function opencodeProfile(model:ProviderModel):ModelProfile{
 const text=model.id+' '+model.displayName;
 const light=/flash|lightning|small|mini|nano|lite/i.test(text);
 const family=OPEN_FAMILIES.find(([pattern])=>pattern.test(text))?.[1];
 const strong=new Set<TaskKind>(family??[]);
 if(model.inputModalities?.includes('image'))strong.add('vision');
 if((model.context??0)>=1_000_000)strong.add('synthesis');
 if(light)strong.add('lookup');
 return {
  cost:isFree(model)?0:model.cost&&model.cost.output>10?3:1,
  capability:family&&!light?3:2,
  strong:[...strong],
  // Tool-driven work through OWLA is unproven on these models.
  weak:[...(light?['reasoning','synthesis','research'] as TaskKind[]:[]),'edit','organisation'],
 };
}

export function modelProfile(provider:ProviderId,model:ProviderModel):ModelProfile{
 if(provider==='opencode')return opencodeProfile(model);
 const text=model.id+' '+model.displayName;
 return (provider==='claude'?CLAUDE:CODEX).find(rule=>rule.match.test(text))?.profile
  ??{cost:3,capability:3,strong:[],weak:[]};
}

/**
 * The models worth offering in automatic selection: older generations are
 * dropped when a current one exists.
 */
export function currentModels(provider:ProviderId,models:ProviderModel[],limit=provider==='opencode'?6:8):ProviderModel[]{
 let result=models;
 if(provider==='codex'){
  const current=models.filter(model=>!/previous generation|older/i.test(model.description??''));
  if(current.length)result=current;
 }else if(provider==='claude'){
  // Aliases such as "opus" always point at the newest model of the family.
  const aliases=models.filter(model=>!model.id.startsWith('claude-'));
  if(aliases.length)result=aliases;
 }else{
  const known=(model:ProviderModel)=>OPEN_FAMILIES.some(([pattern])=>pattern.test(model.id+' '+model.displayName));
  result=[...models].sort((a,b)=>Number(isFree(b))-Number(isFree(a))||Number(known(b))-Number(known(a)));
 }
 return result.slice(0,limit);
}
