import {mkdirSync,writeFileSync,readdirSync,readFileSync,renameSync,unlinkSync,statSync} from 'node:fs';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
export type SavedChat={id:string;title:string;created:string;messages:{role:'user'|'assistant';content:string}[]};
export class ChatStore{
 constructor(private root:string){}
 private folder(){return join(this.root,'saved-chats');}
 list():SavedChat[]{let files:string[];try{files=readdirSync(this.folder());}catch(e:any){if(e.code==='ENOENT')return [];throw e;}
 const chats:SavedChat[]=[];for(const file of files.filter(f=>/^[a-f0-9-]{36}\.json$/.test(f))){try{const p=join(this.folder(),file);if(statSync(p).size>100000)continue;const d=JSON.parse(readFileSync(p,'utf8'));if(d.id+'.json'!==file||typeof d.title!=='string'||typeof d.created!=='string'||!Array.isArray(d.messages)||d.messages.length>6)continue;if(!d.messages.every((m:any)=>['user','assistant'].includes(m.role)&&typeof m.content==='string'&&m.content.length<=6000))continue;chats.push({...d,messages:d.messages.map((m:any)=>({role:m.role,content:m.content}))});}catch{}}
 return chats.sort((a,b)=>b.created.localeCompare(a.created)).slice(0,20);
 }
 save(title:string,messages:{role:string;content:string}[]):SavedChat{
 const chat:SavedChat={id:randomUUID(),title:title.trim().replace(/[\r\n\x00-\x1f]/g,' ').slice(0,80)||'Untitled chat',created:new Date().toISOString(),messages:messages.filter(m=>m.role==='user'||m.role==='assistant').slice(-6).map(m=>({role:m.role as 'user'|'assistant',content:m.content.slice(0,6000)}))};
 if(this.list().length>=20)throw Error('You have 20 saved chats. Delete an unwanted saved chat before saving another.');
 if(!chat.messages.length)throw Error('Send a message before saving this chat.');mkdirSync(this.folder(),{recursive:true,mode:0o700});const target=join(this.folder(),chat.id+'.json'),temp=target+'.tmp';try{writeFileSync(temp,JSON.stringify(chat),{mode:0o600,flag:'wx'});renameSync(temp,target);}finally{try{unlinkSync(temp);}catch{}}
 return chat;
 }
 remove(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Invalid saved chat.');unlinkSync(join(this.folder(),id+'.json'));}
}
