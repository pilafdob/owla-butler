/**
 * What each model family is good and bad at, for automatic selection.
 *
 * The live catalogues decide which models and efforts exist. These profiles
 * describe families, so a newer version of a family keeps a sensible profile.
 * `cost` is the relative drain on the user's plan (0 = free, 5 = heaviest);
 * `capability` is the hardest difficulty (1–5) the family handles well.
 * Free OpenCode models carry no curated quality data: a known open-model
 * family is rated by what it is known for, and an unknown name falls back
 * to a profile inferred from what its own catalogue entry reports.
 */

import type {ProviderModel,ProviderId} from './provider';
import {isOpencodeFreeModel} from './opencode-availability';

/** The kinds of work automatic selection distinguishes. */
export const TASK_KINDS=['lookup','edit','writing','transcription','vision','synthesis','organisation','reasoning','research','coding'] as const;
export type TaskKind=typeof TASK_KINDS[number];

export type ModelProfile={cost:number;capability:number;strong:TaskKind[];weak:TaskKind[]};

type Rule={match:RegExp;profile:ModelProfile};

// A provider's model families, rated by tier. When a provider adds a new
// family, add one line with its tier; a newer version of a known family
// matches the same line and keeps its profile.
const CODEX:Rule[]=[
 {match:/luna/i,profile:{cost:1,capability:2,strong:['lookup','edit','transcription'],weak:['reasoning','synthesis','research']}},
 {match:/terra/i,profile:{cost:2,capability:3,strong:['vision','writing','edit','transcription'],weak:['synthesis','reasoning']}},
 {match:/sol/i,profile:{cost:3,capability:4,strong:['synthesis','organisation','coding','research','edit'],weak:[]}},
 {match:/astra/i,profile:{cost:5,capability:5,strong:['reasoning','research','coding'],weak:[]}},
];

// One line per Claude family tier; aliases such as "haiku" or "opus" always match the newest version.
const CLAUDE:Rule[]=[
 {match:/haiku/i,profile:{cost:1,capability:2,strong:['lookup','edit','transcription'],weak:['reasoning','synthesis','research']}},
 {match:/sonnet/i,profile:{cost:2,capability:4,strong:['writing','edit','synthesis','organisation','coding'],weak:[]}},
 {match:/opus/i,profile:{cost:4,capability:5,strong:['reasoning','writing','synthesis','research'],weak:[]}},
 {match:/fable/i,profile:{cost:5,capability:5,strong:['reasoning','research'],weak:[]}},
];

// Known open-model families behind OpenCode's free tier.
//
// ADDING A NEW MODEL FAMILY: OpenCode adds models often, and every other
// provider can gain families too. To teach automatic mode about one, add a
// single line here — a name pattern matched against the model id and
// display name, and the kinds of work the family is known for. Nothing
// else needs to change: the live catalogue still decides which models,
// prices, modalities, context windows and efforts exist, and a family
// this list does not know yet falls back to the inferred profile below,
// so new arrivals keep routing sensibly until someone curates them.
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

// Priced at zero, or named free such as OpenCode Go's limited-time free models.
const isFree=isOpencodeFreeModel;

export const isFreeModel=isFree;

// Signals an unknown family gives about itself, taken from what the live
// catalogue already reports. Each raises the inferred capability to 3.
const CAPABLE_NAME=/(^|[^a-z])(pro|max|ultra|plus|thinking|reasoner|deep|-r)([^a-z]|$)/i;
function inferredCapability(model:ProviderModel,light:boolean):number{
 if(light)return 2;
 if(CAPABLE_NAME.test(model.id+' '+model.displayName))return 3;
 if((model.context??0)>=400_000)return 3;
 return 2;
}

// Relative drain on the user's OpenCode billing, from the catalogue's price.
function priceTier(model:ProviderModel):number{
 if(isFree(model))return 0;
 const output=model.cost?.output??0;
 return output>30?4:output>12?3:output>4?2:1;
}

function opencodeProfile(model:ProviderModel):ModelProfile{
 const text=model.id+' '+model.displayName;
 const light=/flash|lightning|small|mini|nano|lite/i.test(text);
 // OpenCode carries models from every provider connected in the terminal app,
 // including OpenAI and Anthropic ones. A family OWLA knows natively keeps
 // that family's rating wherever it rides, so "claude-opus through OpenCode"
 // weighs like Claude itself and "gpt-6-luna through OpenCode" like Luna.
 const nativeOpenai=/\bgpt\b|openai/i.test(text)?CODEX.find(rule=>rule.match.test(text))?.profile:undefined;
 const nativeClaude=/claude/i.test(text)?CLAUDE.find(rule=>rule.match.test(text))?.profile:undefined;
 const native=nativeClaude??nativeOpenai;
 if(native){
  const strong=new Set<TaskKind>(native.strong);
  if(model.inputModalities?.includes('image'))strong.add('vision');
  if((model.context??0)>=1_000_000)strong.add('synthesis');
  if(light)strong.add('lookup');
  return {cost:priceTier(model),capability:native.capability,strong:[...strong],weak:[...native.weak,'edit','organisation']};
 }
 const family=OPEN_FAMILIES.find(([pattern])=>pattern.test(text))?.[1];
 const strong=new Set<TaskKind>(family??[]);
 if(model.inputModalities?.includes('image'))strong.add('vision');
 if((model.context??0)>=1_000_000)strong.add('synthesis');
 if(light)strong.add('lookup');
 // A family this list does not know yet is rated by its own signals
 // instead of unproven, so models OpenCode adds keep routing sensibly.
 if(!family&&!light&&inferredCapability(model,light)===3)strong.add('reasoning');
 return {
  cost:priceTier(model),
  capability:family&&!light?3:inferredCapability(model,light),
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
  const dedupe=(list:ProviderModel[]):ProviderModel[]=>{
   const seen=new Map<string,ProviderModel>();
   for(const model of list){
    const key=model.id.split('/').slice(1).join('/')||model.id;
    const current=seen.get(key);
    if(!current){seen.set(key,model);continue;}
    const priceA=(model.cost?.input??0)+(model.cost?.output??0);
    const priceB=(current.cost?.input??0)+(current.cost?.output??0);
    const replace=priceA<priceB
     ||(priceA===priceB&&model.supportedReasoningEfforts.length>current.supportedReasoningEfforts.length)
     ||(priceA===priceB&&model.supportedReasoningEfforts.length===current.supportedReasoningEfforts.length&&model.id.startsWith('opencode-go/')&&!current.id.startsWith('opencode-go/'));
    if(replace)seen.set(key,model);
   }
   return [...seen.values()];
  };
  const unique=dedupe(models);
  const free=unique.filter(isFree).sort((a,b)=>modelProfile('opencode',b).capability-modelProfile('opencode',a).capability);
  const paid=unique.filter(m=>!isFree(m)).sort((a,b)=>modelProfile('opencode',b).capability-modelProfile('opencode',a).capability||((a.cost?.input??0)+(a.cost?.output??0))-((b.cost?.input??0)+(b.cost?.output??0)));
  const freeCap=paid.length?Math.ceil(limit/2):limit;
  result=[...free.slice(0,freeCap),...paid.slice(0,limit-freeCap)];
 }
 return result.slice(0,limit);
}
