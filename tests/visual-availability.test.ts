// Regression tests for the Obsidian-side plugin availability checks that gate
// the Canvas, Bases and Excalidraw features (visualFeatures in main.ts).
//
// Obsidian's own app.js implements getEnabledPluginById(id) as:
//   getEnabledPluginById(e){let{plugins:i}=this;if(Object.hasOwn(i,e)){
//     let r=i[e]; if(r.enabled) return r.instance} return null}
// So the enabled state of a built-in plugin lives at internalPlugins.plugins[id].enabled.
// A previous attempt to read internalPlugins.config[id] would silently disable
// every feature; these tests pin the correct shape so it cannot regress.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canvasAvailable,basesAvailable} from '../src/visual';

/* eslint-disable @typescript-eslint/no-explicit-any */

const appWith=(plugins:Record<string,{enabled?:boolean}|undefined>)=>({internalPlugins:{plugins}}) as any;

test('canvas/bases availability follows internalPlugins.plugins[id].enabled',()=>{
 assert.equal(canvasAvailable(appWith({canvas:{enabled:true}})),true);
 assert.equal(canvasAvailable(appWith({canvas:{enabled:false}})),false);
 assert.equal(canvasAvailable(appWith({})),false);
 assert.equal(canvasAvailable({} as any),false,'an app without internalPlugins is safely unavailable');
 assert.equal(basesAvailable(appWith({bases:{enabled:true}})),true);
 assert.equal(basesAvailable(appWith({bases:{enabled:false}})),false);
 assert.equal(basesAvailable(appWith({})),false);
});

test('a wrong config[id] shape does NOT enable the features (guards the API shape)',()=>{
 // If the enabled flag is only present under `config`, detection must stay off,
 // because Obsidian does not read that map for getEnabledPluginById.
 const app={internalPlugins:{config:{canvas:true,bases:true},plugins:{}}} as any;
 assert.equal(canvasAvailable(app),false);
 assert.equal(basesAvailable(app),false);
});

test('the two core plugins are detected independently',()=>{
 const app=appWith({canvas:{enabled:true},bases:{enabled:false}});
 assert.equal(canvasAvailable(app),true);
 assert.equal(basesAvailable(app),false);
});
