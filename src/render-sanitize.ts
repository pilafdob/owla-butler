/**
 * Sanitizes a model reply after Obsidian has rendered it.
 *
 * A reply is untrusted: a prompt-injected note can make the model write raw
 * HTML that fetches a remote URL as soon as it is shown (an image, a CSS
 * `url(...)`, an SVG `<image>`), runs a handler, or links to `javascript:`.
 * The check runs on the rendered DOM rather than on the Markdown text, so code
 * samples (```html fences, inline code) and math such as `$a < b$` are never
 * rewritten. Obsidian's own output is kept: task-list checkboxes (made
 * read-only), icons, Mermaid diagrams and MathJax.
 *
 * Only the DOM surface below is used, so tests can run it on a small stand-in.
 */
export interface SanitizableElement {
 readonly tagName:string;
 readonly attributes:ArrayLike<{name:string;value:string}>;
 readonly parentElement:SanitizableElement|null;
 readonly classList:{contains(name:string):boolean};
 textContent:string|null;
 getAttribute(name:string):string|null;
 hasAttribute(name:string):boolean;
 setAttribute(name:string,value:string):void;
 removeAttribute(name:string):void;
 remove():void;
}
export interface SanitizableRoot {querySelectorAll(selector:'*'):ArrayLike<SanitizableElement>;}

/** Elements that load, run or submit something on their own. `img` is here because `![` is already turned into a link before rendering, so any image left came from raw HTML. */
const BLOCKED=new Set(['script','iframe','frame','frameset','object','embed','applet','video','audio','track','source','link','picture','img','image','feimage','form','base','meta','portal','template','dialog']);
/** SMIL animation elements: they can re-add an attribute after sanitizing (`<set attributeName="onload">`, `<animate attributeName="href" to="javascript:…">`). */
const SMIL=new Set(['animate','animatetransform','animatemotion','set','discard']);
/** Attributes that fetch a URL or submit a form. */
const URL_ATTRIBUTES=new Set(['src','srcset','poster','background','ping','action','formaction','lowsrc','dynsrc','data','codebase','manifest']);
/** CSS that can fetch a resource or execute. A backslash is refused too, because CSS escapes can spell `url` (`u\72l`). */
export const DANGEROUS_CSS=/url\s*\(|@import|expression\s*\(|image-set\s*\(|-moz-binding|behavior\s*:|javascript:|\\/i;
const SCHEME=/^[a-z][a-z0-9+.-]*:/i;
const SAFE_LINK=/^(?:https?:|mailto:|#)/i;
// eslint-disable-next-line no-control-regex -- URL scheme checks must see the URL the way the browser resolves it, without embedded control characters
const HREF_CONTROLS=/[\u0000-\u0020\u007f-\u009f]/g;
const stripHrefControls=(value:string)=>value.replace(HREF_CONTROLS,'');

/** Inside a Mermaid diagram or MathJax output, which Obsidian renders itself. */
function inTrustedRenderer(el:SanitizableElement):boolean{
 for(let current:SanitizableElement|null=el;current;current=current.parentElement){
  if(current.classList.contains('mermaid')||current.tagName.toLowerCase()==='mjx-container')return true;
 }
 return false;
}

export function sanitizeRenderedReply(root:SanitizableRoot):void{
 for(const el of Array.from(root.querySelectorAll('*'))){
  const tag=el.tagName.toLowerCase();
  if(BLOCKED.has(tag)){el.remove();continue;}
  if(SMIL.has(tag)){
   // Outside Obsidian's own renderers no animation is needed; inside them,
   // one that targets a URL, handler or style attribute can re-add what the
   // attribute pass below strips, so it goes too.
   const target=(el.getAttribute('attributeName')??'').toLowerCase();
   const values=['to','from','by','values'].map(name=>el.getAttribute(name)??'').join(' ');
   const dangerous=target.startsWith('on')||URL_ATTRIBUTES.has(target)||target==='href'||target==='xlink:href'||target==='style'||/javascript:|data:|url\s*\(/i.test(values);
   if(dangerous||!inTrustedRenderer(el)){el.remove();continue;}
  }
  if(tag==='input'){
   if(el.getAttribute('type')!=='checkbox'||!el.classList.contains('task-list-item-checkbox')){el.remove();continue;}
   if(!el.hasAttribute('disabled'))el.setAttribute('disabled','');
  }
  if(tag==='svg'&&!el.classList.contains('svg-icon')&&!inTrustedRenderer(el)){el.remove();continue;}
  if(tag==='style'&&(!inTrustedRenderer(el)||DANGEROUS_CSS.test(el.textContent??''))){el.remove();continue;}
  const link=tag==='a'||tag==='area';
  for(const {name:rawName,value} of Array.from(el.attributes)){
   const name=rawName.toLowerCase();
   if(name.startsWith('on')||URL_ATTRIBUTES.has(name)){el.removeAttribute(rawName);continue;}
   if(name==='style'){if(DANGEROUS_CSS.test(value))el.removeAttribute(rawName);continue;}
   // A scheme in data-href never names a vault note; the click handler reads
   // it like an href, so it meets the same rule.
   if(name==='data-href'&&SCHEME.test(stripHrefControls(value))){el.removeAttribute(rawName);continue;}
   if(name==='xlink:href'||(name==='href'&&!link)){
    // A fragment reference (SVG <use href="#id">) stays inside Mermaid and MathJax output only.
    if(!(value.trim().startsWith('#')&&inTrustedRenderer(el)))el.removeAttribute(rawName);
   }
  }
  if(link){
   // Browsers drop tab/LF/CR inside a URL before resolving the scheme, so
   // `java&#10;script:` must be judged without them, not as written.
   const href=stripHrefControls(el.getAttribute('href')??'');
   if(!href)continue;
   const internal=el.classList.contains('internal-link')||el.hasAttribute('data-href');
   if(internal?SCHEME.test(href):!SAFE_LINK.test(href))el.removeAttribute('href');
  }
 }
}

/**
 * The Markdown-side step, kept small on purpose: `![` becomes `[` so an image
 * or embed is shown as a link and nothing is fetched. Fenced code, inline
 * code and block math ($$…$$) are left exactly as written; everything else is
 * handled on the DOM.
 */
export function displayMarkdown(text:string):string{
 const lines=text.split('\n');
 let fence:string|null=null;
 let math=false;
 return lines.map(line=>{
  const marker=line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
  if(fence){if(marker&&marker[0]===fence[0]&&marker.length>=fence.length&&!line.trim().slice(marker.length).trim())fence=null;return line;}
  if(marker){fence=marker;return line;}
  // A $$ delimiter line opens or closes block math; its content is literal to
  // MathJax, not Markdown, so an embed marker inside it must survive verbatim.
  const dollars=line.match(/\$\$/g)?.length??0;
  if(math||dollars%2===1){if(dollars%2===1)math=!math;return line;}
  return line.split(/(`+[^`]*?`+|\$\$[\s\S]*?\$\$)/).map((part,index)=>index%2?part:part.replace(/!\[/g,'[')).join('');
 }).join('\n');
}
