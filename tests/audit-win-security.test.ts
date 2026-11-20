// Windows hardening pass (round 2), win-security agent: regressions that run
// on a real Windows host without Developer Mode — junctions and hard links
// instead of file symlinks, case-folded NTFS spellings, loopback binding and
// the per-vault private home. POSIX behaviour is asserted unchanged where the
// same code path is shared (platform is a parameter).
import {test} from 'node:test';import assert from 'node:assert/strict';
import {existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {HermesBridge,hermesInheritedInstructions,hermesMirrorExcluded,hermesUserHome} from '../src/hermes';

const isWin=process.platform==='win32';
type HomeHarness={sessionCwd:string;privateHomePath():string;ensurePrivateHome(executable:string,web:boolean,endpoint?:{url:string;token:string},realHome?:string):void};
type McpHarness={ensureCallback():Promise<void>;setToolSpecs(tools:{type:'function';name:string;description:string;inputSchema:unknown}[]):void;callbackPort:number;mcpToken:string;toolHandler:((name:string,args:unknown)=>Promise<unknown>)|null;callback:import('node:http').Server|null};
const dirLink=(target:string,path:string)=>symlinkSync(target,path,isWin?'junction':undefined);

// NTFS resolves case aliases to one directory: two spellings of one vault's
// session cwd must land in ONE physical private home (no split state), while
// two vaults never share one (M1).
test('case-fold aliases of one vault share one physical private home; two vaults never do',{skip:isWin?false:'NTFS case folding'},()=>{
 const scratch=realpathSync(mkdtempSync(join(tmpdir(),'owla-win-casefold-')));
 try{
  const session=join(scratch,'storage','vaults','AbC','hermes-session');
  const alias=join(scratch,'storage','vaults','aBc','hermes-session');
  const other=join(scratch,'storage','vaults','xyz','hermes-session');
  const a=new HermesBridge() as unknown as HomeHarness;a.sessionCwd=session;
  const b=new HermesBridge() as unknown as HomeHarness;b.sessionCwd=alias;
  const c=new HermesBridge() as unknown as HomeHarness;c.sessionCwd=other;
  const homeA=a.privateHomePath(),homeB=b.privateHomePath(),homeC=c.privateHomePath();
  mkdirSync(homeA,{recursive:true});mkdirSync(homeC,{recursive:true});
  assert.equal(realpathSync.native(homeA),realpathSync.native(homeB),'case aliases are one directory on NTFS');
  assert.equal(lstatSync(homeA).ino,lstatSync(homeB).ino);
  assert.notEqual(realpathSync.native(homeA),realpathSync.native(homeC),'different vaults stay apart');
  // Writing through both spellings reaches the same files, and the reconnect
  // gate sees one home, not two competing copies.
  const realHome=join(scratch,'real');mkdirSync(realHome,{recursive:true});
  a.ensurePrivateHome('',false,{url:'http://127.0.0.1:9/mcp',token:'tok'},realHome);
  b.ensurePrivateHome('',false,{url:'http://127.0.0.1:9/mcp',token:'tok'},realHome);
  assert.ok(readFileSync(join(homeB,'config.yaml'),'utf8').includes('Bearer tok'));
  assert.equal(lstatSync(join(homeA,'config.yaml')).ino,lstatSync(join(homeB,'config.yaml')).ino);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// The exclusion fold is what makes a differently-spelled user config the SAME
// excluded file on NTFS: it must never be mirrored, in any spelling.
test('a case-variant user config is excluded and never mirrored',()=>{
 const scratch=mkdtempSync(join(tmpdir(),'owla-win-configcase-'));
 try{
  const realHome=join(scratch,'real');mkdirSync(realHome,{recursive:true});
  // On NTFS this IS config.yaml; on POSIX it is a distinct file — both spellings
  // are excluded by the fold, so neither platform mirrors it.
  writeFileSync(join(realHome,'Config.yaml'),'model:\n  api_key: "must-not-leak"\n');
  assert.equal(hermesMirrorExcluded('Config.yaml'),true);
  const session=join(scratch,'storage','vaults','v','hermes-session');
  const home=join(scratch,'storage','vaults','v','hermes-private');
  const bridge=new HermesBridge() as unknown as HomeHarness;bridge.sessionCwd=session;
  bridge.ensurePrivateHome('',false,{url:'http://127.0.0.1:9/mcp',token:'tok'},realHome);
  const config=readFileSync(join(home,'config.yaml'),'utf8');
  assert.ok(!config.includes('must-not-leak'));
  assert.ok(config.includes('Bearer tok'));
  assert.equal(lstatSync(join(home,'config.yaml')).isSymbolicLink(),false,'OWLA writes its own config, never a link');
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// The credential vault (agent/vault_store.py: encrypted autofill secrets plus
// the local Fernet key file) exists in Windows homes and must never be
// mirrored — not even through a junction an earlier build left behind.
test('the Hermes credential vault is never mirrored, in any spelling',()=>{
 const scratch=mkdtempSync(join(tmpdir(),'owla-win-vault-'));
 try{
  const realHome=join(scratch,'real');
  mkdirSync(join(realHome,'vault'),{recursive:true});
  writeFileSync(join(realHome,'vault','vault.key'),'fake-key-material');
  writeFileSync(join(realHome,'vault','items.enc'),'fake-encrypted-items');
  const session=join(scratch,'storage','vaults','v','hermes-session');
  const home=join(scratch,'storage','vaults','v','hermes-private');
  mkdirSync(home,{recursive:true});
  // An old-build mirror junction and a case-variant stale copy.
  dirLink(join(realHome,'vault'),join(home,'vault'));
  const bridge=new HermesBridge() as unknown as HomeHarness;bridge.sessionCwd=session;
  bridge.ensurePrivateHome('',false,undefined,realHome);
  assert.throws(()=>lstatSync(join(home,'vault')),'the vault link must be removed');
  assert.equal(readFileSync(join(realHome,'vault','vault.key'),'utf8'),'fake-key-material');
  assert.equal(readFileSync(join(realHome,'vault','items.enc'),'utf8'),'fake-encrypted-items');
  // A second pass with a planted hard-linked vault file stays clean too.
  assert.equal(existsSync(join(home,'Vault')),false);
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// The loopback MCP endpoint must bind the IPv4 loopback only: no firewall
// prompt surface (a non-loopback bind triggers one on Windows), no LAN reach.
// The config URL names 127.0.0.1 literally because `localhost` may resolve to
// ::1 first on Windows while the server is IPv4-only.
test('the MCP callback binds 127.0.0.1 only and refuses a wrong token',async()=>{
 const bridge=new HermesBridge(),mcp=bridge as unknown as McpHarness;
 mcp.setToolSpecs([]);
 await mcp.ensureCallback();
 try{
  const address=mcp.callback!.address();
  assert.equal(typeof address==='object'&&address?address.address:null,'127.0.0.1');
  assert.equal(typeof address==='object'&&address?address.family:null,'IPv4');
  assert.ok(mcp.callbackPort>0);
  const url='http://127.0.0.1:'+mcp.callbackPort+'/mcp';
  const ok=await fetch(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+mcp.mcpToken},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})});
  assert.equal(ok.status,200);
  // Wrong length and wrong value are both refused before any dispatch.
  for(const token of [mcp.mcpToken+'x',mcp.mcpToken.slice(0,-1),'x'.repeat(mcp.mcpToken.length)]){
   const bad=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token},body:'{}'});
   assert.equal(bad.status,401);
  }
  assert.equal((await fetch('http://127.0.0.1:'+mcp.callbackPort+'/other')).status,404);
 }finally{bridge.disconnect();}
});

// A tool that finishes after disconnect must never deliver its result: the
// held connection is ended and the generation guard refuses the late answer.
test('a tool result finishing after disconnect is not delivered',async()=>{
 const bridge=new HermesBridge(),mcp=bridge as unknown as McpHarness;
 mcp.setToolSpecs([{type:'function',name:'read_note',description:'',inputSchema:{type:'object'}}]);
 let release:()=>void=()=>{};
 const gate=new Promise<void>(resolve=>{release=resolve;});
 mcp.toolHandler=async()=>{await gate;return 'late result';};
 await mcp.ensureCallback();
 const url='http://127.0.0.1:'+mcp.callbackPort+'/mcp';
 const pending=fetch(url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+mcp.mcpToken},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_note',arguments:{}}})});
 // Let the request reach the handler, then disconnect while it is in flight.
 await new Promise(resolve=>setTimeout(resolve,50));
 bridge.disconnect();
 release();
 const outcome=await pending.then(response=>response.json(),()=>null);
 assert.ok(outcome===null||outcome.error,'a late result must not arrive as a success: '+JSON.stringify(outcome));
});

// The 32 MiB body cap counts UTF-8 bytes and fails closed with 413.
test('an oversize MCP body is refused with 413',{timeout:30000},async()=>{
 const bridge=new HermesBridge(),mcp=bridge as unknown as McpHarness;
 mcp.setToolSpecs([]);
 await mcp.ensureCallback();
 try{
  // Multi-byte characters: 17M × 2 bytes > 32 MiB while the UTF-16 length is
  // only 17M — the cap must count bytes, not code units.
  const body='{"jsonrpc":"2.0","id":1,"method":"initialize","pad":"'+'é'.repeat(17*1024*1024)+'"}';
  const response=await fetch('http://127.0.0.1:'+mcp.callbackPort+'/mcp',{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+mcp.mcpToken},body});
  assert.equal(response.status,413);
 }finally{bridge.disconnect();}
});

// The home exemption folds case on Windows: a home spelled in another case
// still stops the walk, and the user's own files at home stay exempt.
test('the instruction walk home exemption is case-folded on Windows',()=>{
 const scratch=realpathSync(mkdtempSync(join(tmpdir(),'owla-win-homecase-')));
 try{
  const home=join(scratch,'home'),session=join(home,'repo','session');
  mkdirSync(session,{recursive:true});
  writeFileSync(join(home,'AGENTS.md'),'the user own global file');
  writeFileSync(join(home,'repo','CLAUDE.md'),'repo instructions');
  const upper=join(scratch,'HOME');
  const found=hermesInheritedInstructions(session,upper,'win32');
  assert.ok(found.some(file=>file.toLowerCase().endsWith('claude.md')),JSON.stringify(found));
  assert.ok(!found.some(file=>file.toLowerCase().endsWith(join('home','agents.md').toLowerCase())),JSON.stringify(found));
 }finally{rmSync(scratch,{recursive:true,force:true});}
});

// The real Hermes home on Windows is %LOCALAPPDATA%\hermes — the mirror and
// the bin search must look there, not at a ~/.hermes the CLI never uses.
test('the Windows Hermes home and bin directory follow the CLI platform default',()=>{
 const home=hermesUserHome('win32','C:\\Users\\me',{LOCALAPPDATA:'C:\\Users\\me\\AppData\\Local'});
 assert.equal(home,'C:\\Users\\me\\AppData\\Local\\hermes');
 assert.ok(!home.includes('.hermes'),'the POSIX spelling is not the Windows home');
});
