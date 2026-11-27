// Composer slash commands: the registry, the typed token, matching and insertion.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {BUILTIN_SLASH_COMMANDS,SlashRegistry,applySlashCommand,matchSlashCommands,slashActiveIndex,slashQueryAt,type SlashCommand,type SlashContext} from '../src/slash-commands';

const ready:SlashContext={hasNote:true,hasImage:false,hasPdf:false,hasAttachment:false,readsImages:true,webSearch:true,canvas:true,bases:true,excalidraw:true,busy:false,awaitingReview:false,hasHistory:true,canUndo:true};
const registry=new SlashRegistry(BUILTIN_SLASH_COMMANDS);
const ids=(query:string,context=ready)=>matchSlashCommands(query,registry.all(),context).map(match=>match.command.id);
const reason=(id:string,context:SlashContext)=>registry.get(id)?.unavailable?.(context)??null;

test('every approved command is registered once, with a valid id',()=>{
 assert.deepEqual(registry.all().map(command=>command.id),[
  'image-to-md','pdf-page-to-md','table-to-md','summarize','format','mermaid','math','properties','links','organize',
  'export-pdf','canvas','base','excalidraw','web','new','save','open','undo','model',
 ]);
 for(const command of registry.all())if(command.kind==='prompt')assert.ok(command.prompt?.trim(),command.id+' has a prompt');
});

test('the registry accepts new commands and refuses bad or duplicate ids',()=>{
 const extra=new SlashRegistry(BUILTIN_SLASH_COMMANDS);
 extra.register({id:'translate',title:'Translate',description:'Translate the note',kind:'prompt',prompt:'Translate the current note.'});
 assert.equal(extra.get('translate')?.title,'Translate');
 assert.equal(registry.get('translate'),undefined,'registries do not share commands');
 assert.throws(()=>extra.register({id:'translate',title:'x',description:'x',kind:'action'}),/already exists/);
 assert.throws(()=>extra.register({id:'Image To MD',title:'x',description:'x',kind:'action'}),/lowercase words/);
 assert.throws(()=>extra.register({id:'empty',title:'x',description:'x',kind:'prompt',prompt:' '}),/needs a prompt/);
});

test('a slash token opens only at the start or after whitespace, and paths and // stay text',()=>{
 assert.deepEqual(slashQueryAt('/img',4),{start:0,end:4,query:'img'});
 assert.deepEqual(slashQueryAt('hello /Ima',10),{start:6,end:10,query:'ima'});
 assert.deepEqual(slashQueryAt('/',1),{start:0,end:1,query:''});
 assert.deepEqual(slashQueryAt('/imgtail rest',4),{start:0,end:8,query:'img'},'the token runs to the next whitespace');
 assert.equal(slashQueryAt('and/or',6),null,'a slash inside a word is not a command');
 assert.equal(slashQueryAt('/Users/me',9),null,'a path is not a command');
 assert.equal(slashQueryAt('//literal',9),null,'a double slash is text');
 assert.equal(slashQueryAt('/img more',9),null,'the caret has left the token');
});

test('matching ranks exact and prefix ids first and finds keywords and fuzzy spellings',()=>{
 assert.equal(ids('image-to-md')[0],'image-to-md');
 assert.equal(ids('img')[0],'image-to-md','a subsequence finds it');
 assert.equal(ids('ocr')[0],'image-to-md','keywords match');
 assert.equal(ids('image to md')[0],'image-to-md','spaces count as hyphens');
 assert.equal(ids('und')[0],'undo');
 assert.deepEqual(ids('zzzz'),[]);
 assert.equal(ids('').length,registry.all().length,'an empty query lists everything');
});

test('commands that cannot run stay listed, after the ones that can, with their reason',()=>{
 const textOnly={...ready,readsImages:false,canvas:false,webSearch:false,hasPdf:false};
 const listed=matchSlashCommands('',registry.all(),textOnly);
 const first=listed.findIndex(match=>match.reason);
 assert.ok(first>0);
 assert.ok(listed.slice(first).every(match=>match.reason),'unavailable commands come last');
 assert.match(reason('image-to-md',textOnly)!,/cannot read images/);
 assert.match(reason('pdf-page-to-md',textOnly)!,/Attach a PDF/);
 assert.match(reason('canvas',textOnly)!,/Plugin Interconnectivity/);
 assert.match(reason('web',textOnly)!,/Web search is off/);
 assert.equal(reason('pdf-page-to-md',{...ready,hasPdf:true}),null);
 assert.match(reason('format',{...ready,hasNote:false})!,/Open a note/);
 assert.equal(reason('summarize',{...ready,hasNote:false,hasAttachment:true}),null);
 assert.match(reason('undo',{...ready,canUndo:false})!,/No accepted edit/);
 assert.match(reason('undo',{...ready,awaitingReview:true})!,/pending changes/);
 assert.match(reason('save',{...ready,hasHistory:false})!,/Send a message/);
 assert.match(reason('save',{...ready,busy:true})!,/Wait for the reply/);
 assert.match(reason('new',{...ready,awaitingReview:true})!,/pending changes/);
});

test('a command typed in full comes first and is highlighted even when it cannot run',()=>{
 const empty={...ready,hasHistory:false,canUndo:false};
 // /open matches "save" through its keyword "saved" and can run; /save cannot run before the first message.
 const saveMatches=matchSlashCommands('save',registry.all(),empty);
 assert.deepEqual(saveMatches.map(match=>match.command.id).slice(0,2),['save','open']);
 assert.equal(saveMatches[0].exact,true);
 assert.match(saveMatches[0].reason!,/Send a message/);
 assert.equal(slashActiveIndex(saveMatches),0,'Enter shows the reason for /save instead of running /open');
 const textOnly={...ready,readsImages:false};
 const imageMatches=matchSlashCommands('image-to-md',registry.all(),textOnly);
 assert.equal(imageMatches[0].command.id,'image-to-md');
 assert.equal(slashActiveIndex(imageMatches),0);
 // A partial query still prefers a command that can run.
 const partial=matchSlashCommands('sav',registry.all(),empty);
 assert.equal(partial[slashActiveIndex(partial)].command.id,'open');
 assert.ok(partial.every(match=>!match.exact));
 // Only unavailable matches: the first is highlighted, as before.
 const pdf=matchSlashCommands('pdf-page',registry.all(),ready);
 assert.equal(pdf[slashActiveIndex(pdf)].command.id,'pdf-page-to-md');
});

test('a prompt command replaces its token with the prompt and keeps the rest of the draft',()=>{
 const command=registry.get('image-to-md')!;
 const draft='Please /img';
 const result=applySlashCommand(draft,slashQueryAt(draft,draft.length)!,command);
 assert.equal(result.text,'Please '+command.prompt);
 assert.equal(result.caret,result.text.length);
 const web=registry.get('web')!;
 const mid=applySlashCommand('/we tariffs 2026',{start:0,end:3},web);
 assert.equal(mid.text,'Check this on the web and cite the sources: tariffs 2026');
 assert.equal(mid.caret,web.prompt!.length,'the caret sits after the inserted prompt');
});

test('an action command removes its token and leaves the rest of the draft',()=>{
 const action:SlashCommand=registry.get('new')!;
 assert.deepEqual(applySlashCommand('/new',{start:0,end:4},action),{text:'',caret:0});
 assert.equal(applySlashCommand('keep this /new and that',{start:10,end:14},action).text,'keep this and that');
});
