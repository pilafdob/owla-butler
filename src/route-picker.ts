// The one-message override picker (Automatic mode): every compatible model and
// reasoning effort as one searchable list. Pure, so the order and labels are
// testable without Obsidian; main.ts shows the list in a FuzzySuggestModal,
// which filters and highlights it as the user types.
import {PROVIDER_NAMES,type ProviderId,type ProviderModel} from './provider';
import {modelKey,type CodexRoute} from './routing';

export type RouteItem={provider:ProviderId;model:ProviderModel};
export type RouteChoice=
 {kind:'automatic';label:string}
 |{kind:'route';label:string;route:CodexRoute&{provider:ProviderId}};

const modelName=(item:RouteItem)=>(item.provider==='opencode'||item.provider==='hermes')&&item.model.providerID&&item.model.providerID!==item.provider
 ?item.model.displayName+' ('+item.model.providerID+')':item.model.displayName;

/**
 * One choice per model and effort, plus "Automatic selection". The label holds
 * the provider, the model's display name, its id when that differs, and the
 * effort, so typing any of them ("sonnet high", "luna", "opencode") finds it.
 * Order, which is what the user sees before typing: the current choice first,
 * then Automatic, then each model with its default effort ahead of the others.
 */
export function routeChoices(items:RouteItem[],initial?:CodexRoute):RouteChoice[]{
 const choices:RouteChoice[]=[];
 for(const item of items){
  const key=modelKey(item.provider,item.model),name=modelName(item);
  const efforts=item.model.supportedReasoningEfforts.map(option=>option.reasoningEffort);
  const ordered=[...efforts.filter(effort=>effort===item.model.defaultReasoningEffort),...efforts.filter(effort=>effort!==item.model.defaultReasoningEffort)];
  for(const effort of ordered){
   const parts=[PROVIDER_NAMES[item.provider],name];
   if(key!==item.model.displayName&&key!==name)parts.push(key);
   parts.push(effort+(effort===item.model.defaultReasoningEffort?' (default)':''));
   choices.push({kind:'route',label:parts.join(' · '),route:{provider:item.provider,model:key,effort}});
  }
 }
 const automatic:RouteChoice={kind:'automatic',label:'Automatic selection · let OWLA choose'};
 const current=initial?choices.findIndex(choice=>choice.kind==='route'&&choice.route.model===initial.model&&choice.route.effort===initial.effort&&(!initial.provider||choice.route.provider===initial.provider)):-1;
 if(current<0)return [automatic,...choices];
 const [first]=choices.splice(current,1);
 return [first,automatic,...choices];
}
