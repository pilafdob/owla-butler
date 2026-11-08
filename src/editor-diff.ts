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
export function editorDiff(getState:()=>{enabled:boolean;pending:readonly EditBatch[]}) {
 const refresh=StateEffect.define<null>();
 const decorations=(state:EditorState):DecorationSet=>{
  const {enabled,pending}=getState();
  if(!enabled)return Decoration.none;
  const path=state.field(editorInfoField,false)?.file?.path;
  const batch=pending.find(item=>item.edit.path===path);
  if(!batch || state.doc.toString()!==batch.edit.after || batch.edit.before.length+batch.edit.after.length>200000)return Decoration.none;
  const ranges=[];
  let offset=0;
  for(const part of diffLines(batch.edit.before,batch.edit.after)){
   if(part.removed){ranges.push(Decoration.widget({widget:new RemovedText(part.value),block:true,side:-1}).range(offset));}
   else {
    if(part.added && part.value.length) {
     ranges.push(Decoration.mark({class:'owla-editor-added',attributes:{'aria-label':'Added text'}}).range(offset,offset+part.value.length));
    }
    offset+=part.value.length;
   }
  }
  return Decoration.set(ranges,true);
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
