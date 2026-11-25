import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';import {join,sep} from 'node:path';
import {REFERENCE_NAMES,readReference} from '../src/knowledge';
test('bundled original Obsidian skills and references match the build pack',()=>{for(const name of ['obsidian-markdown','obsidian-bases','json-canvas']){assert.ok(REFERENCE_NAMES.includes(name));assert.ok(readReference(name).includes('REFERENCE'));}const pack=JSON.parse(readFileSync('assets/reference-pack.json','utf8'));const walk=(folder:string)=>{for(const d of readdirSync(folder,{withFileTypes:true})){const p=join(folder,d.name);if(d.isDirectory())walk(p);else if(p.endsWith('.md')){const key=p.split(sep).join('/').replace('assets/skills/','').replace(/\.md$/,'').replace('/SKILL','');assert.equal(pack[key]?.replace(/\r\n/g,'\n'),readFileSync(p,'utf8').replace(/\r\n/g,'\n'));}}};walk('assets/skills');});
test('skill reads are bounded and cannot access filesystem paths',()=>{assert.throws(()=>readReference('../../.env'));assert.throws(()=>readReference('owla-ocr',-1));assert.throws(()=>readReference('owla-ocr',NaN));assert.ok(readReference('obsidian-markdown').length<1600);assert.ok(readReference('obsidian-markdown',1400).includes('(1400–'));});
test('math reference contains actual Markdown LaTeX rather than JSON escapes',()=>{const math=readReference('owla-math');assert.ok(math.includes('\\frac{a}{b}'));assert.equal(math.includes('\\\\frac'),false);assert.ok(math.includes('\\\\ c & d'));});
test('math requests select the actual Math section without unrelated Canvas/Bases instructions',async()=>{const {taskReference}=await import('../src/knowledge');const ref=taskReference('Solve an equation using LaTeX');assert.ok(ref?.text.includes('\\frac{a}{b}'));assert.ok(ref?.text.includes('$$'));assert.equal(taskReference('What is the title?'),null);});

test('Mermaid and coloured highlights are available in the bundled formatting guidance',async()=>{
 const {taskReference,readReference}=await import('../src/knowledge');
 const diagram=taskReference('Draw a flowchart');
 assert.equal(diagram?.name,'owla-mermaid');
 assert.match(diagram?.text??'',/```mermaid\nflowchart TD/);
 assert.match(diagram?.text??'',/internal-link/);
 const formatting=readReference('owla-formatting');
 for(const marker of ['🔴','🟠','🟡','🟢','🔵','🟣'])assert.ok(formatting.includes('=='+marker+'text=='));
});

test('OWLA Obsidian Guide is registered, readable and paged with the side-by-side answer first',async()=>{
 const {skillDefinitions,readReference}=await import('../src/knowledge');
 const guide=skillDefinitions().find(skill=>skill.id==='owla-obsidian-guide');
 assert.ok(guide);assert.ok(guide.name);assert.ok(guide.description,'guide carries frontmatter name/description');
 const page1=readReference('owla-obsidian-guide');
 assert.ok(page1.includes('REFERENCE owla-obsidian-guide'));
 assert.ok(page1.includes('![[left.png\\|300]]'),'side-by-side table answer is in the first passage');
 assert.ok(page1.includes('## Behaviour rules'));
 const page2=readReference('owla-obsidian-guide',1400);
 assert.ok(page2.includes('(1400–'));
 assert.ok(page2.includes('## Making a note look professional'));
});

test('visual-improvement and layout requests load the Obsidian guide (EN and DE)',async()=>{
 const {taskReference}=await import('../src/knowledge');
 for(const request of ['make this look professional','improve the formatting','Can pictures sit side by side?','images next to each other','Improve the layout of this note','Formatierung verbessern','Mach das professioneller.','Bilder nebeneinander anordnen','Wie füge ich Bilder ein?','make it look better']){
  const ref=taskReference(request);
  assert.equal(ref?.name,'owla-obsidian-guide',request);
  assert.ok(ref.text.length>0);assert.ok(ref.text.includes('## Images'));
 }
});

test('the guide does not swallow existing references or image-content questions',async()=>{
 const {taskReference}=await import('../src/knowledge');
 assert.equal(taskReference('Draw a flowchart')?.name,'owla-mermaid');
 assert.equal(taskReference('Diagramme nebeneinander zeichnen')?.name,'owla-obsidian-guide');
 assert.equal(taskReference('Flussdiagramm nebeneinander zeichnen')?.name,'owla-mermaid');
 assert.equal(taskReference('highlight the key words')?.name,'owla-formatting');
 assert.equal(taskReference('Formatiere den Text')?.name,'owla-formatting');
 assert.equal(taskReference('describe the attached image'),null);
 assert.equal(taskReference('transcribe this picture'),null);
 assert.equal(taskReference('read this image for me'),null);
 assert.equal(taskReference('summarize the note for me'),null);
});
