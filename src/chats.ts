import {record,list} from './validation';
import {mkdirSync,writeFileSync,readdirSync,readFileSync,renameSync,unlinkSync,statSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
type SavedMessage={role:'user'|'assistant';content:string;sourcePath?:string};
export type SavedChat={id:string;title:string;created:string;messages:SavedMessage[]};
export class ChatStore{
 constructor(private root:string){}
 private folder(){return join(this.root,'saved-chats');}
 list():SavedChat[]{
  let files:string[];try{files=readdirSync(this.folder());}catch(e){if(record(e).code==='ENOENT')return [];throw e;}
  const chats:SavedChat[]=[];
  for(const file of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){try{
   const path=join(this.folder(),file);if(statSync(path).size>100000)continue;
   const data=record(JSON.parse(readFileSync(path,'utf8')));const {id,title,created}=data;
   if(typeof id!=='string'||id+'.json'!==file||typeof title!=='string'||typeof created!=='string'||!Array.isArray(data.messages))continue;
   const raw=list(data.messages);if(raw.length>6)continue;
   const messages:SavedChat['messages']=[];
   for(const value of raw){const {role,content,sourcePath}=record(value);
    if((role==='user'||role==='assistant')&&typeof content==='string'&&content.length<=6000){
     messages.push({role,content,...(role==='assistant'&&typeof sourcePath==='string'&&sourcePath.length<=1024?{sourcePath}:{})});
    }}
   if(messages.length===raw.length)chats.push({id,title,created,messages});
  }catch{/* Ignore malformed or unavailable saved chats without blocking the rest. */}}
  return chats.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,20);
 }
 save(title:string,messages:{role:string;content:string;sourcePath?:string}[]):SavedChat{
 const chat:SavedChat={id:randomUUID(),title:title.trim().replace(/\p{Cc}/gu,' ').slice(0,80)||'Untitled chat',created:new Date().toISOString(),messages:messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-6).map(m=>({role:m.role as 'user'|'assistant',content:m.content.slice(0,6000),...(m.role==='assistant'&&m.sourcePath&&m.sourcePath.length<=1024?{sourcePath:m.sourcePath}:{})}))};
 if(this.list().length>=20)throw Error('You have 20 saved chats. Delete an unwanted saved chat before saving another.');
 if(!chat.messages.length)throw Error('Send a message before saving this chat.');mkdirSync(this.folder(),{recursive:true,mode:0o700});const target=join(this.folder(),chat.id+'.json'),temp=target+'.tmp';try{writeFileSync(temp,JSON.stringify(chat),{mode:0o600,flag:'wx'});renameSync(temp,target);}finally{try{unlinkSync(temp);}catch{/* Already renamed or no temporary file was created. */}}
 return chat;
 }
 remove(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid saved chat.');unlinkSync(join(this.folder(),id+'.json'));}
}
