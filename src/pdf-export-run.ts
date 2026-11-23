// Runs Obsidian's own PDF exporter for export_pdf (handoff 3.8.0 #5, route B with fallback A).
//
// Route B ("internal"): MarkdownView.printToPdf() only does `new PrintModal(app,file).open()`.
// For that one synchronous call Modal.prototype.open is swapped for a capture, so the modal is
// built but never shown, and its own printToPdf(options) renders and saves the note through
// Obsidian's pipeline (hidden popup + Electron printToPDF) to the path OWLA chose.
// These are undocumented internals (verified in Obsidian 1.14 and 1.15.1 desktop): every step is
// duck-typed, and anything unexpected falls back to route A.
// Route A ("dialog"): the public command workspace:export-pdf opens Obsidian's dialog; the user
// picks the settings and the path. OWLA cannot enforce the output path on this route.
//
// No Obsidian imports: main.ts passes the host pieces in, so this file is testable in Node.
import type {ObsidianPrintOptions} from './pdf-export';

export const EXPORT_PDF_COMMAND='workspace:export-pdf';
/** Obsidian renders, waits ~400 ms and prints; a long note with many embeds can take a while. */
export const PDF_EXPORT_TIMEOUT_MS=120_000;

export type PrintModalLike={file?:unknown;printToPdf:(options:ObsidianPrintOptions)=>Promise<unknown>};
export type PrintableView={file?:unknown;printToPdf?:()=>unknown};
type OpenHolder={open?:(...args:unknown[])=>unknown};

/** Build Obsidian's print modal for view.file without opening it. Returns null when the internals do not look as expected. */
export function captureObsidianPrintModal(view:PrintableView|null|undefined,modalPrototype:OpenHolder,file:unknown):PrintModalLike|null{
 if(!view||typeof view.printToPdf!=='function'||view.file!==file||typeof modalPrototype.open!=='function')return null;
 const own=Object.prototype.hasOwnProperty.call(modalPrototype,'open'),original=modalPrototype.open;
 let captured:unknown=null,calls=0;
 modalPrototype.open=function(this:unknown){calls++;captured=this;};
 try{view.printToPdf();}
 catch{return null;}
 finally{if(own)modalPrototype.open=original;else delete modalPrototype.open;}
 if(calls!==1||!captured||typeof captured!=='object')return null;
 const modal=captured as Partial<PrintModalLike>;
 if(typeof modal.printToPdf!=='function'||modal.file!==file)return null;
 return modal as PrintModalLike;
}

export type PdfExportHost={
 isDesktop:boolean;
 /** A MarkdownView showing the file (an existing one, or a temporary one main.ts opened). */
 view:PrintableView|null;
 file:unknown;
 /** Modal.prototype from 'obsidian'. */
 modalPrototype:OpenHolder;
 /** Does app.commands know workspace:export-pdf? */
 hasDialogCommand:()=>boolean;
 /** Make the note's view active and run workspace:export-pdf. */
 openDialog:()=>Promise<boolean>|boolean;
 /** Whether the output now exists (vault adapter, vault-relative). */
 outputExists:()=>Promise<boolean>;
 timeoutMs?:number;
 /** Defaults to window (popout-safe); tests pass Node timers. */
 timers?:Timers;
};

export type PdfExportResult=
 {route:'internal';ok:true}
 |{route:'dialog';ok:boolean;reason:string}
 |{route:'none';ok:false;reason:string};

type Timers={setTimeout:(fn:()=>void,ms:number)=>number;clearTimeout:(id:number|undefined)=>void};
function within<T>(promise:Promise<T>,ms:number,timers:Timers):Promise<T>{
 let timer:number|undefined;
 return Promise.race([promise,new Promise<T>((_,reject)=>{timer=timers.setTimeout(()=>reject(Error('Obsidian did not finish the PDF export in time.')),ms);})]).finally(()=>timers.clearTimeout(timer));
}

/** Export with route B; fall back to Obsidian's dialog when the internals are missing or produced no file.
 *  Call only after the user confirmed the export in OWLA's own review UI. */
export async function runPdfExport(host:PdfExportHost,options:ObsidianPrintOptions):Promise<PdfExportResult>{
 if(!host.isDesktop)return {route:'none',ok:false,reason:'PDF export is available only in Obsidian for desktop.'};
 let reason='';
 const modal=captureObsidianPrintModal(host.view,host.modalPrototype,host.file);
 if(modal){
  try{
   // Obsidian catches its own failures and only shows a notice, so success is judged by the file.
   await within(Promise.resolve(modal.printToPdf(options)),host.timeoutMs??PDF_EXPORT_TIMEOUT_MS,host.timers??window);
   if(await host.outputExists())return {route:'internal',ok:true};
   reason='Obsidian’s exporter ran but saved no file';
  }catch(error){reason=error instanceof Error?error.message:String(error);}
 }else reason='this Obsidian version does not expose its exporter';
 if(!host.hasDialogCommand())return {route:'none',ok:false,reason:'Obsidian’s Export to PDF command is unavailable ('+reason+').'};
 const opened=await host.openDialog();
 return {route:'dialog',ok:opened,reason:opened
  ?'Opened Obsidian’s Export to PDF dialog because '+reason+'. The user chooses the settings and where to save; OWLA can check the PDF only if it is saved in the vault.'
  :'Could not open Obsidian’s Export to PDF dialog ('+reason+').'};
}

/** Route A: is a newly created vault file the export of this note? Obsidian proposes "<basename>.pdf". */
export function isDialogExport(createdPath:string,noteBasename:string):boolean{
 const name=(createdPath.replace(/\\/g,'/').split('/').pop()??'');
 if(!/\.pdf$/i.test(name))return false;
 const stem=name.slice(0,-4);
 return stem===noteBasename||stem.startsWith(noteBasename+' ');
}
