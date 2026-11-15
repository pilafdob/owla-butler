// A minimal element tree with just the DOM surface sanitizeRenderedReply uses:
// querySelectorAll('*'), tagName, attributes, get/has/removeAttribute, classList.contains,
// closest('.class') and remove(). Test-only; the project has no DOM library.
export class MiniElement {
 readonly tagName:string;
 parent:MiniElement|null=null;
 children:MiniElement[]=[];
 private attrs=new Map<string,string>();
 constructor(tag:string,attrs:Record<string,string>={},children:MiniElement[]=[]){
  this.tagName=tag.toUpperCase();
  for(const [name,value] of Object.entries(attrs))this.attrs.set(name,value);
  for(const child of children){child.parent=this;this.children.push(child);}
 }
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
 getAttribute(name:string){return this.attrs.get(name)??null;}
 hasAttribute(name:string){return this.attrs.has(name);}
 removeAttribute(name:string){this.attrs.delete(name);}
 get classList(){const classes=(this.attrs.get('class')??'').split(/\s+/).filter(Boolean);return {contains:(name:string)=>classes.includes(name)};}
 closest(selector:string):MiniElement|null{
  if(!selector.startsWith('.'))throw Error('mini-dom supports only .class selectors');
  for(let el:MiniElement|null=this;el;el=el.parent)if(el.classList.contains(selector.slice(1)))return el;
  return null;
 }
 querySelectorAll(selector:string){
  if(selector!=='*')throw Error('mini-dom supports only *');
  const out:MiniElement[]=[];
  const walk=(el:MiniElement)=>{for(const child of el.children){out.push(child);walk(child);}};
  walk(this);
  return out;
 }
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;}}
 /** Every descendant tag name, for assertions. */
 tags(){return this.querySelectorAll('*').map(el=>el.tagName.toLowerCase());}
 find(predicate:(el:MiniElement)=>boolean){return this.querySelectorAll('*').find(predicate);}
}
export const h=(tag:string,attrs:Record<string,string>={},...children:MiniElement[])=>new MiniElement(tag,attrs,children);
