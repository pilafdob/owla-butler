// A stand-in for `codex` used by tests/codex.test.ts. It never contacts a
// model. Usage: node fake-codex.mjs <scenario-dir> <codex arguments...>
//
// <scenario-dir>/scenario.json:
//   {"defaults": {...features}, "pinned": {...features}, "version": "codex-cli 0.169.0"}
// `defaults` are the features `config/read` reports before any `-c` override,
// `-c features.<key>=<true|false>` arguments are applied in order (the last one
// wins, as in Codex 0.169.0), and `pinned` is applied last, like a managed
// settings layer that outranks `-c`. Each app-server start appends its argv to
// <scenario-dir>/spawns.jsonl.
import {appendFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

const [dir,...args]=process.argv.slice(2);
const scenario=()=>JSON.parse(readFileSync(join(dir,'scenario.json'),'utf8'));
if(args[0]==='--version'){
 console.log(scenario().version??'codex-cli 0.169.0');
 process.exit(0);
}
appendFileSync(join(dir,'spawns.jsonl'),JSON.stringify(args)+'\n');

const overrides=[];
for(let i=0;i<args.length;i++)if(args[i]==='-c')overrides.push(args[++i]);
const web=overrides.includes('web_search="live"')?'live':'disabled';

function config(){
 const {defaults={},pinned={}}=scenario();
 const features={...defaults};
 for(const entry of overrides){
  const match=/^features\.([^=]+)=(true|false)$/.exec(entry);
  if(match)features[match[1]]=match[2]==='true';
 }
 Object.assign(features,pinned);
 return {
  notify:[],hooks:null,sandbox_mode:'read-only',approval_policy:'never',web_search:web,
  mcp_servers:{},plugins:{},features,
  analytics:{enabled:false},feedback:{enabled:false},
  otel:{exporter:'none',trace_exporter:'none',metrics_exporter:'none'},
 };
}

const results={
 'initialize':()=>({}),
 'config/read':()=>({config:config()}),
 'account/read':()=>({account:{type:'chatgpt',planType:'plus'}}),
 'model/list':()=>({data:[{id:'fake',model:'fake',displayName:'Fake',defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:''}]}],nextCursor:null}),
 'account/rateLimits/read':()=>({rateLimits:null}),
};

let buffer='';
process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 buffer+=chunk;
 let index;
 while((index=buffer.indexOf('\n'))>=0){
  const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
  if(!line.trim())continue;
  const message=JSON.parse(line);
  if(message.id===undefined)continue;
  const result=results[message.method];
  process.stdout.write(JSON.stringify(result?{id:message.id,result:result()}:{id:message.id,error:{code:-32601,message:'not supported by fake codex'}})+'\n');
 }
});
process.stdin.on('end',()=>process.exit(0));
