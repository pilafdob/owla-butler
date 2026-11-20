// OCR platform gates (src/ocr.ts): Windows and Linux skip OCR cleanly — no
// compiler probe, no filesystem writes, the caller still returns the picture —
// while macOS keeps its cached-binary path. Host-neutral: the darwin cases use
// a pre-placed cached binary, so no Swift compiler is invoked on any host and
// no Xcode dialog can appear. The macOS Vision helper source is pinned intact.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ocrSupported,ensureOcrBinary,ocrImageDataUrl,ocrSection,ocrSwiftSourceForTests} from '../src/ocr';

let scratch:string;
before(()=>{scratch=mkdtempSync(join(tmpdir(),'owla-win-ocr-'));});
after(()=>{if(scratch)rmSync(scratch,{recursive:true,force:true});});

const {source,version}=ocrSwiftSourceForTests();

test('the macOS Vision helper is intact (source and version pinned)',()=>{
 assert.ok(source.includes('import Vision'));
 assert.ok(source.includes('VNRecognizeTextRequest'));
 assert.ok(source.includes('recognitionLevel = .accurate'));
 assert.ok(source.includes('usesLanguageCorrection = true'));
 assert.equal(version,'1');
});

test('the OCR section is omitted when OCR is unavailable (Windows tool results)',()=>{
 assert.equal(ocrSection(null),'');
 assert.equal(ocrSection(''),'');
});

for(const platform of ['darwin','win32','linux'] as const){
 test(`OCR is offered only on darwin (platform=${platform})`,()=>{
  assert.equal(ocrSupported(platform),platform==='darwin');
 });

 test(`ensureOcrBinary honours the platform gate even with a cached binary present (${platform})`,async()=>{
  const dir=join(scratch,'cached-'+platform);
  mkdirSync(join(dir,'ocr'),{recursive:true});
  const binary=join(dir,'ocr','owla-ocr-'+version);
  writeFileSync(binary,'');
  // darwin returns the cached binary without compiling; other platforms refuse
  // it before ever looking at the cache, so a macOS binary can never run there.
  assert.equal(await ensureOcrBinary(dir,platform),platform==='darwin'?binary:null);
 });

 if(platform!=='darwin'){
  test(`a non-macOS platform never writes OCR files or probes a compiler (${platform})`,async()=>{
   const dir=join(scratch,'fresh-'+platform);
   assert.equal(await ensureOcrBinary(dir,platform),null);
   assert.equal(await ocrImageDataUrl('data:image/png;base64,AAAA',dir,'en-US',platform),null);
   assert.equal(existsSync(join(dir,'ocr')),false,'no OCR directory is created on '+platform);
   assert.equal(existsSync(dir),false,'the storage dir is not touched on '+platform);
  });
 }
}