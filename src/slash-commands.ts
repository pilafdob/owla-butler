/**
 * Slash commands for the composer.
 *
 * A command is either an `action`, which OWLA runs itself without the model
 * (new chat, save chat, undo…), or a `prompt`, which inserts a prepared request
 * into the composer for the user to edit and send. Nothing here sends a message.
 *
 * The list is a registry so further commands can be added in one place: give a
 * command an id, a title, a description, a kind and, if it depends on the
 * situation, an `unavailable` check that returns the reason it cannot run now.
 * A command that cannot run is still listed, greyed out with that reason.
 */

export type SlashKind='action'|'prompt';

/** What the composer knows when the list opens. Every field is a plain fact. */
export interface SlashContext{
 /** A Markdown note is open (or was the last one focused). */
 hasNote:boolean;
 /** An image is attached to the draft. */
 hasImage:boolean;
 /** A whole PDF or a PDF page or selection is attached to the draft. */
 hasPdf:boolean;
 /** Anything at all is attached: notes, folders, files, selections. */
 hasAttachment:boolean;
 /** The model that would answer can read images (unknown counts as yes). */
 readsImages:boolean;
 /** Web search is on and the provider can use it. */
 webSearch:boolean;
 canvas:boolean;
 bases:boolean;
 excalidraw:boolean;
 /** A reply is running. */
 busy:boolean;
 /** Proposed changes wait for Accept or Decline. */
 awaitingReview:boolean;
 /** The chat has at least one exchange. */
 hasHistory:boolean;
 /** An accepted edit in this chat can be undone. */
 canUndo:boolean;
}

export interface SlashCommand{
 /** Typed after the slash: lowercase words joined by hyphens. */
 id:string;
 title:string;
 description:string;
 kind:SlashKind;
 /** The request a prompt command inserts. */
 prompt?:string;
 /** Other words the search should match. */
 keywords?:readonly string[];
 /** Why the command cannot run now, or null when it can. */
 unavailable?:(context:SlashContext)=>string|null;
 /** A prompt that works on an image opens the file picker when no image is attached. */
 opensPicker?:'image';
}

const ID=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SlashRegistry{
 private readonly items=new Map<string,SlashCommand>();
 constructor(commands:readonly SlashCommand[]=[]){for(const command of commands)this.register(command);}
 register(command:SlashCommand):void{
  if(!ID.test(command.id))throw Error('Slash command ids are lowercase words joined by hyphens: '+command.id);
  if(this.items.has(command.id))throw Error('A slash command with this id already exists: '+command.id);
  if(command.kind==='prompt'&&!command.prompt?.trim())throw Error('A prompt command needs a prompt: '+command.id);
  this.items.set(command.id,command);
 }
 get(id:string):SlashCommand|undefined{return this.items.get(id);}
 all():SlashCommand[]{return [...this.items.values()];}
}

const needsNote=(context:SlashContext)=>context.hasNote?null:'Open a note first.';
const needsImageModel=(context:SlashContext)=>context.readsImages?null:'The selected model cannot read images. Choose an image-capable model.';

