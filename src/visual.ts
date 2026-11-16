/**
 * Obsidian-side engines for Canvas, Bases and Excalidraw. Each uses the real
 * renderer or engine of the file type, in a temporary leaf that is closed
 * again, and never saves: saving is disabled on the temporary view first.
 */
import type {App,TFile,WorkspaceLeaf} from 'obsidian';
import type {ElementFactory,ExcalidrawElement} from './excalidraw';

/*
 * The parts of Obsidian's Canvas and Bases views, Electron and the Excalidraw
 * plugin that OWLA uses. None has public types; these interfaces name exactly
 * what OWLA relies on, so a change in those internals fails in one place.
 */
type NativeImage={getSize():{width:number;height:number};resize(options:{width:number;height:number;quality:string}):NativeImage;toPNG():Uint8Array&{toString(encoding:'base64'):string};isEmpty?():boolean};
type WebContents={capturePage(rect:{x:number;y:number;width:number;height:number}):Promise<NativeImage>;invalidate?():void};
type ElectronWindow={electron?:{remote?:{getCurrentWebContents?():WebContents}};require?:(id:string)=>{remote?:{getCurrentWebContents?():WebContents}}};
type CanvasNodeInternals={isContentMounted?:boolean;contentEl?:HTMLElement;mountContent?():void;getData?():{type?:string}};
type CanvasInternals={wrapperEl:HTMLElement;deselectAll?():void;zoomToFit?():void;nodes?:Map<string,CanvasNodeInternals>};
type BaseValue={toString?():string}|null|undefined;
type BaseEntry={getValue?(property:string):BaseValue};
type BaseViewConfig={order?:unknown;get?(key:string):unknown;filters?:unknown};
type BasesController={results?:Map<unknown,BaseEntry>;errorEl?:HTMLElement;errors?:Iterable<unknown>;error?:{message?:string}|string|null;viewName?:string;getQueryViewNames?():string[];getViewConfig?(name:string):BaseViewConfig|undefined;query?:{formulas?:unknown;filters?:unknown;views?:BaseViewConfig[];getViewConfig?(name:string):BaseViewConfig|undefined}};
type TemporaryView={getViewType?():string;setViewData(data:string,clear:boolean):void;save?:()=>Promise<void>;requestSave?:()=>void;saveImmediately?:()=>Promise<void>;canvas?:CanvasInternals;controller?:BasesController};
type ExcalidrawStyle=Record<string,unknown>;
type ExcalidrawApi={
 reset():void;destroy?():void;style:ExcalidrawStyle;elementsDict:Record<string,ExcalidrawElement>;
 getElement(id:string):ExcalidrawElement;getElements():ExcalidrawElement[];
 addRect(x:number,y:number,w:number,h:number):string;addEllipse(x:number,y:number,w:number,h:number):string;addDiamond(x:number,y:number,w:number,h:number):string;
 addText(x:number,y:number,text:string,formatting?:Record<string,unknown>):string;
 connectObjects(a:string,ca:null,b:string,cb:null,formatting:Record<string,unknown>):string;
 addFrame(x:number,y:number,w:number,h:number,name?:string):string;addElementsToFrame(frame:string,ids:string[]):void;
 measureText(text:string):{width:number;height:number};
 createPNGBase64(path?:string,scale?:number):Promise<unknown>;
 decompressFromBase64?(data:string):string;
};
type ExcalidrawGlobal={getAPI():ExcalidrawApi}&Partial<ExcalidrawApi>;
type AppInternals={internalPlugins?:{plugins?:Record<string,{enabled?:boolean}|undefined>};plugins?:{enabledPlugins?:Set<string>;plugins?:Record<string,unknown>}};

const internal=(app:App,id:string)=>(app as unknown as AppInternals).internalPlugins?.plugins?.[id]?.enabled===true;
export const canvasAvailable=(app:App)=>internal(app,'canvas');
export const basesAvailable=(app:App)=>internal(app,'bases');
const EXCALIDRAW='obsidian-excalidraw-plugin';
export function excalidrawAvailable(app:App){
 const plugins=(app as unknown as AppInternals).plugins;
 return plugins?.enabledPlugins?.has?.(EXCALIDRAW)===true&&!!plugins?.plugins?.[EXCALIDRAW]&&!!excalidrawAutomate();
}
function excalidrawAutomate():ExcalidrawGlobal|null{
 const ea=(window as unknown as {ExcalidrawAutomate?:ExcalidrawGlobal}).ExcalidrawAutomate;
 return ea&&typeof ea.getAPI==='function'?ea:null;
}
/** A private ExcalidrawAutomate instance, so the user's scripts and the global instance are not disturbed. */
async function withAutomate<T>(work:(ea:ExcalidrawApi)=>Promise<T>|T):Promise<T>{
 const global=excalidrawAutomate();
 if(!global)throw Error('The Excalidraw plugin is not enabled.');
 const ea=global.getAPI();
 try{ea.reset();return await work(ea);}finally{try{ea.destroy?.();}catch{/* already released */}}
}

