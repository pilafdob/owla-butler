// RC hardening: Bases filter/reference recursion is depth-bounded.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {baseProblems,baseReferences,parseBase} from '../src/bases';

const yaml=(text:string)=>JSON.parse(text);

test('bases: deeply nested filters report a problem instead of overflowing the stack',()=>{
 let deep='';for(let i=0;i<200;i++)deep+='{"and":[';deep+='"x"';for(let i=0;i<200;i++)deep+=']}';
 const data=parseBase('{"filters":'+deep+'}',yaml);
 assert.ok(baseProblems(data).some(problem=>/nested too deeply/.test(problem)));
 assert.ok(Array.isArray(baseReferences(data)),'reference scan also tolerates deep nesting');
});

test('bases: ordinary nesting still validates',()=>{
 const data=parseBase('{"filters":{"and":[{"or":["note.a == 1","note.b == 2"]},"file.inFolder(\\"Notes\\")"]}}',yaml);
 assert.deepEqual(baseProblems(data),[]);
});
