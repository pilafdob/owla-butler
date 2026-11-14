import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
 attachmentSizeBucket,
 buildRoutingContext,
 computeComplexityFeatures,
 decodeRoute,
 DEFAULT_ROUTING_TOKEN_BUDGET,
 DegradationNotifier,
 estimateTokens,
 extractNoteOutline,
 extractRecentTopics,
 fallbackRoute,
 routeSchemaFields,
 routingModels,
 summarizeRoutingContext,
 supportsAutomaticSelection,
} from '../src/routing';
import {migrateSettings} from '../src/core';
import type {CodexModel} from '../src/codex';

const models:CodexModel[]=[
 {id:'fast',model:'fast',displayName:'Fast',isDefault:false,defaultReasoningEffort:'low',
  supportedReasoningEfforts:[{reasoningEffort:'low',description:''}],inputModalities:['text'],context:200_000},
 {id:'general',model:'general',displayName:'General',isDefault:true,defaultReasoningEffort:'medium',
  supportedReasoningEfforts:[{reasoningEffort:'medium',description:''},{reasoningEffort:'high',description:''}],inputModalities:['text','image'],context:1_000_000}
];

test('routes must identify an available model and a reasoning effort it supports',()=>{
 assert.deepEqual(decodeRoute('{"model":2,"effort":"high"}',models),{model:'general',effort:'high'});
 for(const output of ['{"model":2,"effort":"low"}','{"model":999,"effort":"high"}','{"model":"2","effort":"high"}','rewrite this prompt']){
  assert.throws(()=>decodeRoute(output,models));
 }
 // A6: thorough route schema includes rationale first and decodeRoute ignores it.
 assert.deepEqual(Object.keys(routeSchemaFields(true)),['rationale','model','effort']);
 assert.deepEqual(decodeRoute('{"rationale":"Needs vision and multi-step work.","model":2,"effort":"high"}',models,'codex',true),{model:'general',effort:'high'});
 assert.throws(()=>decodeRoute('{"model":2,"effort":"high"}',models,'codex',true),/incomplete thorough selection/);
});

test('automatic routing is opt-in and fallback preserves compatible manual selections',()=>{
 assert.equal(migrateSettings({schemaVersion:2}).automaticRouting,false);
 assert.equal(migrateSettings({schemaVersion:2,automaticRouting:true}).automaticRouting,true);
 const manual={model:'fast',effort:'low'};
 assert.deepEqual(fallbackRoute(routingModels(models,false),manual),manual);
 assert.deepEqual(fallbackRoute(routingModels(models,true),manual),{model:'general',effort:'medium'});
});

test('Apple Foundation Models automatic selection is only supported on macOS',()=>{
 assert.equal(supportsAutomaticSelection('darwin'),true);
 assert.equal(supportsAutomaticSelection('win32'),false);
 assert.equal(supportsAutomaticSelection('linux'),false);
});

test('routing inventory emits fingerprints by default and bounds names when includeNames is enabled',()=>{
 const context={
  attachments:[
   {kind:'pdf' as const,name:'Private folder/Jamaica Reggae Präsentation.pdf',page:9,pages:24,sizeBucket:'large' as const},
   ...Array.from({length:15},()=>({kind:'image' as const,name:'a'.repeat(100)+'\n.png',sizeBucket:'small' as const}))
  ],
  activeNote:true,selections:2,recentMessages:4,previousImages:1,previousPdfs:2,webSearch:false
 };
 // A3: Default omits attachment filenames to avoid biasing effort while keeping fingerprints.
 const defaultInventory=summarizeRoutingContext(context);
 assert.deepEqual(defaultInventory.items[0],{kind:'pdf',ext:'pdf',page:9,pages:24,sizeBucket:'large'});
 assert.equal(defaultInventory.names,undefined);
 assert.equal(defaultInventory.items.length,12);
 assert.equal(defaultInventory.totals.image,15);
 assert.equal(defaultInventory.omittedItems,4);
 assert.equal(defaultInventory.previousImages,1);
 assert.doesNotMatch(JSON.stringify(defaultInventory),/Jamaica|Private folder/);

 // A1 & A3: When includeNames:true (or thorough:true), bounded basenames are included (capped at 5 in names).
 const namedInventory=summarizeRoutingContext(context,{includeNames:true});
 assert.equal(namedInventory.items[0].name,'Jamaica Reggae Präsentation.pdf');
 assert.ok(namedInventory.items.every(item=>(item.name?.length??0)<=72));
 assert.equal(namedInventory.names?.length,5);
 assert.equal(namedInventory.names?.[0],'Jamaica Reggae Präsentation.pdf');
 assert.doesNotMatch(JSON.stringify(namedInventory),/Private folder/);
});

