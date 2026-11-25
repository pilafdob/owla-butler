// Developer-Prerelease rules (scripts/dev-release.mjs): the branch has main's
// features plus dev flags, receives merges from main only, and may bump only
// version fields here (main is bumped only in its release commit).
import {test} from 'node:test';import assert from 'node:assert/strict';
// @ts-expect-error -- plain ESM script without type declarations
import {parseDevTag,compareVersions,checkVersions,historyProblems,devNotes,devOnly,versionOnlyChange,STABLE_LINE} from '../scripts/dev-release.mjs';

const meta=(version:string)=>({base:version,manifest:{version,minAppVersion:'1.14.5'},pkg:{version},versions:{[version]:'1.14.5'}});

test('dev tags: <version>-dev and -dev.<n> from 2, nothing else',()=>{
 assert.deepEqual(parseDevTag('3.8.0-dev'),{base:'3.8.0',build:'1'});
 assert.deepEqual(parseDevTag('3.8.0-dev.2'),{base:'3.8.0',build:'2'});
 for(const bad of ['3.8.0','v3.8.0-dev','3.8.0-dev.1','3.8.0-dev.0','3.8.0-dev.01','3.8-dev'])assert.equal(parseDevTag(bad),null,bad);
 assert.equal(compareVersions('3.10.0','3.9.9'),1);
 assert.equal(compareVersions('3.8.0','3.8.0'),0);
});

test('versions: main\'s stable, or a newer one ahead of it; never behind main',()=>{
 assert.equal(checkVersions({...meta('3.7.2'),stable:'3.7.2'}),'stable');
 assert.equal(checkVersions({...meta('3.8.0'),stable:'3.7.2'}),'preview');
 assert.throws(()=>checkVersions({...meta('3.7.1'),stable:'3.7.2'}),/behind main's stable/);
 assert.throws(()=>checkVersions({...meta('3.8.0'),pkg:{version:'3.7.2'},stable:'3.7.2'}),/package version/);
 assert.throws(()=>checkVersions({...meta('3.8.0'),versions:{},stable:'3.7.2'}),/versions\.json/);
});

test('version-only bumps: only version fields change, versions.json only gains entries',()=>{
 const j=(o:unknown)=>JSON.stringify(o);
 assert.ok(versionOnlyChange('manifest.json',j({id:'x',version:'3.7.2'}),j({id:'x',version:'3.8.0'})));
 assert.ok(!versionOnlyChange('manifest.json',j({id:'x',version:'3.7.2',minAppVersion:'1'}),j({id:'x',version:'3.8.0',minAppVersion:'2'})));
 assert.ok(!versionOnlyChange('package.json',j({version:'3.7.2',dependencies:{a:'1'}}),j({version:'3.8.0',dependencies:{a:'2'}})));
 assert.ok(versionOnlyChange('package-lock.json',j({version:'3.7.2',packages:{'':{version:'3.7.2'},'node_modules/a':{version:'1'}}}),j({version:'3.8.0',packages:{'':{version:'3.8.0'},'node_modules/a':{version:'1'}}})));
 assert.ok(!versionOnlyChange('package-lock.json',j({version:'3.7.2',packages:{'':{version:'3.7.2'},'node_modules/a':{version:'1'}}}),j({version:'3.8.0',packages:{'':{version:'3.8.0'},'node_modules/a':{version:'2'}}})));
 assert.ok(versionOnlyChange('versions.json',j({'3.7.2':'1.14.5'}),j({'3.7.2':'1.14.5','3.8.0':'1.14.5'})));
 assert.ok(!versionOnlyChange('versions.json',j({'3.7.2':'1.14.5'}),j({'3.7.2':'1.15.0'})));
 assert.ok(!versionOnlyChange('manifest.json','not json',j({version:'3.8.0'})));
});

test('history: merges from main pass; features committed on the branch fail',()=>{
 const merge={sha:'a'.repeat(40),parents:['p1','p2'],changed:['src/main.ts','CHANGELOG.md'],mergedChanged:['src/main.ts','CHANGELOG.md','src/pdf-export.ts'],fromAllowedBranch:true};
 const tooling={sha:'b'.repeat(40),parents:['p'],changed:['scripts/dev-release.mjs','.github/workflows/release.yml','CONTRIBUTING.md','tests/dev-release.test.ts','src/dev-journal.ts']};
 assert.deepEqual(historyProblems([merge,tooling]),[]);
 const feature={sha:'c'.repeat(40),parents:['p'],changed:['src/main.ts','tests/dev-release.test.ts']};
 assert.match(historyProblems([feature])[0],/commits directly to Developer-Prerelease and changes src\/main\.ts/);
 const other={...merge,sha:'d'.repeat(40),fromAllowedBranch:false};
 assert.match(historyProblems([other])[0],/other than main/);
 const bump={sha:'f'.repeat(40),parents:['p'],changed:['manifest.json','versions.json','CHANGELOG.md'],versionOnly:['manifest.json','versions.json']};
 assert.deepEqual(historyProblems([bump]),[]);
 const sneaky={...bump,sha:'9'.repeat(40),changed:['manifest.json','package.json'],versionOnly:['manifest.json']};
 assert.match(historyProblems([sneaky])[0],/changes package\.json; develop on main/);
 const evil={...merge,sha:'e'.repeat(40),changed:['src/main.ts','src/new-feature.ts']};
 assert.match(historyProblems([evil])[0],/merge that also changes src\/new-feature\.ts/);
 assert.equal(devOnly('src/devtools.ts'),false);
 assert.equal(devOnly('src/dev-report.ts'),true);
});

test('notes: a preview build says so truthfully and carries the release section',()=>{
 const log='# OWLA Butler 3.8.0\n\n- **Export notes to PDF:** new.\n\nUpdate through Obsidian.\n\n# OWLA Butler 3.7.2\n\n- old\n';
 const preview=devNotes({kind:'preview',tag:'3.8.0-dev',base:'3.8.0',stable:'3.7.2',repo:'o/r',releaseLog:log});
 assert.match(preview.split('\n')[0],/^Dev prerelease of OWLA Butler 3\.8\.0 from `main`/);
 assert.ok(!preview.includes('OWLA-RC'));
 assert.match(preview,/Export notes to PDF/);
 assert.ok(!preview.includes('3.7.2\n\n- old'),'only this version\'s section');
 assert.throws(()=>devNotes({kind:'preview',tag:'3.9.0-dev',base:'3.9.0',stable:'3.7.2',repo:'o/r',releaseLog:log}),/no "# OWLA Butler 3\.9\.0" section/);
 const stable=devNotes({kind:'stable',tag:'3.7.2-dev.2',base:'3.7.2',stable:'3.7.2',repo:'o/r',releaseLog:log});
 assert.equal(stable.split('\n')[0],STABLE_LINE);
});