/** The built-in commands, in the order the list shows them when nothing is typed. */
export const BUILTIN_SLASH_COMMANDS:readonly SlashCommand[]=[
 {id:'image-to-md',title:'Image to Markdown',kind:'prompt',
  description:'Transcribe an image into Markdown and LaTeX',keywords:['ocr','transcribe','screenshot','picture','md'],
  prompt:'Transcribe the attached image into Obsidian Markdown with LaTeX math. Match the language of my note and propose where it belongs. Mark unclear symbols.',
  unavailable:needsImageModel,opensPicker:'image'},
 {id:'pdf-page-to-md',title:'PDF page to Markdown',kind:'prompt',
  description:'Transcribe an attached PDF page into Markdown',keywords:['ocr','transcribe','pdf','md'],
  prompt:'Transcribe the attached PDF page into Obsidian Markdown with LaTeX math. Keep its headings, lists and tables, cite the file and page, and propose where it belongs in my note. Mark unclear symbols.',
  unavailable:context=>context.hasPdf?null:'Attach a PDF, a PDF page or a PDF selection first.'},
 {id:'table-to-md',title:'Table to Markdown',kind:'prompt',
  description:'Turn an image of a table into a Markdown table',keywords:['ocr','table','spreadsheet','md'],
  prompt:'Turn the table in the attached image into an Obsidian Markdown table. Keep every row, column and header exactly as shown, mark unclear cells [unclear], and propose where it belongs in my note.',
  unavailable:needsImageModel,opensPicker:'image'},
 {id:'summarize',title:'Summarize',kind:'prompt',
  description:'Summarize the current note or the attachments',keywords:['summary','tldr','overview'],
  prompt:'Summarize the current note and anything attached. Keep the key facts, decisions and open questions, and cite the sources.',
  unavailable:context=>context.hasNote||context.hasAttachment?null:'Open a note or attach something first.'},
 {id:'format',title:'Improve formatting',kind:'prompt',
  description:'Clean up layout and structure as a reviewed edit',keywords:['layout','style','tidy','clean'],
  prompt:'Improve the formatting and layout of the current note using native Obsidian syntax (consult owla-formatting and owla-obsidian-guide). Do not change its meaning, links, citations or properties. Propose the changes as an edit for my review.',
  unavailable:needsNote},
 {id:'mermaid',title:'Mermaid diagram',kind:'prompt',
  description:'Draw a Mermaid diagram from the note',keywords:['diagram','flowchart','chart','graph'],
  prompt:'Create a Mermaid diagram of the main ideas and their relationships in the current note (consult owla-mermaid), and propose where to insert it.',
  unavailable:needsNote},
 {id:'math',title:'Fix math',kind:'prompt',
  description:'Correct or convert math to MathJax',keywords:['latex','mathjax','equation','formula'],
  prompt:'Check the math in the current note and convert it to valid Obsidian MathJax (consult owla-math). Do not change what the formulas say; point out anything that looks wrong instead of silently fixing it. Propose the changes as an edit.',
  unavailable:needsNote},
 {id:'properties',title:'Suggest properties',kind:'prompt',
  description:'Propose frontmatter properties and tags',keywords:['frontmatter','yaml','tags','metadata'],
  prompt:'Suggest frontmatter properties and tags for the current note, consistent with the properties and tags already used in this vault. Propose them with propose_properties.',
  unavailable:needsNote},
 {id:'links',title:'Check links',kind:'prompt',
  description:'Find broken links, backlinks and orphans',keywords:['backlinks','broken','orphan','wikilinks'],
  prompt:'Check the links of the current note with query_vault_graph: list its broken links, its backlinks and related notes that do not link to it yet. Suggest fixes; do not change anything without proposing it.',
  unavailable:needsNote},
 {id:'organize',title:'Organize files',kind:'prompt',
  description:'Propose moves or renames for review',keywords:['move','rename','folders','tidy'],
  prompt:'Look at the attached folder (or the folder of the current note) and propose a clearer organization: moves and renames in one batch, with a reason for each.'},
 {id:'export-pdf',title:'Export to PDF',kind:'prompt',
  description:'Export the current note to PDF after you confirm',keywords:['print','pdf','export'],
  prompt:'Export the current note to PDF.',
  unavailable:needsNote},
 {id:'canvas',title:'Note to Canvas',kind:'prompt',
  description:'Turn the note into an Obsidian Canvas',keywords:['canvas','board','map'],
  prompt:'Turn the current note into an Obsidian Canvas next to it: one card per main idea, grouped by section, connected where the note relates them. Propose it for my review.',
  unavailable:context=>!context.canvas?'Turn on Plugin Interconnectivity and the Canvas core plugin.':needsNote(context)},
 {id:'base',title:'Create a Base',kind:'prompt',
  description:'Build an Obsidian Base from note properties',keywords:['bases','table','database','view'],
  prompt:'Create an Obsidian Base that lists the notes related to the current note (same folder or tags) with their most useful properties as columns. Propose it for my review.',
  unavailable:context=>context.bases?null:'Turn on Plugin Interconnectivity and the Bases core plugin.'},
 {id:'excalidraw',title:'Sketch in Excalidraw',kind:'prompt',
  description:'Sketch the note as an Excalidraw drawing',keywords:['drawing','sketch','whiteboard'],
  prompt:'Sketch the main ideas of the current note as a new Excalidraw drawing: boxes for ideas, arrows for relationships, short labels. Propose it for my review.',
  unavailable:context=>!context.excalidraw?'Turn on Plugin Interconnectivity and install the Excalidraw plugin.':needsNote(context)},
 {id:'web',title:'Check on the web',kind:'prompt',
  description:'Answer with current web sources',keywords:['search','internet','sources','verify'],
  prompt:'Check this on the web and cite the sources: ',
  unavailable:context=>context.webSearch?null:'Web search is off in settings, or the provider cannot search the web.'},
 {id:'new',title:'New chat',kind:'action',description:'Start a new chat',keywords:['clear','reset'],
  unavailable:context=>context.awaitingReview?'Accept or decline pending changes first.':null},
 {id:'save',title:'Save chat',kind:'action',description:'Save the recent chat',keywords:['store','keep'],
  unavailable:context=>context.busy?'Wait for the reply or stop it first.':context.hasHistory?null:'Send a message before saving.'},
 {id:'open',title:'Open saved chat',kind:'action',description:'Open a saved chat',keywords:['history','load','saved'],
  unavailable:context=>context.busy?'Wait for the reply or stop it first.':null},
 {id:'undo',title:'Undo last edit',kind:'action',description:'Undo the last accepted edit',keywords:['revert','restore'],
  unavailable:context=>context.awaitingReview?'Accept or decline pending changes first.':context.canUndo?null:'No accepted edit to undo in this chat.'},
 {id:'model',title:'Choose model',kind:'action',description:'Choose the model and reasoning effort',keywords:['provider','effort','reasoning'],
  unavailable:context=>context.busy?'Wait for the reply or stop it first.':null},
];