/**
 * Node's timers keep running in a covered or background window, where
 * Chromium delays page timers (up to once a minute) and stops animation frames.
 */
type Timers={setTimeout(callback:()=>void,ms:number):unknown;clearTimeout(handle:unknown):void};
const timers:Timers=(()=>{try{const node=(window as unknown as {require?:(id:string)=>Timers}).require?.('timers');if(node)return node;}catch{/* not available outside Electron */}return {setTimeout:(callback,ms)=>window.setTimeout(callback,ms),clearTimeout:handle=>window.clearTimeout(handle as number)};})();
const pause=(ms:number)=>new Promise<void>(resolve=>{timers.setTimeout(resolve,ms);});
/** Rejects when work takes longer than `ms`, so a capture can never leave the window covered. */
function within<T>(work:Promise<T>,ms:number,message:string):Promise<T>{
 let timer:unknown;
 return Promise.race([work,new Promise<T>((_resolve,reject)=>{timer=timers.setTimeout(()=>reject(Error(message)),ms);})]).finally(()=>timers.clearTimeout(timer));
}

/** Opens a file in a new, inactive tab whose view never saves, runs the work and closes the tab. */
async function withTemporaryView<T>(app:App,open:(leaf:WorkspaceLeaf)=>Promise<void>,work:(view:TemporaryView)=>Promise<T>):Promise<T>{
 const leaf=app.workspace.getLeaf('tab');
 try{
  await open(leaf);
  const view=leaf.view as unknown as TemporaryView;
  view.save=async()=>{};view.requestSave=()=>{};view.saveImmediately=async()=>{};
  return await work(view);
 }finally{leaf.detach();}
}

/** Downscales a captured image to at most 2048 px on its long side and returns a PNG data URL. */
function imageUrl(image:NativeImage):string{
 const size=image.getSize(),scale=Math.min(1,2048/Math.max(size.width,size.height,1));
 const sized=scale<1?image.resize({width:Math.round(size.width*scale),height:Math.round(size.height*scale),quality:'good'}):image;
 return 'data:image/png;base64,'+sized.toPNG().toString('base64');
}

/**
 * A picture of a canvas as Obsidian draws it: cards with rendered Markdown,
 * embedded notes and images, groups, edges and labels. With `text`, the
 * staged (unsaved) version is drawn instead of the file.
 *
 * Obsidian draws only what is on screen, so the canvas is laid over the window
 * for well under a second, captured and put back, like Obsidian's own image
 * export. The caller reports this in the activity log.
 */
