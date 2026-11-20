// Rendered-reply sanitizer (3.4.0, Batch 3): raw HTML from a prompt-injected
// reply cannot fetch, run or link out, while Obsidian's own output survives.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displayMarkdown,sanitizeRenderedReply} from '../src/render-sanitize';
import {h} from './helpers/mini-dom';

const clean=(...children:ReturnType<typeof h>[])=>{const root=h('div',{},...children);sanitizeRenderedReply(root);return root;};

test('active and fetching elements are removed',()=>{
 const root=clean(h('script',{},'alert(1)'),h('iframe',{src:'https://x'}),h('img',{src:'https://attacker/p.png'}),h('img',{src:'app://local/x.png'}),
  h('video',{poster:'https://x'}),h('audio'),h('source'),h('link',{rel:'stylesheet',href:'https://x'}),h('picture'),h('form',{action:'https://x'}),
  h('base',{href:'https://x'}),h('meta',{'http-equiv':'refresh'}),h('object'),h('embed'),h('input',{type:'image',src:'https://x'}),h('input',{type:'text'}),
  h('svg',{onload:'alert(1)'}),h('style',{},'p{color:red}'));
 assert.deepEqual(root.tags(),[]);
});

test('handlers, URL attributes and dangerous inline CSS are stripped',()=>{
 const root=clean(
  h('p',{onerror:'x',onClick:'x',id:'a'}),
  h('div',{style:'background:url(https://attacker/x)',id:'b'}),
  h('div',{style:'background:u\\72l(https://attacker/x)',id:'c'}),
  h('div',{style:'background:image-set("https://attacker/x" 1x)',id:'d'}),
  h('div',{style:'color:red;margin:1em',id:'e'}),
  h('div',{background:'https://x',ping:'https://x',id:'f'}),
 );
 const el=(id:string)=>root.find(e=>e.getAttribute('id')===id)!;
 assert.deepEqual(el('a').attributes.map(a=>a.name),['id']);
 for(const id of ['b','c','d'])assert.equal(el(id).hasAttribute('style'),false,id);
 assert.equal(el('e').getAttribute('style'),'color:red;margin:1em');
 assert.deepEqual(el('f').attributes.map(a=>a.name),['id']);
});

test('links keep web, mail and fragment targets only; internal links never carry a scheme',()=>{
 const root=clean(
  h('a',{href:'javascript:alert(1)',id:'js'}),h('a',{href:'data:text/html,x',id:'data'}),h('a',{href:'file:///etc/passwd',id:'file'}),
  h('a',{href:'vbscript:x',id:'vb'}),h('a',{href:'obsidian://advanced-uri?commandid=x',id:'uri'}),
  h('a',{href:'https://example.com',id:'web'}),h('a',{href:'mailto:a@b.c',id:'mail'}),h('a',{href:'#top',id:'frag'}),
  h('a',{class:'internal-link',href:'file:///etc/passwd','data-href':'file:///etc/passwd',id:'intfile'}),
  h('a',{class:'internal-link',href:'Notes/A.md','data-href':'Notes/A.md',id:'note'}),
  h('area',{href:'javascript:x',id:'area'}),
 );
 const href=(id:string)=>root.find(e=>e.getAttribute('id')===id)!.getAttribute('href');
 for(const id of ['js','data','file','vb','uri','intfile','area'])assert.equal(href(id),null,id);
 assert.equal(href('web'),'https://example.com');assert.equal(href('mail'),'mailto:a@b.c');assert.equal(href('frag'),'#top');
 assert.equal(href('note'),'Notes/A.md');
});

test('task checkboxes, icons, Mermaid and MathJax survive',()=>{
 const root=clean(
  h('ul',{},h('li',{class:'task-list-item'},h('input',{type:'checkbox',class:'task-list-item-checkbox'}))),
  h('div',{class:'callout-icon'},h('svg',{class:'svg-icon lucide-info'},h('path',{d:'M0 0'}))),
  h('div',{class:'mermaid'},h('svg',{id:'m'},h('style',{},'#m .node rect{fill:#eee}'),h('use',{href:'#marker'}),h('g',{},h('foreignObject',{},h('div',{},h('span',{class:'nodeLabel'},'A')))))),
  h('mjx-container',{class:'MathJax',jax:'CHTML'},h('mjx-math',{style:'margin-left:0.1em'},h('mjx-mi',{},'e')),h('math',{},h('mi',{},'e')),h('svg',{},h('use',{'xlink:href':'#MJX-1'}))),
 );
 const box=root.find(e=>e.tagName==='INPUT')!;
 assert.equal(box.hasAttribute('disabled'),true);
 for(const tag of ['svg','path','style','use','foreignobject','span','mjx-container','mjx-math','math','mi'])assert.ok(root.tags().includes(tag),tag);
 assert.equal(root.find(e=>e.tagName==='USE'&&e.parentElement?.tagName==='SVG'&&!!e.getAttribute('href'))?.getAttribute('href'),'#marker');
 assert.equal(root.find(e=>e.tagName==='MJX-MATH')!.getAttribute('style'),'margin-left:0.1em');
 assert.equal(root.find(e=>e.hasAttribute('xlink:href'))?.getAttribute('xlink:href'),'#MJX-1');
});