test('token-budgeted trimming bounds huge active-note previews within 3000 tokens while preserving totals and continuity',()=>{
 const hugePreview='Heading and paragraph text. '.repeat(2500);
 const hugeChat='user: message text with details\n'.repeat(1500);
 const summary=summarizeRoutingContext({
  attachments:[
   {kind:'pdf',name:'doc-1.pdf',sizeBucket:'medium'},
   {kind:'note',name:'note-1.md',sizeBucket:'small'},
  ],
  activeNote:true,
  activeNoteChars:hugePreview.length,
  selections:1,
  recentMessages:6,
  previousImages:0,
  previousPdfs:1,
  webSearch:true,
  activeNoteOutline:'# Main Title | ## Section 1 | ## Section 2',
  activeNotePreview:hugePreview,
  recentMessagePreview:hugeChat,
  previousProvider:'claude',
  previousModel:'sonnet',
  previousEffort:'medium',
 },DEFAULT_ROUTING_TOKEN_BUDGET);

 const serialized=JSON.stringify(summary);
 assert.ok(estimateTokens(serialized)<=DEFAULT_ROUTING_TOKEN_BUDGET,`Expected <= ${DEFAULT_ROUTING_TOKEN_BUDGET} tokens, got ${estimateTokens(serialized)}`);
 assert.deepEqual(summary.totals,{image:0,pdf:1,document:0,note:1,folder:0});
 assert.equal(summary.previousProvider,'claude');
 assert.equal(summary.previousModel,'sonnet');
 assert.equal(summary.previousEffort,'medium');
 assert.equal(summary.activeNoteOutline,'# Main Title | ## Section 1 | ## Section 2');
 assert.ok((summary.activeNotePreview?.length??0)<hugePreview.length);
});

test('note outline extraction strips YAML frontmatter and bounds headings to 400 chars',()=>{
 const md='---\ntitle: Secret Frontmatter\ntags: [a, b]\n---\n\n# Introduction\nBody text.\n## Methods and Materials\nMore text.\n### Statistical Analysis\nDetails.';
 const outline=extractNoteOutline(md);
 assert.equal(outline,'# Introduction | ## Methods and Materials | ### Statistical Analysis');
 assert.equal(extractNoteOutline('Just plain text without headings.'),'');
 const manyHeadings=Array.from({length:30},(_,i)=>`## Heading Number ${i+1} With Extra Words`).join('\n\n');
 assert.ok(extractNoteOutline(manyHeadings,400).length<=400);
});

test('complexity features vector and recent topics heuristic extract structured signals',()=>{
 const prompt='Compare my biology notes with the syllabus? Please summarize and organize the sections.\n```ts\nconst x = 1;\n```';
 const features=computeComplexityFeatures(prompt,{
  activeNoteChars:1000,
  selectedChars:250,
  attachments:[{kind:'pdf',name:'Syllabus.pdf'},{kind:'note',name:'Biology.md'}],
  recentMessages:4,
 });
 assert.equal(features.codeFences,1);
 assert.equal(features.questionMarks,1);
 assert.ok(features.imperativeVerbs>=3);
 assert.equal(features.selectionRatio,0.25);
 assert.equal(features.attachmentCount,2);
 assert.equal(features.recentMessageCount,4);
 assert.ok(features.promptWords>10);

 const topics=extractRecentTopics([
  {content:'Please summarize the Mitochondria chapter and compare Photosynthesis pathways.'},
  {content:'Also check the Krebs cycle diagram in Biology.'},
 ]);
 assert.ok(topics.includes('Mitochondria'));
 assert.ok(topics.includes('Photosynthesis'));
 assert.ok(topics.length<=8);
 assert.equal(attachmentSizeBucket(10_000),'small');
 assert.equal(attachmentSizeBucket(250_000),'medium');
 assert.equal(attachmentSizeBucket(5_000_000),'large');
});

