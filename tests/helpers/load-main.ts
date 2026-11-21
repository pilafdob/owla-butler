// Loads src/main.ts in Node with test-only stand-ins for `obsidian` and `electron`.
import {registerHooks} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DevJournal} from '../../src/dev-journal';

const stub=pathToFileURL(join(__dirname,'obsidian-stub.cjs')).href;
let registered=false;
export function stubObsidian(){
 if(registered)return;
 registered=true;
 registerHooks({resolve(specifier,context,next){
  if(specifier==='obsidian'||specifier==='electron')return {url:stub,format:'commonjs',shortCircuit:true};
  return next(specifier,context);
 }});
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function loadMain():Promise<{Butler:any;ButlerView:any;obsidian:any}>{
 stubObsidian();
 const main=await import('../../src/main');
 const obsidian=await import('obsidian' as string);
 const Butler=(main as any).default?.default??(main as any).default;
 const ButlerView=await viewClass(Butler);
 return {Butler,ButlerView,obsidian:(obsidian as any).default??obsidian};
}

/** ButlerView is not exported; onload hands its factory to registerView. Stop onload there. */
async function viewClass(Butler:any){
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
 const storage=mkdtempSync(join(tmpdir(),'owla-view-class-'));
 const stopped=Symbol('stopped');
 let factory:((leaf:unknown)=>unknown)|undefined;
 const fake=Object.create(Butler.prototype);
 Object.assign(fake,{
  app:{vault:{adapter:{},getName:()=>'test'},workspace:{}},
  loadData:async()=>({}),saveData:async()=>{},save:async()=>{},
  vaultStorage:()=>storage,registerEditorExtension:()=>{},
  codexBridge:{},opencodeBridge:{},claudeBridge:{},hermesBridge:{},
  // Class fields are not initialized on Object.create(Butler.prototype);
  // onload reads devJournal, so the fake needs a real (pure) instance.
  devJournal:new DevJournal(),
  registerView:(type:string,make:(leaf:unknown)=>unknown)=>{if(type==='owla-butler-chat'){factory=make;throw stopped;}},
 });
 try{await fake.onload();}catch(e){if(e!==stopped)throw e;}
 if(!factory)throw Error('ButlerView factory was not registered.');
 return Object.getPrototypeOf(factory({app:fake.app})).constructor;
}
