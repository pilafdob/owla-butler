import {App,Plugin,ItemView,WorkspaceLeaf,MarkdownView,TFile,PluginSettingTab,Setting,Notice,Modal,FuzzySuggestModal,MarkdownRenderer,Editor,EditorPosition,setIcon,addIcon} from 'obsidian';
import {diffLines} from 'diff';
import {ButlerSettings,DEFAULTS,endpoint,allowedPath,clip,proposal,Proposal,assertFresh,insertion,stripFence,canStartModel,mustStopModel} from './core';
import {localRequest} from './transport';
import {LocalRuntime,memoryStatus} from './runtime';
import {Message,conversation,SYSTEM} from './client';
import {BIRD_ICON} from './icon';
const VIEW='owla-butler-chat';
type Captured={path:string;text:string;start:number;end:number};
type Attachment={name:string;base64:string;url:string};
export default class Butler extends Plugin {
 prefs:ButlerSettings={...DEFAULTS};runtime=new LocalRuntime();view:ButlerView|null=null;last:MarkdownView|null=null;
 async onload(){
  addIcon('owla-bird',BIRD_ICON);
  this.prefs={...DEFAULTS,...await this.loadData()};
  this.registerView(VIEW,leaf=>new ButlerView(leaf,this));
  this.addRibbonIcon('owla-bird','Open OWLA Butler',()=>void this.open());
  this.addCommand({id:'open-chat',name:'Open chat',callback:()=>void this.open()});
  this.addCommand({id:'add-selection',name:'Add selection to chat',editorCallback:(editor,view)=>void this.selection(editor,view.file)});
  this.addCommand({id:'image-to-note',name:'Turn an image into note content',callback:async()=>{const v=await this.open();v.composer.value='Transcribe the attached image into Obsidian Markdown with LaTeX math. Match the language of my note and propose where it belongs. Mark unclear symbols.';v.pickImage();}});
  this.addSettingTab(new ButlerSettingsTab(this.app,this));
  this.registerEvent(this.app.workspace.on('active-leaf-change',leaf=>{if(leaf?.view instanceof MarkdownView)this.last=leaf.view;this.view?.renderContext();}));
  this.registerEvent(this.app.workspace.on('file-open',()=>{const v=this.app.workspace.getActiveViewOfType(MarkdownView);if(v)this.last=v;this.view?.renderContext();}));
  this.registerEvent(this.app.workspace.on('editor-menu',(menu,editor,view)=>{if(editor.getSelection())menu.addItem(item=>item.setTitle('Add selection to OWLA Butler').setIcon('message-square-plus').onClick(()=>void this.selection(editor,view.file)));}));
  this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{if(file instanceof TFile&&allowedPath(file.path,this.prefs.excludedFolders))menu.addItem(item=>item.setTitle('Add note to OWLA Butler').setIcon('message-square-plus').onClick(async()=>{const v=await this.open();await v.attachNote(file);}));}));
  this.app.workspace.onLayoutReady(()=>{this.last=this.app.workspace.getActiveViewOfType(MarkdownView);this.view?.renderContext();});
 }
 async selection(editor:Editor,file:TFile|null){if(!file||!editor.getSelection())return;const v=await this.open();v.selections.push({path:file.path,text:clip(editor.getSelection(),3000)});v.renderAttachments();v.composer.focus();}
 capture():Captured|null {
  const current=this.app.workspace.getActiveViewOfType(MarkdownView);if(current)this.last=current;
  if(this.last&&!this.app.workspace.getLeavesOfType('markdown').some(l=>l.view===this.last))this.last=null;
  if(!this.last){const active=this.app.workspace.getActiveFile();this.last=(this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v instanceof MarkdownView&&v.file?.path===active?.path) as MarkdownView|undefined)??null;}
  const v=this.last;if(!v?.file||!allowedPath(v.file.path,this.prefs.excludedFolders))return null;
  return {path:v.file.path,text:v.editor.getValue(),start:v.editor.posToOffset(v.editor.getCursor('from')),end:v.editor.posToOffset(v.editor.getCursor('to'))};
 }
 async open(){let leaf=this.app.workspace.getLeavesOfType(VIEW)[0];if(!leaf){leaf=this.app.workspace.getRightLeaf(false)!;if(!leaf)throw Error('Could not open the sidebar.');await leaf.setViewState({type:VIEW,active:true});}await this.app.workspace.revealLeaf(leaf);return leaf.view as ButlerView;}
 async save(){await this.saveData(this.prefs);}
 onunload(){this.view?.stop();this.runtime.stop();}
 async currentText(path:string){const view=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v instanceof MarkdownView&&v.file?.path===path) as MarkdownView|undefined;if(view)return view.editor.getValue();const f=this.app.vault.getAbstractFileByPath(path);if(!(f instanceof TFile)||!allowedPath(path,this.prefs.excludedFolders))throw Error('This Markdown note is not available.');return this.app.vault.read(f);}
 async apply(p:Proposal){
  if(!allowedPath(p.path,this.prefs.excludedFolders))throw Error('This note is excluded from OWLA Butler.');
  const file=this.app.vault.getAbstractFileByPath(p.path);if(!(file instanceof TFile))throw Error('The target note no longer exists.');
  const view=this.app.workspace.getLeavesOfType('markdown').map(l=>l.view).find(v=>v instanceof MarkdownView&&v.file?.path===p.path) as MarkdownView|undefined;
  // An in-memory copy supports safe Undo; preserve recovery in Obsidian's file-recovery/history too.
  if(view){assertFresh(view.editor.getValue(),p.before);const a=commonChange(p.before,p.after);view.editor.replaceRange(a.text,view.editor.offsetToPos(a.start),view.editor.offsetToPos(a.end));}
  else await this.app.vault.process(file,current=>{assertFresh(current,p.before);return p.after;});
 }
}
function commonChange(before:string,after:string){let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;let end=before.length,newEnd=after.length;while(end>start&&newEnd>start&&before[end-1]===after[newEnd-1]){end--;newEnd--;}return {start,end,text:after.slice(start,newEnd)};}
class NotePicker extends FuzzySuggestModal<TFile>{constructor(app:App,private butler:Butler,private accept:(f:TFile)=>void){super(app);this.setPlaceholder('Add a note as context…');}getItems(){return this.app.vault.getMarkdownFiles().filter(f=>allowedPath(f.path,this.butler.prefs.excludedFolders));}getItemText(f:TFile){return f.path;}onChooseItem(f:TFile){this.accept(f);}}
class EditReview extends Modal {
 constructor(app:App,private butler:Butler,private edit:Proposal,private onApplied:()=>void){super(app);}
 onOpen(){this.modalEl.addClass('owla-review');this.setTitle('Review note edit');this.contentEl.createEl('p',{text:this.edit.path,cls:'owla-review-path'});this.contentEl.createEl('p',{text:this.edit.reason});const diff=this.contentEl.createDiv('owla-diff');for(const part of diffLines(this.edit.before,this.edit.after)){diff.createEl('pre',{text:part.value,cls:part.added?'owla-added':part.removed?'owla-removed':'owla-unchanged'});}const row=this.contentEl.createDiv('owla-review-actions');row.createEl('button',{text:'Cancel'}).onclick=()=>this.close();const apply=row.createEl('button',{text:'Apply edit',cls:'mod-cta'});apply.onclick=async()=>{apply.disabled=true;try{await this.butler.apply(this.edit);this.onApplied();new Notice('Edit applied. You can undo it from the chat.');this.close();}catch(e){new Notice((e as Error).message);apply.disabled=false;}};}
 onClose(){this.contentEl.empty();}
}
export class ButlerView extends ItemView {
 composer!:HTMLTextAreaElement;private feed!:HTMLElement;private contextEl!:HTMLElement;private chips!:HTMLElement;private status!:HTMLElement;private sendBtn!:HTMLButtonElement;private modelLabel!:HTMLElement;
 selections:{path:string;text:string}[]=[];private notes=new Map<string,string>();private images:Attachment[]=[];private history:Message[]=[];private controller:AbortController|null=null;private closing=false;private imageInput!:HTMLInputElement;private snapshots=new Map<string,string>();private undo:Proposal|null=null;
 constructor(leaf:WorkspaceLeaf,public butler:Butler){super(leaf);}
 getViewType(){return VIEW;}getDisplayText(){return 'OWLA Butler';}getIcon(){return 'owla-bird';}
 async onOpen(){
  this.butler.view=this;this.contentEl.empty();this.contentEl.addClass('owla-root');
  const header=this.contentEl.createDiv('owla-header');const logo=header.createSpan('owla-logo');setIcon(logo,'owla-bird');const title=header.createDiv();title.createDiv({text:'OWLA Butler',cls:'owla-title'});const reset=header.createEl('button',{cls:'owla-icon-button',attr:{'aria-label':'New chat',title:'New chat'}});setIcon(reset,'square-pen');reset.onclick=()=>{this.stop();this.history=[];this.feed.empty();this.welcome();};
  this.contextEl=this.contentEl.createDiv('owla-current');this.renderContext();
  this.feed=this.contentEl.createDiv({cls:'owla-feed',attr:{role:'log','aria-live':'polite','aria-label':'Chat messages'}});this.welcome();
  const composerWrap=this.contentEl.createDiv('owla-composer-wrap');this.chips=composerWrap.createDiv('owla-chips');this.composer=composerWrap.createEl('textarea',{cls:'owla-composer',attr:{placeholder:'Ask about your note, or paste a screenshot…','aria-label':'Message OWLA Butler',rows:'4'}});
  this.composer.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();void this.send();}});
  this.composer.addEventListener('paste',e=>{const files=Array.from(e.clipboardData?.files??[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();void this.addImages(files);}});
  this.contentEl.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});this.contentEl.addEventListener('drop',e=>{const files=Array.from(e.dataTransfer?.files??[]).filter(f=>f.type.startsWith('image/'));if(files.length){e.preventDefault();void this.addImages(files);}});
  this.imageInput=composerWrap.createEl('input',{attr:{type:'file',accept:'image/png,image/jpeg,image/webp',multiple:''},cls:'owla-hidden'});this.imageInput.onchange=()=>{void this.addImages(Array.from(this.imageInput.files??[]));this.imageInput.value='';};
  const toolbar=composerWrap.createDiv('owla-toolbar');const attach=toolbar.createEl('button',{text:'Image',cls:'owla-small-button',attr:{title:'Attach an image or paste a screenshot'}});attach.onclick=()=>this.pickImage();const note=toolbar.createEl('button',{text:'Add note',cls:'owla-small-button'});note.onclick=()=>new NotePicker(this.app,this.butler,f=>void this.attachNote(f)).open();this.modelLabel=toolbar.createSpan({text:'Local · '+this.butler.prefs.model,cls:'owla-model'});this.sendBtn=toolbar.createEl('button',{text:'Send',cls:'mod-cta owla-send'});this.sendBtn.onclick=()=>this.controller?this.stop():void this.send();
  this.status=this.contentEl.createDiv({text:'Local only · edits need your approval',cls:'owla-status'});
 }
 private welcome(){const w=this.feed.createDiv('owla-welcome');w.createEl('h3',{text:'What are we working on?'});w.createEl('p',{text:'Your open note comes along. Add a selection, another note, or a screenshot.'});for(const [label,prompt] of [['Explain this note','Explain the main ideas in my open note.'],['Improve a passage','Suggest a focused improvement to my note. Propose an edit without changing it.'],['Screenshot → note','Transcribe the attached image into Obsidian Markdown and LaTeX. Propose a small insertion into my note.']]){w.createEl('button',{text:label,cls:'owla-suggestion'}).onclick=()=>{this.composer.value=prompt;this.composer.focus();if(label.startsWith('Screenshot'))this.pickImage();};}}
 renderContext(){if(!this.contextEl)return;this.contextEl.empty();const c=this.butler.capture();const icon=this.contextEl.createSpan();setIcon(icon,'file-text');this.contextEl.createSpan({text:c?c.path:'Open a Markdown note to give it context',cls:'owla-current-path'});this.contextEl.setAttribute('title',c?.path??'No note selected');}
 pickImage(){this.imageInput.click();}
 async attachNote(file:TFile){if(!allowedPath(file.path,this.butler.prefs.excludedFolders)){new Notice('This note is excluded.');return;}if(this.notes.size>=3){new Notice('Attach up to three notes to keep memory use low.');return;}this.notes.set(file.path,clip(await this.butler.currentText(file.path),4000));this.renderAttachments();}
 async addImages(files:File[]){for(const file of files){if(this.images.length>=2){new Notice('Use at most two images per message.');break;}if(file.size>10*1024*1024){new Notice('Choose an image smaller than 10 MB.');continue;}try{const url=await resizedImage(file);this.images.push({name:file.name||'Screenshot',url,base64:url.split(',')[1]});}catch(e){new Notice((e as Error).message);}}this.renderAttachments();}
 renderAttachments(){if(!this.chips)return;this.chips.empty();const chip=(label:string,remove:()=>void,image?:string)=>{const e=this.chips.createDiv('owla-chip');if(image)e.createEl('img',{attr:{src:image,alt:label}});e.createSpan({text:label});const b=e.createEl('button',{text:'×',attr:{'aria-label':'Remove '+label}});b.onclick=()=>{remove();this.renderAttachments();};};this.selections.forEach((s,i)=>chip('Selection · '+s.path,()=>this.selections.splice(i,1)));for(const [path]of this.notes)chip(path,()=>this.notes.delete(path));this.images.forEach((im,i)=>chip(im.name,()=>this.images.splice(i,1),im.url));}
 stop(){this.controller?.abort();void this.butler.runtime.unload(this.butler.prefs);this.butler.runtime.stop();}
 private async tool(name:string,args:any,log:HTMLElement):Promise<string>{
  const p=this.butler.prefs;
  if(name==='search_vault'){
   if(typeof args.query!=='string'||!args.query.trim())throw Error('Provide a search query.');const words:string[]=args.query.toLocaleLowerCase().split(/\s+/).filter(Boolean).slice(0,8);log.createDiv({text:'Searching your vault…',cls:'owla-activity'});
   const found:{path:string;excerpt:string}[]=[];const files=this.app.vault.getMarkdownFiles().filter(f=>allowedPath(f.path,p.excludedFolders));files.sort((a,b)=>Number(words.some(w=>b.path.toLowerCase().includes(w)))-Number(words.some(w=>a.path.toLowerCase().includes(w))));
   for(let i=0;i<files.length&&found.length<5;i++){if(this.controller?.signal.aborted)throw Error('Stopped.');const f=files[i];if(f.stat.size>250_000)continue;const text=await this.butler.currentText(f.path);const lower=(f.path+'\n'+text).toLocaleLowerCase();if(words.some(w=>lower.includes(w))){const at=Math.max(0,text.toLocaleLowerCase().indexOf(words[0]));found.push({path:f.path,excerpt:text.slice(Math.max(0,at-100),at+500)});}if(i%25===0)await new Promise(r=>setTimeout(r,0));}
   return JSON.stringify(found);
  }
  if(name==='read_note'){
   if(typeof args.path!=='string'||!allowedPath(args.path,p.excludedFolders))throw Error('Provide an allowed vault-relative Markdown path.');const text=await this.butler.currentText(args.path);this.snapshots.set(args.path,text);log.createDiv({text:'Read '+args.path,cls:'owla-activity'});return clip(text,4000);
  }
  if(name==='propose_edit'){
   if(!['path','oldText','newText','reason'].every(k=>typeof args[k]==='string'))throw Error('Provide path, oldText, newText and reason as strings.');const before=this.snapshots.get(args.path);if(before===undefined)throw Error('Read this note before proposing an edit.');const edit=proposal(args.path,before,args.oldText,args.newText,args.reason,p.excludedFolders);this.proposalCard(log,edit);return 'Edit proposed for user review. No file was changed.';
  }
  throw Error('Unknown tool. Use search_vault, read_note or propose_edit.');
 }
 private proposalCard(parent:HTMLElement,edit:Proposal){const card=parent.createDiv('owla-edit-card');card.createDiv({text:'Suggested edit',cls:'owla-edit-title'});card.createDiv({text:edit.path,cls:'owla-edit-path'});card.createEl('p',{text:edit.reason});const b=card.createEl('button',{text:'Review edit',cls:'mod-cta'});b.onclick=()=>new EditReview(this.app,this.butler,edit,()=>{this.undo=edit;b.disabled=true;b.setText('Applied');const undo=card.createEl('button',{text:'Undo edit'});undo.onclick=async()=>{try{await this.butler.apply({...edit,before:edit.after,after:edit.before,reason:'Undo OWLA Butler edit'});undo.disabled=true;b.setText('Undone');new Notice('Edit undone.');}catch(e){new Notice((e as Error).message);}};}).open();}
 async send(request?:string){
  if(this.controller)return;const prompt=(request??this.composer.value).trim();if(!prompt&&!this.images.length)return;
  const prefs={...this.butler.prefs};try{endpoint(prefs.endpoint);}catch(e){new Notice((e as Error).message);return;}
  const captured=this.butler.capture();const submittedImages=[...this.images];const selected=[...this.selections];const notes=[...this.notes.entries()];
  while(this.feed.children.length>30)this.feed.firstElementChild?.remove();
  const user=this.feed.createDiv('owla-user');user.createDiv({text:prompt||'Transcribe this image into Markdown.'});for(const im of submittedImages)user.createEl('img',{cls:'owla-message-image',attr:{src:im.url,alt:im.name}});
  const answer=this.feed.createDiv('owla-assistant');answer.createDiv({text:'OWLA',cls:'owla-speaker'});const activity=answer.createDiv('owla-activities');const content=answer.createDiv('owla-message-content');const actions=answer.createDiv('owla-message-actions');
  this.composer.value='';this.images=[];this.selections=[];this.notes.clear();this.renderAttachments();this.controller=new AbortController();const signal=this.controller.signal;this.sendBtn.setText('Stop');this.status.setText('Preparing your note…');let streamTimer:ReturnType<typeof setTimeout>|undefined;let text='',memoryTimer:ReturnType<typeof setInterval>|undefined,guardBusy=false,warnings=0,memoryStop=false;
  this.snapshots.clear();if(captured)this.snapshots.set(captured.path,captured.text);
  try{
   if(prefs.memoryGuard&&!canStartModel(await memoryStatus()))throw Error('Your Mac is already under memory pressure. OWLA did not load a model. Try again when memory pressure has settled.');
   await this.butler.runtime.ensure(prefs);if(signal.aborted)throw Error('Stopped.');
   if(prefs.memoryGuard)memoryTimer=setInterval(()=>{if(guardBusy)return;guardBusy=true;void memoryStatus().then(status=>{warnings=status.freePercent<25?warnings+1:0;if(mustStopModel(status)||warnings>=2){memoryStop=true;this.stop();}}).finally(()=>guardBusy=false);},1500);
   this.status.setText('Thinking locally…');let context=captured?`\nACTIVE NOTE: ${captured.path}\n${clip(captured.text,5500)}\nCaptured cursor offset: ${captured.start}; selected end: ${captured.end}.`:'\nNo Markdown note is open. Do not assume an edit target.';
   context+=selected.slice(0,3).map(s=>`\nSELECTED TEXT from ${s.path}:\n${s.text}`).join('');
   for(const [path,body]of notes){context+=`\nATTACHED NOTE ${path}:\n${clip(body,2000)}`;this.snapshots.set(path,await this.butler.currentText(path));}
   const recent=this.history.slice(-4).map(m=>({...m,content:clip(m.content,600),images:undefined}));
   const requestText=clip(prompt||'Transcribe this image into Markdown.',1800);const charBudget=Math.max(1800,(prefs.context-prefs.maxTokens-1000)*3);const contextBudget=Math.max(600,charBudget-requestText.length-recent.reduce((n,m)=>n+m.content.length,0));
   const messages:Message[]=[{role:'system',content:SYSTEM},...recent,{role:'user',content:clip(context,contextBudget)+'\n\nREQUEST: '+requestText,images:submittedImages.map(im=>im.base64)}];
   let renderQueued=false;const renderStream=()=>{renderQueued=false;if(!this.closing){content.setText(text);this.feed.scrollTop=this.feed.scrollHeight;}};
   await conversation(prefs,messages,signal,delta=>{text+=delta;if(!renderQueued){renderQueued=true;streamTimer=setTimeout(renderStream,70);}},(name,args)=>this.tool(name,args,activity));
   if(streamTimer)clearTimeout(streamTimer);content.empty();if(text)await MarkdownRenderer.render(this.app,text,content,captured?.path??'',this);else content.createEl('p',{text:activity.childElementCount?'Review the suggested edit above.':'The model returned no text. Try a smaller request.'});
   this.history.push({role:'user',content:prompt},{role:'assistant',content:text});this.history=this.history.slice(-6);
   if(text){const copy=actions.createEl('button',{text:'Copy Markdown'});copy.onclick=()=>void navigator.clipboard.writeText(stripFence(text));if(captured){const insert=actions.createEl('button',{text:captured.start!==captured.end?'Replace selection…':'Insert at cursor…'});insert.onclick=()=>this.proposalCard(answer,insertion(captured.path,captured.text,text,captured.start,captured.end));const append=actions.createEl('button',{text:'Append to note…'});append.onclick=()=>this.proposalCard(answer,proposal(captured.path,captured.text,'',stripFence(text),'Append this response to the captured note',prefs.excludedFolders));}}
   this.feed.scrollTop=this.feed.scrollHeight;this.status.setText('Done · model unloaded after this turn');
  }catch(e){const message=memoryStop?'Stopped to protect your Mac: memory pressure increased.':signal.aborted?'Stopped.':(e as Error).message;content.createDiv({text:message,cls:'owla-error'});this.status.setText(message);}
  finally{if(streamTimer)clearTimeout(streamTimer);if(memoryTimer)clearInterval(memoryTimer);await this.butler.runtime.unload(prefs);this.butler.runtime.stop();this.controller=null;if(!this.closing)this.sendBtn.setText('Send');}
 }
 async onClose(){this.closing=true;this.stop();this.butler.view=null;this.contentEl.empty();}
}
async function resizedImage(file:File):Promise<string>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Use a PNG, JPEG or WebP screenshot.');
 const url=URL.createObjectURL(file);try{const im=new Image();im.src=url;await im.decode();if(im.width*im.height>40_000_000)throw Error('This image is too large. Crop it first.');const scale=Math.min(1,1024/Math.max(im.width,im.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(im.width*scale));canvas.height=Math.max(1,Math.round(im.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not read this image.');ctx.drawImage(im,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');}finally{URL.revokeObjectURL(url);}}
class ButlerSettingsTab extends PluginSettingTab {
 constructor(app:App,private butler:Butler){super(app,butler);}
 display(){const {containerEl:el}=this;el.empty();el.createEl('h2',{text:'OWLA Butler'});el.createEl('p',{text:'Your notes and images stay on this computer. The model loads only when you send a message. Edits always need review.'});
  new Setting(el).setName('Local provider').addDropdown(d=>d.addOptions({ollama:'Ollama',openai:'OpenAI-compatible local server'}).setValue(this.butler.prefs.provider).onChange(async v=>{this.butler.prefs.provider=v as 'ollama'|'openai';await this.butler.save();}));
  new Setting(el).setName('Local server address').setDesc('Only localhost addresses are accepted.').addText(t=>t.setValue(this.butler.prefs.endpoint).onChange(async v=>{try{endpoint(v);this.butler.prefs.endpoint=v;await this.butler.save();}catch{}}));
  new Setting(el).setName('Model').setDesc('Use the exact installed model name.').addText(t=>t.setValue(this.butler.prefs.model).onChange(async v=>{this.butler.prefs.model=v.trim();await this.butler.save();}));
  new Setting(el).setName('Check local models').setDesc('Lists installed models without loading their weights.').addButton(b=>b.setButtonText('Check models').onClick(async()=>{b.setDisabled(true);try{await this.butler.runtime.ensure(this.butler.prefs);const r=await localRequest(this.butler.prefs.endpoint,this.butler.prefs.provider==='ollama'?'/api/tags':'/v1/models',undefined,AbortSignal.timeout(5000));new Notice((r.models??r.data??[]).map((m:any)=>m.name??m.id).join('\n')||'No local models are installed.',10000);}catch(e){new Notice((e as Error).message);}finally{this.butler.runtime.stop();b.setDisabled(false);}}));
  new Setting(el).setName('Automatic Ollama startup').setDesc('Starts Ollama for a request, then stops the copy started by OWLA. Existing servers are left running.').addToggle(t=>t.setValue(this.butler.prefs.manageOllama).onChange(async v=>{this.butler.prefs.manageOllama=v;await this.butler.save();}));
  new Setting(el).setName('Ollama executable').setDesc('Desktop only. OWLA runs this executable with the fixed “serve” command.').addText(t=>t.setValue(this.butler.prefs.executable).onChange(async v=>{this.butler.prefs.executable=v;await this.butler.save();}));
  new Setting(el).setName('Protect Mac responsiveness').setDesc('On macOS, refuses to start under memory pressure and stops generation if pressure rises.').addToggle(t=>t.setValue(this.butler.prefs.memoryGuard).onChange(async v=>{this.butler.prefs.memoryGuard=v;await this.butler.save();}));
  new Setting(el).setName('Context window').setDesc('Larger values use more memory. Start with 4096.').addDropdown(d=>d.addOptions({'2048':'2048','4096':'4096','8192':'8192'}).setValue(String(this.butler.prefs.context)).onChange(async v=>{this.butler.prefs.context=Number(v);await this.butler.save();}));
  new Setting(el).setName('Excluded folders').setDesc('Vault-relative folder paths, one per line. Hidden folders and non-Markdown files are always excluded.').addTextArea(t=>t.setValue(this.butler.prefs.excludedFolders).onChange(async v=>{this.butler.prefs.excludedFolders=v;await this.butler.save();}));
 }
}
