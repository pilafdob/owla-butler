import {test} from 'node:test';import assert from 'node:assert/strict';
import {allowedPath,proposal,assertFresh,assertNoteTitle,insertion,stripFence,parseJsonLine,formatTranscription,displayMarkdown} from '../src/core';
test('vault boundary and excluded folders',()=>{assert.ok(allowedPath('Math/Equations.md'));for(const p of ['../Note.md','/tmp/Note.md','.obsidian/config.md','Notes/.env.md','a/../Note.md','a\\note.md','image.png','Private/Note.md'])assert.equal(allowedPath(p,'Private'),false,p);});
test('small replacement preserves academic metadata and untouched content',()=>{const s='---\ncitekey: smith2024\n---\n[[Related]]\nThe result is 4.\n![[image.png]]\n';const p=proposal('A.md',s,'The result is 4.','The result is $x=4$.','Format math');assert.equal(p.after,s.replace('The result is 4.','The result is $x=4$.'));});
test('ambiguous and missing replacements are rejected',()=>{assert.throws(()=>proposal('A.md','same same','same','new','why'));assert.throws(()=>proposal('A.md','hello','missing','new','why'));});
test('stale approval and stale undo preserve newer edits',()=>{assert.throws(()=>assertFresh('new user text','old snapshot'));assert.doesNotThrow(()=>assertFresh('same','same'));});
test('capture target and exact selection are stable across later tab changes',()=>{const p=insertion('Original.md','before selected after','replacement',7,15);assert.equal(p.path,'Original.md');assert.equal(p.after,'before replacement after');});
test('append and fenced Markdown insertion',()=>{assert.equal(proposal('A.md','heading','','$$\nx=2\n$$','Append').after,'heading\n\n$$\nx=2\n$$');assert.equal(stripFence('```markdown\n[[Note]]\n```'),'[[Note]]');});
test('stream formats',()=>{assert.deepEqual(parseJsonLine('data: {"a":1}'),{a:1});assert.equal(parseJsonLine('data: [DONE]'),null);assert.deepEqual(parseJsonLine('{"done":true}'),{done:true});});


test('simple transcribed equations become display math without changing symbols',()=>{assert.equal(formatTranscription(' Solve: 2x + 3 = 11'),'Solve:\n\n$$\n2x + 3 = 11\n$$');assert.equal(formatTranscription('This is a paragraph.'),'This is a paragraph.');});
test('Markdown insertion cannot corrupt YAML and separates multiline blocks',()=>{assert.throws(()=>insertion('A.md','---\ntitle: Test\n---\nBody','$$\nx=4\n$$',5),/Properties/);assert.equal(insertion('A.md','text here','$$\nx=4\n$$',4).after,'text\n\n$$\nx=4\n$$\n\n here');});
test('rendered model content cannot automatically embed remote images',()=>{assert.equal(displayMarkdown('![private](https://example.com/a.png)'),'[private](https://example.com/a.png)');assert.equal(displayMarkdown('<img src="https://example.com/a">'),'');});


test('vault recovery and chat namespaces are stable and separated',async()=>{const {vaultStorageKey}=await import('../src/core');assert.equal(vaultStorageKey('/vault/A'),vaultStorageKey('/vault/A'));assert.notEqual(vaultStorageKey('/vault/A'),vaultStorageKey('/vault/B'));assert.match(vaultStorageKey('/vault/A'),/^[a-f0-9]{20}$/);});
test('edit review flags removed citations, links and changed properties',async()=>{const {editWarnings}=await import('../src/core');const before='---\ncitekey: smith2024\n---\nQuote [@smith2024, p. 3] [[Related]]';assert.equal(editWarnings(before,before).length,0);const warnings=editWarnings(before,'New paragraph');assert.ok(warnings.some(w=>w.includes('smith2024')));assert.ok(warnings.some(w=>w.includes('properties')));assert.ok(warnings.some(w=>w.includes('wikilinks')));});

test('explicit quoted edits are exact user instructions, not model prose',async()=>{const {requestedReplacement}=await import('../src/core');assert.deepEqual(requestedReplacement('replace exactly "Revise biology." with "Use active recall."'),{oldText:'Revise biology.',newText:'Use active recall.'});assert.equal(requestedReplacement('Improve my note'),null);});

test('invalid persisted setting values fall back to safe defaults',async()=>{
 const {migrateSettings}=await import('../src/core');const prefs=migrateSettings({schemaVersion:2,codexExecutable:{path:'/unexpected'},model:42,reasoning:false,excludedFolders:'Private',webSearch:false});
 assert.equal(prefs.codexExecutable,'');assert.equal(prefs.models.codex.model,'');assert.equal(prefs.models.codex.reasoning,'');assert.equal(prefs.excludedFolders,'Private');assert.equal(prefs.webSearch,false);
});

