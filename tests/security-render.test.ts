// Regression tests for the rendered-reply DOM pass (ButlerView.sanitizeRenderedReply) and the
// string pass's code-sample handling (displayMarkdown). Findings: H6/N1/N2/N3/D1 in
// review-33-third.md, review-33-fourth.md and review-33-fifth.md.
import {test,before} from 'node:test';
import assert from 'node:assert/strict';
import {displayMarkdown} from '../src/core';
import {loadMain} from './helpers/load-main';
import {h,MiniElement} from './helpers/mini-dom';

/* eslint-disable @typescript-eslint/no-explicit-any */

let sanitize:(root:MiniElement)=>void;
before(async()=>{
 const {ButlerView}=await loadMain();
 sanitize=root=>ButlerView.prototype.sanitizeRenderedReply.call({},root);
});
const clean=(...children:MiniElement[])=>{const root=h('div',{},...children);sanitize(root);return root;};

test('DOM pass: blocked elements are removed with their content',()=>{
 const blocked=['script','style','iframe','object','embed','video','audio','source','link','picture'];
 const root=clean(...blocked.map(tag=>h(tag,{},h('span',{class:'inside'}))),h('p',{},h('script')));
 assert.deepEqual(root.tags(),['p']);
});

test('DOM pass: event handlers and resource attributes are stripped from every element',()=>{
 const root=clean(
  h('div',{onclick:'x()',onMouseOver:'y()',class:'keep'}),
  h('form',{action:'https://evil/a'},h('button',{formaction:'https://evil/b'})),
  h('table',{background:'https://evil/c'}),
  h('a',{href:'https://example.com',ping:'https://evil/d'}),
  h('div',{src:'https://evil/e',srcset:'https://evil/f 2x',poster:'https://evil/g'}),
 );
 for(const el of root.querySelectorAll('*'))for(const {name} of el.attributes){
  assert.ok(!/^on/i.test(name)&&!['src','srcset','poster','background','ping','action','formaction'].includes(name),el.tagName+' kept '+name);
 }
 assert.equal(root.find(el=>el.tagName==='DIV')?.getAttribute('class'),'keep');
});

test('DOM pass: style values that can fetch or run code are removed, plain layout styles are kept',()=>{
 for(const value of ['background:url(https://evil/a)','background: URL ( "x" )','width:expression(alert(1))','@import "https://evil/b"','x:javascript:alert(1)','background:image-set("https://evil/c" 1x)','background:u\\72l(https://evil/d)']){
  const root=clean(h('span',{style:value}));
  assert.equal(root.children[0].hasAttribute('style'),false,value);
 }
 // N1: MathJax and Obsidian use inline layout styles.
 const root=clean(h('mjx-container',{style:'margin-left:0.2em;width:3ex'}));
 assert.equal(root.children[0].getAttribute('style'),'margin-left:0.2em;width:3ex');
});

test('D1: remote, data, script and empty images are removed; other images lose their src',()=>{
 for(const src of ['https://evil/a.png','http://evil/b.png','HTTPS://evil/c.png','data:image/png;base64,AAAA','javascript:alert(1)','']){
  assert.deepEqual(clean(h('img',{src})).tags(),[],src||'(empty)');
 }
 assert.deepEqual(clean(h('img',{alt:'no src'})).tags(),[]);
 const kept=clean(h('img',{src:'app://local/vault/a.png',alt:'a'}));
 assert.deepEqual(kept.tags(),['img']);
 assert.equal(kept.children[0].hasAttribute('src'),false);
});

test('DOM pass: external link hrefs follow the scheme allowlist',()=>{
 for(const href of ['https://example.com','http://example.com','obsidian://open?vault=x','mailto:a@example.com','#heading']){
  assert.equal(clean(h('a',{href})).children[0].getAttribute('href'),href,href);
 }
 for(const href of ['javascript:alert(1)','JaVaScRiPt:alert(1)','data:text/html,x','file:///etc/passwd','vbscript:x','app://local/x','relative/Note.md']){
  assert.equal(clean(h('a',{href})).children[0].hasAttribute('href'),false,href);
 }
});

test('N3: an internal-link marker does not let a URI scheme through',()=>{
 const spoofs=[
  h('a',{class:'internal-link',href:'file:///etc/passwd'}),
  h('a',{'data-href':'x',href:'data:text/html,x'}),
  h('a',{class:'internal-link','data-href':'Note',href:'javascript:alert(1)'}),
 ];
 for(const a of clean(...spoofs).children)assert.equal(a.hasAttribute('href'),false,JSON.stringify(a.attributes));
 const real=clean(h('a',{class:'internal-link','data-href':'Notes/Note','href':'Notes/Note'}));
 assert.equal(real.children[0].getAttribute('href'),'Notes/Note');
});

test('N1: rendered task checkboxes, icons, Mermaid and math are kept; other inputs and svg are removed',()=>{
 const root=clean(
  h('ul',{},h('li',{class:'task-list-item'},h('input',{type:'checkbox',class:'task-list-item-checkbox',disabled:''}))),
  h('input',{type:'image',src:'https://evil/a'}),
  h('input',{type:'checkbox'}),
  h('input',{type:'checkbox',class:'task-list-item-checkbox'}), // not disabled → treated as model HTML
  h('span',{},h('svg',{class:'svg-icon lucide-copy'})),
  h('div',{class:'mermaid'},h('svg',{id:'m1'})),
  h('svg',{onload:'alert(1)'}),
  h('math',{},h('mi')),
 );
 assert.deepEqual(root.tags(),['ul','li','input','span','svg','div','svg','math','mi']);
});

test('N2: a lone < in prose does not expose fenced or inline code to sanitizing',()=>{
 const samples=[
  'If a < b then:\n```html\n<div style="color:red" onclick="x()">hi</div>\n```\nand c > d',
  'x < y and `<p style="m:0">` z > w',
  'Use Array<string> and Map<K, V>; see <https://example.com>.',
  'For n < 10:\n\n```ts\nconst el = `<img src="${url}">`;\n```',
 ];
 for(const text of samples)assert.equal(displayMarkdown(text),text,text);
});

test('N2: real tags next to a lone < are still sanitized',()=>{
 const out=displayMarkdown('If a < b, <p style="background:url(https://evil/a)" onclick="x()">x</p>');
 assert.doesNotMatch(out,/style=|onclick=/);
 assert.match(out,/If a < b/);
});
