// The GitHub release body must hold only the tagged version's section of the
// release log, never the whole RELEASE-NOTES.md.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const script=join(__dirname,'..','scripts','release-notes.mjs');
function notesFor(log:string,version:string){
 const root=mkdtempSync(join(tmpdir(),'owla-notes-'));
 try{
  mkdirSync(join(root,'scripts'));copyFileSync(script,join(root,'scripts','release-notes.mjs'));
  writeFileSync(join(root,'RELEASE-NOTES.md'),log);
  const out=join(root,'out.md');
  execFileSync(process.execPath,[join(root,'scripts','release-notes.mjs'),version,out],{env:{...process.env,GITHUB_REPOSITORY:'owner/repo'},stdio:'pipe'});
  return readFileSync(out,'utf8');
 }finally{rmSync(root,{recursive:true,force:true});}
}
const LOG='<!-- log -->\n\n# OWLA Butler 2.1.0\n\n- New thing.\n\n# OWLA Butler 2.0.0\n\n- Old thing.\r\n\n# OWLA Butler 1.0.0\n\n- First.\n';

test('release notes hold only the tagged section and a changelog link',()=>{
 assert.equal(notesFor(LOG,'2.1.0'),'# OWLA Butler 2.1.0\n\n- New thing.\n\nFull changelog: [CHANGELOG.md](https://github.com/owner/repo/blob/2.1.0/CHANGELOG.md)\n');
 const middle=notesFor(LOG,'2.0.0');
 assert.match(middle,/^# OWLA Butler 2\.0\.0\n\n- Old thing\.\n/);
 assert.doesNotMatch(middle,/New thing|First/);
});
test('a version without a section fails instead of publishing the whole log',()=>{
 assert.throws(()=>notesFor(LOG,'2.0'));
 assert.throws(()=>notesFor(LOG,'9.9.9'));
});
test('the shipped release log has a section for the current manifest version',()=>{
 const version=JSON.parse(readFileSync(join(__dirname,'..','manifest.json'),'utf8')).version;
 const notes=notesFor(readFileSync(join(__dirname,'..','RELEASE-NOTES.md'),'utf8'),version);
 assert.equal(notes.match(/^# /gm)?.length,1);
});
