import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readReference} from '../src/knowledge';

const guide=(name:string)=>readFileSync(`assets/skills/${name}/SKILL.md`,'utf8');

test('Excalidraw first reference passage gives the bounded Canvas conversion route',()=>{
 const first=readReference('owla-excalidraw');
 for(const tool of ['read_reference','read_canvas','propose_excalidraw','read_excalidraw'])assert.ok(first.includes(tool),tool);
 assert.match(first,/one (?:new )?(?:destination|drawing)/i);
 assert.match(first,/original.*unchanged/i);
 assert.match(first,/actual.*ids/i);
 assert.match(first,/missing.*stop|stop.*missing/i);
 assert.match(first,/no shell|never use.*shell|do not use.*shell/i);
});
