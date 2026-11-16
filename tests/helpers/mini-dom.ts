// A minimal element tree with just the DOM surface sanitizeRenderedReply uses
// (see SanitizableElement in src/render-sanitize.ts). Test-only; the project
// has no DOM library.
export class MiniElement {
 readonly tagName:string;
 parentElement:MiniElement|null=null;
 children:MiniElement[]=[];
 textContent:string|null;
 private attrs=new Map<string,string>();
 constructor(tag:string,attrs:Record<string,string>={},children:(MiniElement|string)[]=[]){
  this.tagName=tag.toUpperCase();
  for(const [name,value] of Object.entries(attrs))this.attrs.set(name,value);
  const text:string[]=[];
  for(const child of children){
   if(typeof child==='string'){text.push(child);continue;}
   child.parentElement=this;this.children.push(child);
  }
  this.textContent=text.join('')||null;
 }
 get attributes(){return [...this.attrs].map(([name,value])=>({name,value}));}
 getAttribute(name:string){return this.attrs.get(name)??null;}
 hasAttribute(name:string){return this.attrs.has(name);}
 setAttribute(name:string,value:string){this.attrs.set(name,value);}
 removeAttribute(name:string){this.attrs.delete(name);}
 get classList(){const classes=(this.attrs.get('class')??'').split(/\s+/).filter(Boolean);return {contains:(name:string)=>classes.includes(name)};}
 querySelectorAll(selector:'*'){
  if(selector!=='*')throw Error('mini-dom supports only *');
  const out:MiniElement[]=[];
  const walk=(el:MiniElement)=>{for(const child of el.children){out.push(child);walk(child);}};
  walk(this);
  return out;
 }
 remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(c=>c!==this);this.parentElement=null;}}
 /** Every descendant tag name, for assertions. */
 tags(){return this.querySelectorAll('*').map(el=>el.tagName.toLowerCase());}
 find(predicate:(el:MiniElement)=>boolean){return this.querySelectorAll('*').find(predicate);}
}
export const h=(tag:string,attrs:Record<string,string>={},...children:(MiniElement|string)[])=>new MiniElement(tag,attrs,children);