/** The slash token being typed at the caret: from a `/` at the start or after whitespace, with no whitespace after it. */
export function slashQueryAt(text:string,caret:number):{start:number;end:number;query:string}|null{
 if(caret<0||caret>text.length)return null;
 let start=caret;
 while(start>0&&!/\s/.test(text[start-1]))start--;
 if(text[start]!=='/')return null;
 const token=text.slice(start,caret);
 // `//` and paths such as `/Users/me` are text, not commands.
 if(token.indexOf('/',1)!==-1)return null;
 let end=caret;
 while(end<text.length&&!/\s/.test(text[end]))end++;
 return {start,end,query:token.slice(1).toLowerCase()};
}

/** Subsequence match: every query character in order. Returns the gap count, or -1. */
function subsequence(query:string,target:string):number{
 let at=0,gaps=0,last=-1;
 for(const char of query){
  const found=target.indexOf(char,at);
  if(found===-1)return -1;
  if(last!==-1&&found!==last+1)gaps++;
  last=found;at=found+1;
 }
 return gaps;
}

/** Higher is better; 0 means no match. */
/** The score of a query that is a command's full id. */
const EXACT_SCORE=1000;

export function slashScore(query:string,command:SlashCommand):number{
 const q=query.toLowerCase().replace(/\s+/g,'-');
 if(!q)return 1;
 const id=command.id;
 if(id===q)return EXACT_SCORE;
 if(id.startsWith(q))return 900-id.length;
 const words=[...id.split('-'),...command.title.toLowerCase().split(/\s+/),...(command.keywords??[])];
 if(words.some(word=>word.startsWith(q)))return 700;
 if(id.includes(q))return 600;
 const gaps=subsequence(q,id);
 if(gaps!==-1)return 400-gaps*10;
 if(command.title.toLowerCase().includes(q)||command.description.toLowerCase().includes(q))return 200;
 return 0;
}

/** exact: the query is the command's full id. */
export interface SlashMatch{command:SlashCommand;reason:string|null;exact:boolean;}


/**
 * Matching commands, each with the reason it cannot run (or null). The command
 * whose id is typed in full comes first even when it cannot run, so `/save`
 * never picks `/open`; after it, available commands come before unavailable ones.
 */
export function matchSlashCommands(query:string,commands:readonly SlashCommand[],context:SlashContext):SlashMatch[]{
 return commands
  .map((command,index)=>{const score=slashScore(query,command);return {command,index,score,exact:score===EXACT_SCORE,reason:command.unavailable?.(context)??null};})
  .filter(item=>item.score>0)
  .sort((a,b)=>Number(b.exact)-Number(a.exact)||(a.reason?1:0)-(b.reason?1:0)||b.score-a.score||a.index-b.index)
  .map(({command,reason,exact})=>({command,reason,exact}));
}

/** The row highlighted when the list opens: an exact match, else the first command that can run. */
export function slashActiveIndex(matches:readonly SlashMatch[]):number{
 if(matches[0]?.exact)return 0;
 return Math.max(0,matches.findIndex(match=>!match.reason));
}

/** The draft after a command replaces its slash token. A prompt command inserts its prompt; an action leaves the rest of the draft. */
export function applySlashCommand(text:string,token:{start:number;end:number},command:SlashCommand):{text:string;caret:number}{
 const before=text.slice(0,token.start),after=text.slice(token.end);
 if(command.kind==='action'){
  const joined=(before.replace(/\s+$/,'')+(before.trim()&&after.trim()?' ':'')+after.replace(/^\s+/,''));
  return {text:joined,caret:Math.min(before.replace(/\s+$/,'').length,joined.length)};
 }
 const prompt=command.prompt??'';
 const rest=after.replace(/^\s+/,'');
 const inserted=prompt+(rest&&!/\s$/.test(prompt)?' ':'');
 return {text:before+inserted+rest,caret:(before+inserted).length};
}