export async function captureCanvas(app:App,file:TFile,text?:string):Promise<{imageUrl:string;width:number;height:number}>{
 // Opening can wait on animation frames, which a covered window does not run; the view exists before that finishes.
 return withTemporaryView(app,leaf=>Promise.race([leaf.openFile(file,{active:false}),pause(3000)]),async view=>{
  if(view.getViewType?.()!=='canvas'||!view.canvas)throw Error('Obsidian could not open this canvas.');
  if(text!==undefined){view.setViewData(text,false);await pause(200);}
  const canvas=view.canvas,wrapper=canvas.wrapperEl;
  const parent=wrapper.parentElement,next=wrapper.nextSibling,style=wrapper.getAttribute('style');
  const width=Math.min(1600,window.innerWidth),height=Math.min(1200,window.innerHeight);
  const host=window as unknown as ElectronWindow;
  const contents=host.electron?.remote?.getCurrentWebContents?.()??host.require?.('electron')?.remote?.getCurrentWebContents?.();
  if(!contents)throw Error('Screen capture is unavailable in this Obsidian build.');
  const rect={x:0,y:0,width,height},tiny={x:0,y:0,width:8,height:8};
  try{
   canvas.deselectAll?.();
   wrapper.addClass('is-screenshotting');
   wrapper.setCssStyles({position:'fixed',left:'0',top:'0',width:width+'px',height:height+'px',zIndex:'var(--layer-modal)'});
   wrapper.doc.body.appendChild(wrapper);
   // A capture makes even a covered window paint; a tiny one first lets the canvas lay out at this size.
   await within(contents.capturePage(tiny),10000,'The canvas capture timed out.');
   canvas.zoomToFit?.();
   // Cards render their Markdown, embeds and images lazily, on frames a covered window only
   // runs during a capture: mount them, then keep the page painting until every card has content.
   const cards=[...(canvas.nodes?.values()??[])].filter(node=>node.getData?.().type!=='group');
   for(const node of cards)if(node.isContentMounted===false)node.mountContent?.();
   for(let waited=0;waited<3000;waited+=150){
    await within(contents.capturePage(tiny),10000,'The canvas capture timed out.');
    if(cards.every(node=>(node.contentEl?.childElementCount??1)>0))break;
    await pause(150);
   }
   await pause(250);
   await within(contents.capturePage(tiny),10000,'The canvas capture timed out.');
   const image=await within(contents.capturePage(rect),10000,'The canvas capture timed out.');
   if(image.isEmpty?.())throw Error('The canvas capture came back empty.');
   return {imageUrl:imageUrl(image),width,height};
  }finally{
   wrapper.removeClass('is-screenshotting');
   if(style===null)wrapper.removeAttribute('style');else wrapper.setAttribute('style',style);
   if(parent)parent.insertBefore(wrapper,next);
  }
 });
}

export type BaseInspection={errors:string[];views:string[];view:string;results:number|null;columns:string[];rows:string[][]};

/** Finds `{type:'invalid',parseError}` nodes, which is how the Bases engine marks a formula or filter it cannot parse. */
function invalidExpressions(value:unknown,at:string,found:string[],seen=new Set<unknown>()){
 if(!value||typeof value!=='object'||seen.has(value)||found.length>20)return;
 seen.add(value);
 const item=value as Record<string,unknown>;
 if(item.type==='invalid'&&typeof item.parseError==='string'){found.push(at+': '+item.parseError+(typeof item.value==='string'?' in '+JSON.stringify(item.value):''));return;}
 for(const [key,child] of Object.entries(item)){if(key==='app'||key==='ctx'||key==='plugin')continue;invalidExpressions(child,at?at+'.'+key:key,found,seen);}
}

/**
 * Runs base text through Obsidian's own Bases engine: parse errors, unknown
 * view types, invalid formulas and filters, and the first result rows of the
 * shown view with its columns. `file` is the base being edited, or null for a
 * new one.
 */
export async function inspectBase(app:App,file:TFile|null,text:string,rowLimit=20):Promise<BaseInspection>{
 const open=async(leaf:WorkspaceLeaf)=>{if(file)await leaf.openFile(file,{active:false});else await leaf.setViewState({type:'bases',active:false});};
 return withTemporaryView(app,open,async view=>{
  if(view.getViewType?.()!=='bases'||!view.controller)throw Error('Obsidian could not open this base.');
  view.setViewData(text,false);
  const controller=view.controller;
  for(let waited=0;waited<3000;waited+=150){await pause(150);if(controller.results||controller.errorEl?.textContent)break;}
  const errors:string[]=[];
  const shown=controller.errorEl?.textContent?.trim();
  if(shown)errors.push(shown);
  for(const error of controller.errors??[])errors.push(typeof error==='string'?error:String((error as {message?:string}|null)?.message??error));
  if(controller.error)errors.push(typeof controller.error==='string'?controller.error:String(controller.error.message??'Unknown Bases error'));
  invalidExpressions(controller.query?.formulas,'formulas',errors);
  invalidExpressions(controller.query?.filters,'filters',errors);
  for(const [index,config] of (controller.query?.views??[]).entries())invalidExpressions(config?.filters,'views['+index+'].filters',errors);
  const views:string[]=controller.getQueryViewNames?.()??[];
  const viewName:string=controller.viewName??views[0]??'';
  const config=controller.getViewConfig?.(viewName)??controller.query?.getViewConfig?.(viewName);
  const rawOrder=Array.isArray(config?.order)?config.order:config?.get?.('order');
  const order=Array.isArray(rawOrder)?rawOrder.filter((item):item is string=>typeof item==='string'):[];
  const columns=order.length?order:['file.name'];
  const entries:BaseEntry[]=controller.results?[...controller.results.values()]:[];
  const rows=entries.slice(0,rowLimit).map(entry=>columns.map(column=>{
   try{const value=entry.getValue?.(column);const text=value==null?'':typeof value.toString==='function'?value.toString():'';return text==='null'?'':text.slice(0,120);}catch{return '';}
  }));
  return {errors:[...new Set(errors)],views,view:viewName,results:controller.results?entries.length:null,columns,rows};
 });
}