test('privacy mode omits all prompt-derived strings, previews, outlines, topics and filenames',()=>{
 const ctx=buildRoutingContext({
  prompt:'Sensitive private medical note about patient John Doe.',
  attachments:[{kind:'pdf',name:'SecretFolder/JohnDoe_Medical_Record.pdf',page:2,sizeBucket:'medium'}],
  activeNoteText:'# Patient John Doe\nConfidential diagnosis details.',
  selections:[{path:'Private.md',text:'Selected secret text'}],
  recentMessages:[{role:'user',content:'Discuss John Doe treatment plan'}],
  previousImages:0,
  previousPdfs:1,
  webSearch:false,
  previousProvider:'codex',
  previousModel:'gpt-6.1-sol',
  previousEffort:'medium',
  privacyMode:true,
  thorough:true,
 });
 const summary=summarizeRoutingContext(ctx);
 const serialized=JSON.stringify(summary);
 assert.doesNotMatch(serialized,/John|Doe|Medical|Patient|Confidential|Secret|treatment/);
 assert.equal(summary.activeNoteOutline,undefined);
 assert.equal(summary.activeNotePreview,undefined);
 assert.equal(summary.recentMessagePreview,undefined);
 assert.equal(summary.recentTopics,undefined);
 assert.equal(summary.names,undefined);
 assert.equal(summary.items[0].name,undefined);
 assert.equal(summary.totals.pdf,1);
 assert.ok(summary.features);
});

test('thorough mode propagates raw previews, topics, attachment names and outline to context builder',()=>{
 const baseInput={
  prompt:'Summarize this note and compare with recent chat.',
  attachments:[{kind:'pdf' as const,name:'Folder/Paper.pdf',sizeBucket:'medium' as const}],
  activeNoteText:'# Overview\nParagraph body of the active note.',
  selections:[],
  recentMessages:[{role:'user',content:'Earlier question about Quantum Mechanics.'}],
  previousImages:0,
  previousPdfs:0,
  webSearch:true,
 };
 const standardCtx=buildRoutingContext({...baseInput,thorough:false});
 const standardSummary=summarizeRoutingContext(standardCtx);
 assert.equal(standardSummary.activeNoteOutline,'# Overview');
 assert.equal(standardSummary.activeNotePreview,undefined);
 assert.equal(standardSummary.recentMessagePreview,undefined);
 assert.equal(standardSummary.names,undefined);
 assert.ok(standardSummary.recentTopics?.includes('Quantum'));

 const thoroughCtx=buildRoutingContext({...baseInput,thorough:true});
 const thoroughSummary=summarizeRoutingContext(thoroughCtx);
 assert.equal(thoroughSummary.activeNoteOutline,'# Overview');
 assert.ok(thoroughSummary.activeNotePreview?.includes('Paragraph body'));
 assert.ok(thoroughSummary.recentMessagePreview?.includes('Quantum Mechanics'));
 assert.deepEqual(thoroughSummary.names,['Paper.pdf']);
});

test('context-window eligibility drops a 200k model when estimated tokens are 300k',()=>{
 // Default (no estimate) keeps both the 200k fast model and 1M general model.
 assert.equal(routingModels(models,false).length,2);
 // With an estimate of 300k tokens (requires >= 345k with 1.15x headroom), the 200k model is dropped.
 const filtered=routingModels(models,false,300_000);
 assert.deepEqual(filtered.map(m=>m.id),['general']);
});

test('graceful degradation notifier fires only once per session until reset',()=>{
 const notices:string[]=[];
 const notifier=new DegradationNotifier();
 assert.equal(notifier.notifyOnce('CLI unavailable',msg=>notices.push(msg)),true);
 assert.equal(notifier.notifyOnce('CLI unavailable again',msg=>notices.push(msg)),false);
 assert.equal(notices.length,1);
 assert.match(notices[0],/heuristic fallback/);
 notifier.reset();
 assert.equal(notifier.notifyOnce('After reset',msg=>notices.push(msg)),true);
 assert.equal(notices.length,2);
});

test('automatic routing only offers reasoning efforts compatible with OWLA’s single-agent session',()=>{
 const ultra={reasoningEffort:'ultra',description:''};
 const [candidate]=routingModels([{
  ...models[1],defaultReasoningEffort:'ultra',
  supportedReasoningEfforts:[ultra,...models[1].supportedReasoningEfforts]
 }],true);
 assert.deepEqual(candidate.supportedReasoningEfforts,models[1].supportedReasoningEfforts);
 assert.deepEqual(fallbackRoute([candidate],{model:'general',effort:'ultra'}),{model:'general',effort:'medium'});
 assert.throws(()=>decodeRoute('{"model":1,"effort":"ultra"}',[candidate]));
});
