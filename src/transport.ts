import { request as http } from 'node:http';
import { request as https } from 'node:https';
import { endpoint } from './core';
export async function localRequest(base:string,path:string,body:unknown|undefined,signal?:AbortSignal,onLine?:(line:string)=>void):Promise<any> {
 const target=new URL(endpoint(base)+path);
 const payload=body===undefined?undefined:JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  let result='',buffer='';
  const req=(target.protocol==='https:'?https:http)(target,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(payload===undefined?{}:{'Content-Length':Buffer.byteLength(payload)})},signal},res=>{
   if((res.statusCode??500)>=400){res.setEncoding('utf8');res.on('data',d=>result+=d);res.on('end',()=>reject(Error(`Local model returned ${res.statusCode}: ${result.slice(0,500)}`)));return;}
   res.setEncoding('utf8');res.on('data',(chunk:string)=>{
    if(onLine){buffer+=chunk;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);if(line){try{onLine(line);}catch(e){req.destroy(e as Error);}}}}
    else {result+=chunk;if(result.length>8_000_000)req.destroy(Error('The local response exceeded the size limit.'));}
   });
   res.on('error',reject);res.on('end',()=>{try{if(onLine){if(buffer.trim())onLine(buffer.trim());resolve(null);}else resolve(result?JSON.parse(result):{});}catch(e){reject(e);}});
  });
  req.setTimeout(90_000,()=>req.destroy(Error('The model took too long. Try a shorter note or smaller image.')));
  req.on('error',reject);if(payload!==undefined)req.write(payload);req.end();
 });
}