/** The plugin's own LZ-string decoder for compressed drawings. */
export async function excalidrawDecompress(data:string):Promise<string>{
 return withAutomate(ea=>{
  if(typeof ea.decompressFromBase64==='function')return ea.decompressFromBase64(data);
  throw Error('This Excalidraw version cannot decode compressed drawings.');
 });
}
/** Synchronous decoder for display (diff views); null when the plugin is unavailable. */
export function excalidrawDecoder():((data:string)=>string)|undefined{
 const ea=excalidrawAutomate(),decode=ea?.decompressFromBase64;
 return ea&&typeof decode==='function'?(data:string)=>decode.call(ea,data):undefined;
}

const dataUrl=(value:unknown)=>typeof value==='string'?(value.startsWith('data:')?value:'data:image/png;base64,'+value):'';

/** A PNG of a drawing file exported by the Excalidraw plugin itself. */
export async function excalidrawImage(file:TFile):Promise<string>{
 return withAutomate(async ea=>{
  const url=dataUrl(await ea.createPNGBase64(file.path,1));
  if(!url)throw Error('Excalidraw did not return an image.');
  return url;
 });
}
/** A PNG of a staged (unsaved) scene, rendered by the plugin from its elements. */
export async function excalidrawSceneImage(elements:ExcalidrawElement[]):Promise<string>{
 return withAutomate(async ea=>{
  for(const element of elements)if(!element.isDeleted)ea.elementsDict[element.id]=structuredClone(element);
  const url=dataUrl(await ea.createPNGBase64(undefined,1));
  if(!url)throw Error('Excalidraw did not return an image.');
  return url;
 });
}

/**
 * Builds elements with the plugin's ExcalidrawAutomate, so every new shape,
 * text, arrow and frame has the fields and defaults Excalidraw itself writes.
 * The work runs inside one private EA instance that is released afterwards.
 */
export async function withExcalidrawFactory<T>(work:(factory:ElementFactory)=>T):Promise<T>{
 return withAutomate(ea=>{
  const defaults:ExcalidrawStyle={...ea.style};
  const styled=(style:Record<string,unknown>)=>{ea.style={...defaults,...style};};
  const bindText=(containerId:string,text:string,style:Record<string,unknown>)=>{
   styled({...style,textAlign:'center',verticalAlign:'middle'});
   const container=ea.getElement(containerId);
   const id=ea.addText(container.x,container.y,text,{width:container.width,textAlign:'center',textVerticalAlign:'middle'});
   const element=ea.getElement(id);
   element.containerId=containerId;
   element.textAlign='center';element.verticalAlign='middle';
   // Excalidraw centres bound text when it opens a drawing, but its export draws the stored
   // position; centre it now so pictures of a staged drawing look like the result.
   if(container.type!=='arrow'){element.x=container.x+(container.width-element.width)/2;element.y=container.y+(container.height-element.height)/2;}
   container.boundElements=[...(container.boundElements??[]),{type:'text',id}];
   return id;
  };
  const factory:ElementFactory={
   load:elements=>{for(const element of elements)ea.elementsDict[element.id]=element;},
   shape:(kind,x,y,width,height,style,text)=>{
    styled(style);
    const id=kind==='ellipse'?ea.addEllipse(x,y,width,height):kind==='diamond'?ea.addDiamond(x,y,width,height):ea.addRect(x,y,width,height);
    if(text)bindText(id,text,style);
    return id;
   },
   text:(x,y,text,style)=>{styled(style);return ea.addText(x,y,text);},
   connect:(from,to,style,label)=>{
    styled(style);
    const id=ea.connectObjects(from,null,to,null,{endArrowHead:style.endArrowHead??'arrow',startArrowHead:style.startArrowHead??null,numberOfPoints:0});
    if(label)bindText(id,label,style);
    return id;
   },
   frame:(x,y,width,height,name,contains)=>{
    const id=ea.addFrame(x,y,width,height,name);
    if(contains.length)ea.addElementsToFrame(id,contains);
    return id;
   },
   measure:(text,style)=>{styled(style);const size=ea.measureText(text);return {width:size.width,height:size.height};},
   elements:()=>ea.getElements(),
  };
  return work(factory);
 });
}
