/**
 * Handwriting OCR for rendered Canvas/Excalidraw pictures, using macOS's own
 * Vision framework (VNRecognizeTextRequest). A drawing of handwritten strokes
 * has no text elements, so a text-only model cannot read it from the element
 * dump; the rendered PNG plus this OCR gives it the written content as text.
 *
 * The helper is a tiny Swift program compiled ONCE to a cached binary in OWLA's
 * storage (swiftc is part of the Xcode command line tools). Each later call is
 * sub-second. Everything is best-effort: on a non-macOS host, a missing
 * compiler, or any OCR failure the caller simply omits the OCR text and still
 * returns the picture, so a vision-capable model can read it natively.
 */
import {execFile} from 'node:child_process';
import {existsSync,mkdirSync,renameSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {record,list} from './validation';

const SWIFT_SOURCE=`import Vision
import AppKit
import Foundation
let args = CommandLine.arguments
guard args.count >= 2 else { print("{\\"error\\":\\"usage\\"}"); exit(1) }
let langs = args.count >= 3 ? args[2].split(separator: ",").map(String.init) : ["en-US", "de-DE"]
guard let image = NSImage(contentsOfFile: args[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("{\\"error\\":\\"load\\"}"); exit(1)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = langs
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do { try handler.perform([request]) } catch {
    print("{\\"error\\":\\"perform\\"}"); exit(1)
}
var lines: [[String: Any]] = []
for obs in (request.results ?? []) {
    if let cand = obs.topCandidates(1).first {
        let bb = obs.boundingBox
        lines.append(["text": cand.string, "confidence": cand.confidence,
                      "x": bb.origin.x, "y": bb.origin.y])
    }
}
let data = try JSONSerialization.data(withJSONObject: ["lines": lines])
print(String(data: data, encoding: .utf8) ?? "{\\"lines\\":[]}")
`;
/** Bumped whenever SWIFT_SOURCE changes so the cached binary is rebuilt. */
const OCR_VERSION='1';

/** OCR can only run on macOS, where the Vision framework exists. */
export const ocrSupported=(platform=process.platform)=>platform==='darwin';

function exec(file:string,args:string[],timeout:number):Promise<string>{
 return new Promise((resolve,reject)=>{
  execFile(file,args,{timeout,maxBuffer:8*1024*1024,shell:false},(error,stdout)=>{
   if(error)reject(error instanceof Error?error:Error(String(error)));else resolve(stdout);
  });
 });
}

/**
 * The cached OCR binary, compiled on first use. Returns null when OCR is
 * unavailable or compilation fails; the caller then skips OCR text.
 */
export function ensureOcrBinary(storageDir:string,platform=process.platform):Promise<string|null>{
 if(!ocrSupported(platform))return Promise.resolve(null);
 const binary=join(storageDir,'ocr','owla-ocr-'+OCR_VERSION);
 if(existsSync(binary))return Promise.resolve(binary);
 // One build per binary path: parallel visual reads share it, and a failed
 // build is not retried (and its timeout not paid again) until Obsidian reloads.
 let build=ocrBuilds.get(binary);
 if(!build){build=buildOcrBinary(storageDir,binary);ocrBuilds.set(binary,build);}
 return build;
}
const ocrBuilds=new Map<string,Promise<string|null>>();

/**
 * `/usr/bin/swiftc`, once Xcode or its command line tools are installed; null
 * otherwise. That path is only a shim that exists on every Mac: running it
 * without the tools opens the system's "install command line tools" dialog.
 * `xcode-select -p` never prompts, so it decides first whether a compiler is
 * there. The shim is still what runs, because it supplies the SDK the bare
 * developer-folder compiler cannot find on its own.
 */
async function swiftCompiler():Promise<string|null>{
 try{
  const developer=(await exec('/usr/bin/xcode-select',['-p'],10_000)).trim();
  return developer&&existsSync(join(developer,'usr','bin','swiftc'))&&existsSync('/usr/bin/swiftc')?'/usr/bin/swiftc':null;
 }catch{
  return null;
 }
}

async function buildOcrBinary(storageDir:string,binary:string):Promise<string|null>{
 const swiftc=await swiftCompiler();
 if(!swiftc)return null;
 const dir=join(storageDir,'ocr');
 // Build under a temporary name and rename when done, so a killed or failed
 // build never leaves a truncated binary that existsSync would accept forever.
 const partial=binary+'.partial-'+randomBytes(4).toString('hex');
 try{
  mkdirSync(dir,{recursive:true,mode:0o700});
  const source=join(dir,'owla-ocr-'+OCR_VERSION+'.swift');
  writeFileSync(source,SWIFT_SOURCE,{mode:0o600});
  await exec(swiftc,['-O',source,'-o',partial],120_000);
  if(!existsSync(partial))return null;
  renameSync(partial,binary);
  return binary;
 }catch{
  return null;
 }finally{
  try{if(existsSync(partial))unlinkSync(partial);}catch{/* already gone */}
 }
}

/** Reads recognized text from a PNG file, in reading order (top→bottom, left→right). */
export async function ocrImageFile(binary:string,imagePath:string,langs='en-US,de-DE'):Promise<string|null>{
 try{
  const stdout=await exec(binary,[imagePath,langs],120_000);
  const data=record(JSON.parse(stdout.trim()));
  return formatOcrLines(list(data.lines));
 }catch{
  return null;
 }
}

/**
 * Orders raw Vision observations into reading order and joins their text.
 * Vision's bounding box is normalised with y measured from the BOTTOM, so a
 * larger y is higher on the page: sort top→bottom, then left→right. Pure, so
 * the ordering is unit-tested without running the native helper.
 */
export function formatOcrLines(raw:unknown[]):string|null{
 const lines=raw.map(record).filter(line=>typeof line.text==='string'&&(line.text as string).trim());
 if(!lines.length)return null;
 lines.sort((a,b)=>{
  const ay=typeof a.y==='number'?a.y:0,by=typeof b.y==='number'?b.y:0;
  if(Math.abs(ay-by)>0.02)return by-ay;
  const ax=typeof a.x==='number'?a.x:0,bx=typeof b.x==='number'?b.x:0;
  return ax-bx;
 });
 const text=lines.map(line=>(line.text as string).trim()).join('\n');
 return text||null;
}

/**
 * OCR a PNG data URL (as the Canvas/Excalidraw renderers return). Writes a
 * temporary file, runs the cached binary and removes the file again. Returns
 * the recognized text, or null when OCR is unavailable or finds nothing.
 */
export async function ocrImageDataUrl(dataUrl:string,storageDir:string,langs='en-US,de-DE',platform=process.platform):Promise<string|null>{
 if(!dataUrl.startsWith('data:image/'))return null;
 const binary=await ensureOcrBinary(storageDir,platform);
 if(!binary)return null;
 const base64=dataUrl.slice(dataUrl.indexOf(',')+1);
 let temp='';
 try{
  const dir=join(storageDir,'ocr');mkdirSync(dir,{recursive:true,mode:0o700});
  temp=join(dir,'input-'+randomBytes(6).toString('hex')+'.png');
  writeFileSync(temp,Buffer.from(base64,'base64'),{mode:0o600});
  return await ocrImageFile(binary,temp,langs);
 }catch{
  return null;
 }finally{
  if(temp)try{unlinkSync(temp);}catch{/* already gone */}
 }
}

/** The tool-result section describing OCR text, or '' when there is none. */
export function ocrSection(text:string|null):string{
 if(!text)return '';
 return '\n[Handwriting OCR (macOS Vision, may garble math symbols — verify against the picture):]\n'+text;
}

/** Exposed for tests: the embedded helper source and its version marker. */
export const ocrSwiftSourceForTests=()=>({source:SWIFT_SOURCE,version:OCR_VERSION});
