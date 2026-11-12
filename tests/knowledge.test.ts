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
