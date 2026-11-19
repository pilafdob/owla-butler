// Regression tests for the orchestrator's cross-file pass on src/claude.ts
// (3.7.0 RC; failure P3, security M4, providers U2/U3 + the U6 disconnect class).
// Fake Claude CLIs only — no model turn.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ClaudeBridge} from '../src/claude';
import {usageWindows} from '../src/usage';

const FAKE=`
import {createInterface} from 'node:readline';
const mode=process.argv[2];
if(process.argv.includes('--version')){process.stdout.write('2.1.322 (Claude Code)\\n');process.exit(0);}
if(process.argv.includes('auth')){
 if(mode==='bad-auth'){process.stdout.write('this is not json\\n');process.exit(0);}
 process.stdout.write(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})+'\\n');process.exit(0);
}
if(mode==='handshake-die'){process.stderr.write('claude boom: broken settings\\n');process.exit(1);}
for await(const line of createInterface({input:process.stdin})){void line;}
`;

function setup(mode:string){
 const folder=mkdtempSync(join(tmpdir(),'owla-audit-claude-'));
 const fake=join(folder,'fake-claude.mjs'),wrapper=join(folder,'claude');
 writeFileSync(fake,FAKE);
 writeFileSync(wrapper,'#!/bin/sh\nexec "'+process.execPath+'" "'+fake+'" '+mode+' "$@"\n',{mode:0o700});
 return {folder,wrapper,cleanup:()=>rmSync(folder,{recursive:true,force:true})};
}

test('env() strips backend/model/config/telemetry redirectors but keeps the user telemetry choice',{timeout:10000},async()=>{
 const bridge=new ClaudeBridge();
 const injected:Record<string,string>={ANTHROPIC_MODEL:'redirected-model',ANTHROPIC_CUSTOM_HEADERS:'x: y',
  ANTHROPIC_FOUNDRY_WORKSPACE:'w',CLAUDE_CODE_USE_FOUNDRY:'1',CLAUDE_CODE_OAUTH_TOKEN:'tok',
  CLAUDE_CONFIG_DIR:'/tmp/elsewhere',CLAUDE_CODE_ENABLE_TELEMETRY:'1',OTEL_EXPORTER_OTLP_ENDPOINT:'http://otel.test',
  AWS_CONFIG_FILE:'/tmp/aws',AWS_SHARED_CREDENTIALS_FILE:'/tmp/creds',CLOUD_ML_REGION:'us-east1',
  DISABLE_TELEMETRY:'1'};
 const saved:Record<string,string|undefined>={};
 for(const [key,value] of Object.entries(injected)){saved[key]=process.env[key];process.env[key]=value;}
 try{
  const env=(bridge as unknown as {env:()=>NodeJS.ProcessEnv}).env();
  for(const key of Object.keys(injected)){
   if(key==='DISABLE_TELEMETRY')assert.equal(env[key],'1','the user’s own telemetry choice stays');
   else assert.equal(env[key],undefined,key+' must not redirect the confined turn');
  }
  assert.equal(env.DISABLE_ERROR_REPORTING,'1');
  assert.equal(env.DISABLE_AUTOUPDATER,'1');
 }finally{
  for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
 }
});

test('an unreadable auth status fails with an actionable message, not a raw SyntaxError',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,wrapper,cleanup}=setup('bad-auth');
 try{
  const bridge=new ClaudeBridge();
  await assert.rejects(bridge.connect(wrapper,folder),/unreadable sign-in status/);
 }finally{cleanup();}
});

test('a handshake death surfaces the stderr cause',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,wrapper,cleanup}=setup('handshake-die');
 try{
  const bridge=new ClaudeBridge();
  await assert.rejects(bridge.connect(wrapper,folder),/Last error: claude boom: broken settings/);
  assert.equal(bridge.running,false);
 }finally{cleanup();}
});

test('a connect with a different key is refused while one is in flight',{timeout:20000},async()=>{
 if(process.platform==='win32')return;
 const {folder,wrapper,cleanup}=setup('hang');
 const other=setup('hang');
 try{
  const bridge=new ClaudeBridge();
  const first=bridge.connect(wrapper,folder).catch(()=>{});
  await assert.rejects(bridge.connect(other.wrapper,folder),/Wait for the current Claude Code connection/);
  bridge.disconnect();
  await first;
  assert.equal(bridge.running,false);
 }finally{cleanup();other.cleanup();}
});

test('a single-window rate_limit_event keeps the other plan windows',{timeout:10000},async()=>{
 const bridge=new ClaudeBridge() as unknown as {acceptRateLimit:(info:unknown)=>void;usage:import('../src/usage').UsageSnapshot|null};
 const future=Math.floor(Date.now()/1000)+3600;
 bridge.acceptRateLimit({unifiedWindows:{five_hour:{utilization:0.9,resetsAt:future},seven_day:{utilization:0.4,resetsAt:future+86400}}});
 bridge.acceptRateLimit({rateLimitType:'five_hour',utilization:1,status:'rejected',resetsAt:future});
 const rows=usageWindows(bridge.usage);
 const five=rows.find(row=>row.window==='5-hour window');
 const weekly=rows.find(row=>row.window==='Weekly window');
 assert.equal(five?.used,100,'the triggering window updates');
 assert.equal(weekly?.used,40,'the unreported weekly window must survive the partial event');
});

test('disconnect clears the sign-in state',{timeout:10000},async()=>{
 const bridge=new ClaudeBridge();
 (bridge as unknown as {accountType:string}).accountType='claude.ai';
 bridge.disconnect();
 assert.equal(bridge.needsSignIn,true);
 assert.deepEqual(bridge.models,[]);
});