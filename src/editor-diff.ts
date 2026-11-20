import {StateEffect,StateField,EditorState} from '@codemirror/state';
import {Decoration,DecorationSet,EditorView,WidgetType,ViewPlugin} from '@codemirror/view';
import {editorInfoField} from 'obsidian';
import {diffLines} from 'diff';
import type {EditBatch} from './core';

class RemovedText extends WidgetType {
 constructor(private text:string){super();}
 eq(other:RemovedText){return this.text===other.text;}
 toDOM(){const el=createDiv();el.className='owla-editor-removed';el.textContent=this.text;el.setAttribute('aria-label','Removed text');return el;}
 ignoreEvent(){return true;}
}
/**
 * Decorations for a note that shows the proposed text. The editor document
 * always uses `\n` (CodeMirror normalises line endings on load), so a Windows
 * CRLF note is compared and diffed with its endings normalised: otherwise the
 * document never equals the proposal (no highlights at all) and every range
 * would sit as many characters off as there are `\r`s before it. LF notes are
 * unchanged by the normalisation.
 */
export function diffDecorations(docText:string,before:string,after:string):DecorationSet{
 if(before.length+after.length>200000)return Decoration.none;
 const b=before.replace(/\r\n?|\n/g,'\n'),a=after.replace(/\r\n?|\n/g,'\n');
 if(docText!==a)return Decoration.none;
 const ranges=[];
 let offset=0;
 for(const part of diffLines(b,a)){
  if(part.removed){ranges.push(Decoration.widget({widget:new RemovedText(part.value),block:true,side:-1}).range(offset));}
  else {
   if(part.added && part.value.length) {
    ranges.push(Decoration.mark({class:'owla-editor-added',attributes:{'aria-label':'Added text'}}).range(offset,offset+part.value.length));
   }
   offset+=part.value.length;
  }
 }
 return Decoration.set(ranges,true);
}
export function editorDiff(getState:()=>{enabled:boolean;pending:readonly EditBatch[]}) {
 const refresh=StateEffect.define<null>();
 const decorations=(state:EditorState):DecorationSet=>{
  const {enabled,pending}=getState();
  if(!enabled)return Decoration.none;
  const path=state.field(editorInfoField,false)?.file?.path;
  const batch=pending.find(item=>item.edit.path===path);
  if(!batch)return Decoration.none;
  return diffDecorations(state.doc.toString(),batch.edit.before,batch.edit.after);
 };
 const field=StateField.define<DecorationSet>({
  create:decorations,
  update(value,transaction){return transaction.docChanged || transaction.effects.some(effect=>effect.is(refresh))?decorations(transaction.state):value;},
  provide:field=>EditorView.decorations.from(field)
 });
 const updates=ViewPlugin.fromClass(class {
  private listener=()=>this.view.dispatch({effects:refresh.of(null)});
  constructor(private view:EditorView){window.addEventListener('owla-diff-refresh',this.listener);}
  destroy(){window.removeEventListener('owla-diff-refresh',this.listener);}
 });
 return [field,updates];
}
export function refreshEditorDiff(){window.dispatchEvent(new Event('owla-diff-refresh'));}