test('Mermaid output cannot smuggle a fetch: bad CSS, external use, remote image',()=>{
 const root=clean(h('div',{class:'mermaid'},h('svg',{},
  h('style',{},'@import url(https://attacker/x.css)'),h('use',{href:'https://attacker/s.svg#a'}),h('image',{href:'https://attacker/p.png'}),
  h('foreignObject',{},h('img',{src:'https://attacker/p.png'})))));
 assert.deepEqual(root.tags(),['div','svg','use','foreignobject']);
 assert.equal(root.find(e=>e.tagName==='USE')!.hasAttribute('href'),false);
});

test('displayMarkdown only neutralizes embeds and never touches code or math',()=>{
 assert.equal(displayMarkdown('![private](https://example.com/a.png)'),'[private](https://example.com/a.png)');
 assert.equal(displayMarkdown('![[photo.png]]'),'[[photo.png]]');
 const fenced='```html\n<img src="https://example.com/a"> ![x](y)\n```';
 assert.equal(displayMarkdown(fenced),fenced);
 assert.equal(displayMarkdown('If a < b then `<img src=x> ![a](b)` stays, ![c](d) does not'),'If a < b then `<img src=x> ![a](b)` stays, [c](d) does not');
 assert.equal(displayMarkdown('$a < b$ and $$x<y$$'),'$a < b$ and $$x<y$$');
 const tilde='~~~\n![keep](me)\n~~~\n![drop](me)';
 assert.equal(displayMarkdown(tilde),'~~~\n![keep](me)\n~~~\n[drop](me)');
});

// Block math is literal to MathJax: an embed marker inside $$…$$ must survive
// verbatim, across lines as well as on one line, while markdown outside it is
// still neutralized.
test('displayMarkdown leaves block math untouched, multi-line and inline',()=>{
 const block='$$\n![keep](me)\n$$\n![drop](me)';
 assert.equal(displayMarkdown(block),'$$\n![keep](me)\n$$\n[drop](me)');
 assert.equal(displayMarkdown('$$![keep](me)$$'),'$$![keep](me)$$');
 assert.equal(displayMarkdown('before ![a](b) $$x<y$$ after ![c](d)'),'before [a](b) $$x<y$$ after [c](d)');
 const fencedMath='```\n$$\n![keep](me)\n```';
 assert.equal(displayMarkdown(fencedMath),fencedMath);
});

// CRLF notes (common on Windows) keep their line endings: fences, block math
// and the embed rewrite must behave exactly as with LF.
test('displayMarkdown handles CRLF line endings without altering them',()=>{
 const crlf='```html\r\n<img src="https://example.com/a"> ![x](y)\r\n```\r\n![drop](me)\r\n$$\r\n![keep](me)\r\n$$\r\n';
 assert.equal(displayMarkdown(crlf),'```html\r\n<img src="https://example.com/a"> ![x](y)\r\n```\r\n[drop](me)\r\n$$\r\n![keep](me)\r\n$$\r\n');
 assert.equal(displayMarkdown('![a](b)\r\nplain\r\n'),'[a](b)\r\nplain\r\n');
});

// SMIL can re-add an attribute after the sanitizer ran: <animate attributeName
// ="href" to="javascript:…"> or <set attributeName="onload">. Outside Obsidian's
// renderers no animation survives; inside them only harmless ones do.
test('SMIL animations cannot re-add a URL, handler or style attribute',()=>{
 const root=clean(
  h('svg',{class:'svg-icon'},h('a',{},h('animate',{attributeName:'href',to:'javascript:alert(1)'}),h('set',{attributeName:'onload',to:'alert(1)'}),h('text',{},'click'))),
  h('div',{class:'mermaid'},h('svg',{},
   h('animate',{attributeName:'href',values:'javascript:alert(1)'}),
   h('set',{attributeName:'style',to:'background:url(https://attacker/x)'}),
   h('animate',{attributeName:'opacity',from:'0',to:'1'}))),
 );
 assert.deepEqual(root.find(e=>e.tagName==='SVG'&&e.classList.contains('svg-icon'))!.tags(),['a','text']);
 const mermaid=root.find(e=>e.classList.contains('mermaid'))!;
 assert.deepEqual(mermaid.tags(),['svg','animate']);
 assert.equal(mermaid.find(e=>e.tagName==='ANIMATE')!.getAttribute('attributeName'),'opacity');
});

// Browsers strip tab/LF/CR inside a URL before resolving its scheme, so a
// scheme spelled with embedded controls must be judged without them.
test('links with control characters in the scheme are refused, data-href meets the same rule',()=>{
 const root=clean(
  h('a',{href:'java\nscript:alert(1)',id:'nl'}),
  h('a',{href:'java\tscript:alert(1)',id:'tab'}),
  h('a',{href:' javascript:alert(1)',id:'lead'}),
  h('a',{class:'internal-link',href:'java\rscript:alert(1)','data-href':'java\rscript:alert(1)',id:'int'}),
  h('a',{class:'internal-link','data-href':'javascript:alert(1)',id:'data'}),
  h('a',{href:'https://example.com/a b',id:'space'}),
  h('a',{class:'internal-link',href:'Notes/A.md','data-href':'Notes/A.md',id:'note'}),
 );
 const href=(id:string)=>root.find(e=>e.getAttribute('id')===id)!.getAttribute('href');
 for(const id of ['nl','tab','lead','int'])assert.equal(href(id),null,id);
 assert.equal(root.find(e=>e.getAttribute('id')==='data')!.hasAttribute('data-href'),false);
 assert.equal(href('space'),'https://example.com/a b');
 assert.equal(href('note'),'Notes/A.md');
 assert.equal(root.find(e=>e.getAttribute('id')==='note')!.getAttribute('data-href'),'Notes/A.md');
});