test('only a saved Codex opt-in enables automatic startup after reload',async()=>{
 const {migrateSettings}=await import('../src/core');
 assert.equal(migrateSettings(null).codexConnected,false);
 const legacy=migrateSettings({schemaVersion:2,model:'existing-model',reasoning:'high'});
 assert.equal(legacy.codexConnected,false);
 assert.equal(legacy.models.codex.model,'existing-model');
 assert.equal(migrateSettings({...legacy,codexConnected:'true'}).codexConnected,false);
 const connected=migrateSettings({...legacy,codexConnected:true});
 assert.equal(connected.codexConnected,true);
 assert.equal(migrateSettings({...connected,codexConnected:false}).codexConnected,false);
});

test('separate replacements and appends produce one proposal against the original note', async () => {
 const {stageProposal} = await import('../src/core');
 const before = 'First paragraph.\n\nSecond paragraph.\n';
 const first = stageProposal(before, {
  path:'A.md', oldText:'First paragraph.', newText:'## First', reason:'Add heading'
 });
 const second = stageProposal(before, {
  path:'A.md', oldText:'Second paragraph.', newText:'## Second', reason:'Add another heading'
 }, first);
 const combined = stageProposal(before, {
  path:'A.md', oldText:'', newText:'## Conclusion', reason:'Append conclusion'
 }, second);
 assert.equal(combined.edit.before, before);
 assert.equal(combined.edit.after, '## First\n\n## Second\n\n## Conclusion');
 assert.deepEqual(combined.reasons, ['Add heading', 'Add another heading', 'Append conclusion']);
});

test('a follow-up change can use staged text and a conflicting replacement keeps the earlier batch intact', async () => {
 const {stageProposal} = await import('../src/core');
 const before = 'Original sentence.';
 const first = stageProposal(before, {
  path:'A.md', oldText:'Original sentence.', newText:'Draft sentence.', reason:'Rewrite'
 });
 assert.throws(() => stageProposal(before, {
  path:'A.md', oldText:'Original sentence.', newText:'Conflicting sentence.', reason:'Old snapshot'
 }, first), /not found/);
 assert.equal(first.edit.after, 'Draft sentence.');
 const revised = stageProposal(before, {
  path:'A.md', oldText:'Draft sentence.', newText:'Final sentence.', reason:'Refine'
 }, first);
 assert.equal(revised.edit.before, before);
 assert.equal(revised.edit.after, 'Final sentence.');
});

test('inline titles reject a matching leading heading and allow body edits', () => {
 const properties = '---\r\ntags: [history]\r\n---\r\n\r\n';
 const body = '## Merkmale\r\n\r\nText.';
 const edit = {path:'History/Merkmale einer Zivilisation.md',before:properties+body,after:properties+body,reason:'Improve the note'};
 for (const heading of ['# Merkmale einer Zivilisation', '## merkmale einer zivilisation ##', 'Merkmale einer Zivilisation\r\n===']) {
  const duplicate = {...edit,after:properties+heading+'\r\n\r\n'+body};
  assert.throws(() => assertNoteTitle(duplicate,true), /filename/);
  assert.doesNotThrow(() => assertNoteTitle(duplicate,false));
 }
 assert.doesNotThrow(() => assertNoteTitle({...edit,after:properties+body.replace('Text.','Revised.')},true));
 const existing = {...edit,before:properties+'# Merkmale einer Zivilisation\r\n\r\n'+body};
 assert.doesNotThrow(() => assertNoteTitle(existing,true));
 assert.doesNotThrow(() => assertNoteTitle({...existing,after:existing.before.replace('Text.','Revised.')},true));
});

test('unknown inline title setting protects the existing top title while allowing section edits', () => {
 const edit = {path:'Note.md',before:'# Existing title\n\n## Section\n\nBody.',after:'',reason:'Edit the note'};
 assert.throws(() => assertNoteTitle({...edit,after:edit.before.replace('Existing title','New title')},undefined), /Preserve the top title/);
 assert.throws(() => assertNoteTitle({...edit,after:'## Section\n\nBody.'},undefined), /Preserve the top title/);
 assert.throws(() => assertNoteTitle({...edit,before:'Body.',after:edit.before},undefined), /Preserve the top title/);
 assert.doesNotThrow(() => assertNoteTitle({...edit,after:edit.before.replace('## Section','## Details')},undefined));
 assert.doesNotThrow(() => assertNoteTitle({...edit,before:'## Section',after:'## Details'},undefined));
});

test('diff view settings preserve the legacy toggle and validate selector values',async()=>{
 const {migrateSettings}=await import('../src/core');
 assert.equal(migrateSettings({editingViewDiff:true}).diffView,'highlights');
 assert.equal(migrateSettings({editingViewDiff:false}).diffView,'none');
 assert.equal(migrateSettings({diffView:'split',editingViewDiff:true}).diffView,'split');
 assert.equal(migrateSettings({diffView:'none',editingViewDiff:true}).diffView,'none');
 assert.equal(migrateSettings({diffView:'unexpected'}).diffView,'none');
});
