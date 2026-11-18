import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionModelAvailability,classifyOpencodeFailure} from '../src/opencode-availability';
import {readSettings,writeSettings} from '../src/core';

test('a model entitlement refusal survives settings save and plugin reload until reset',()=>{
 const gate=new SessionModelAvailability();
 gate.recordFailure('opencode','google/gemma-4-26b-a4b-it','Model is not available on your subscription. secret-token-do-not-store');
 const prefs=readSettings({},'mac');
 prefs.modelUnavailability=gate.snapshot();
 const stored=writeSettings(prefs,{},'mac');
 const reloaded=new SessionModelAvailability(readSettings(stored,'mac').modelUnavailability);
 assert.equal(reloaded.available('opencode','google/gemma-4-26b-a4b-it'),false);
 assert.equal(reloaded.available('hermes','google/gemma-4-26b-a4b-it'),true);
 assert.equal(JSON.stringify(stored).includes('secret-token'),false);
 reloaded.clear();
 const reset=new SessionModelAvailability(reloaded.snapshot());
 assert.equal(reset.available('opencode','google/gemma-4-26b-a4b-it'),true);
});

// The two refusals the School chat actually hit. The model works without the
// reasoning parameter, so it must not be blacklisted — only the parameter is.
test('unsupported reasoning parameters are remembered per model, not treated as a missing plan',()=>{
 for(const message of ['Thinking budget is not supported for this model.','`reasoning_format` is not supported with this model']){
  assert.equal(classifyOpencodeFailure(message).kind,'effort',message);
  const gate=new SessionModelAvailability();
  gate.recordFailure('opencode','groq/allam-2-7b',message);
  assert.equal(gate.rejectsEffort('opencode','groq/allam-2-7b'),true);
  assert.equal(gate.available('opencode','groq/allam-2-7b'),true,'the model itself stays usable');
  const reloaded=new SessionModelAvailability(gate.snapshot());
  assert.equal(reloaded.rejectsEffort('opencode','groq/allam-2-7b'),true,'survives a reload');
  reloaded.clear();
  assert.equal(reloaded.rejectsEffort('opencode','groq/allam-2-7b'),false,'the settings reset clears it');
 }
});

test('transient limits are never written to the permanent memory',()=>{
 const gate=new SessionModelAvailability();
 for(const message of ['429 rate limit reached','free usage limit reached','insufficient balance','401 unauthorized'])
  assert.equal(gate.recordFailure('opencode','m/free',message).refused,false,message);
 assert.deepEqual(gate.snapshot(),[]);
});

test('the memory is bounded and rejects malformed stored entries',()=>{
 const gate=new SessionModelAvailability([
  {provider:'opencode',model:'ok/model',kind:'unavailable'},
  {provider:'not-a-provider',model:'x',kind:'unavailable'},
  {provider:'opencode',model:'../../etc/passwd',kind:'unavailable'},
  {provider:'opencode',model:'y',kind:'nonsense'},
  {provider:'opencode',model:'ok/model',kind:'unavailable'},
  'junk',null,
 ]);
 assert.deepEqual(gate.snapshot(),[{provider:'opencode',model:'ok/model',kind:'unavailable'}]);
});
