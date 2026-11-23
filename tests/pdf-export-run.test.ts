import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureObsidianPrintModal,runPdfExport,isDialogExport,EXPORT_PDF_COMMAND,type PdfExportHost} from '../src/pdf-export-run';
import {obsidianPrintOptions,type ObsidianPrintOptions} from '../src/pdf-export';

// Shape of Obsidian's internals: Modal.prototype.open, a print modal subclass, MarkdownView.printToPdf.
class Modal{opened=0;open(){this.opened++;}}
const file={path:'Docs/Plan.md'};
const options=obsidianPrintOptions({pageSize:'A4',landscape:false,margin:'default',downscalePercent:100,includeName:false,open:false},'/vault/Docs/Plan.pdf');

function setup(printImpl?:(o:ObsidianPrintOptions)=>Promise<void>){
 const calls:ObsidianPrintOptions[]=[];
 class PrintModal extends Modal{constructor(public file:unknown){super();}
  async printToPdf(o:ObsidianPrintOptions){calls.push(o);await printImpl?.(o);}}
 const built:PrintModal[]=[];
 const view={file,printToPdf(){const m=new PrintModal(this.file);built.push(m);m.open();}};
 return {view,calls,built};
}
const host=(over:Partial<PdfExportHost>):PdfExportHost=>({isDesktop:true,view:null,file,modalPrototype:Modal.prototype,hasDialogCommand:()=>true,openDialog:()=>true,outputExists:async()=>true,
 timers:{setTimeout:(fn,ms)=>setTimeout(fn,ms) as unknown as number,clearTimeout:id=>clearTimeout(id)},...over});

test('capture builds the modal without opening it and restores Modal.prototype.open',()=>{
 const original=Modal.prototype.open,{view,built}=setup();
 const modal=captureObsidianPrintModal(view,Modal.prototype,file);
 assert.ok(modal);assert.equal(built[0].opened,0);
 assert.equal(Modal.prototype.open,original);
 assert.ok(Object.prototype.hasOwnProperty.call(Modal.prototype,'open'));
});

test('capture restores an inherited open by deleting the shadow',()=>{
 class Sub extends Modal{}
 const proto=Sub.prototype as unknown as {open:()=>void};
 const view={file,printToPdf(){new Sub().open();}};
 // Sub.prototype has no own open; the modal built is a Sub without printToPdf, so capture rejects it.
 assert.equal(captureObsidianPrintModal(view,proto,file),null);
 assert.ok(!Object.prototype.hasOwnProperty.call(proto,'open'));
});

test('capture rejects unexpected internals',()=>{
 const {view}=setup();
 assert.equal(captureObsidianPrintModal(null,Modal.prototype,file),null);
 assert.equal(captureObsidianPrintModal({file},Modal.prototype,file),null,'no printToPdf');
 assert.equal(captureObsidianPrintModal(view,Modal.prototype,{path:'other.md'}),null,'other file');
 assert.equal(captureObsidianPrintModal({file,printToPdf(){throw Error('x');}},Modal.prototype,file),null);
 assert.equal(captureObsidianPrintModal({file,printToPdf(){}},Modal.prototype,file),null,'nothing opened');
 const original=Modal.prototype.open;
 captureObsidianPrintModal({file,printToPdf(){throw Error('x');}},Modal.prototype,file);
 assert.equal(Modal.prototype.open,original,'restored after a throw');
});

test('internal route passes Obsidian\'s options and checks the file',async()=>{
 const {view,calls}=setup();
 assert.deepEqual(await runPdfExport(host({view}),options),{route:'internal',ok:true});
 assert.deepEqual(calls,[options]);
});

test('falls back to the dialog when internals are missing, fail, time out or save nothing',async()=>{
 let dialogs=0;const openDialog=()=>{dialogs++;return true;};
 const missing=await runPdfExport(host({view:{file},openDialog}),options);
 assert.equal(missing.route,'dialog');assert.match((missing as {reason:string}).reason,/does not expose/);
 const nothing=await runPdfExport(host({view:setup().view,openDialog,outputExists:async()=>false}),options);
 assert.match((nothing as {reason:string}).reason,/saved no file/);
 const failing=await runPdfExport(host({view:setup(async()=>{throw Error('boom');}).view,openDialog}),options);
 assert.match((failing as {reason:string}).reason,/boom/);
 const slow=await runPdfExport(host({view:setup(()=>new Promise(()=>{})).view,openDialog,timeoutMs:20}),options);
 assert.match((slow as {reason:string}).reason,/in time/);
 assert.equal(dialogs,4);
});

test('no route on mobile or without the command',async()=>{
 assert.deepEqual((await runPdfExport(host({isDesktop:false,view:setup().view}),options)).route,'none');
 const gone=await runPdfExport(host({view:{file},hasDialogCommand:()=>false}),options);
 assert.equal(gone.route,'none');assert.equal(gone.ok,false);
 const closed=await runPdfExport(host({view:{file},openDialog:async()=>false}),options);
 assert.equal(closed.route,'dialog');assert.equal(closed.ok,false);
 assert.equal(EXPORT_PDF_COMMAND,'workspace:export-pdf');
});

test('dialog export detection by Obsidian\'s default name',()=>{
 assert.ok(isDialogExport('Docs/Plan.pdf','Plan'));
 assert.ok(isDialogExport('Exports\\Plan 1.pdf','Plan'));
 assert.ok(!isDialogExport('Docs/Plan.md','Plan'));
 assert.ok(!isDialogExport('Docs/Planning.pdf','Plan'));
});
