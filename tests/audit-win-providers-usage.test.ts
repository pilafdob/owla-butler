// Windows hardening (round 2): usage-limit parsing and reset handling.
// Non-finite reset times must never become permanent blocks; every limit
// reader must agree on the wordings (LIMIT_ERROR); CRLF/lone-CR console
// output must not hide a limit; reset epochs must be timezone/DST-proof;
// fenced Markdown and SSE sentinels must survive CRLF; Windows path rules
// stay platform-parameterized. Pure functions — no daemon, no clock tricks.
import {test} from 'node:test';import assert from 'node:assert/strict';
import {updateUsage,usageWindows,decodeUsage,decodeOpencodeUsage,decodeClaudeUsage,decodeClaudeRateLimit} from '../src/usage';
import {codexExhaustion,claudeExhaustion,opencodeExhaustion,exhaustionLabel,LIMIT_ERROR} from '../src/exhaustion';
import {OpencodeAvailability,classifyOpencodeFailure,OPENCODE_RETRY_AFTER_SECONDS} from '../src/opencode-availability';
import {friendlyOpencodeError} from '../src/opencode';
import {stripFence,parseJsonLine,allowedPath,isPathInside} from '../src/core';
import type {ProviderModel} from '../src/provider';

const NOW=1_000_000;
const goPaid:ProviderModel={id:'opencode-go/glm-5.3',model:'glm-5.3',providerID:'opencode-go',displayName:'GLM-5.3',isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:''}],cost:{input:1.4,output:4.4}};

test('non-finite reset times decode to unknown, never to a permanent block',()=>{
 const codex=decodeUsage({rateLimits:{primary:{usedPercent:50,resetsAt:NaN}}});
 assert.equal(codex?.rateLimits?.primary?.resetsAt,null);
 const go=decodeOpencodeUsage({go:{rolling:{percent:100,limited:true,resetsAt:NaN}}});
 assert.equal(go?.rateLimitsByLimitId?.['opencode-go-rolling']?.primary?.resetsAt,null);
 const claude=decodeClaudeRateLimit({unifiedWindows:{five_hour:{utilization:1,resetsAt:NaN}}});
 assert.equal(claude?.rateLimitsByLimitId?.claude?.primary?.resetsAt,null);
 const badIso=decodeClaudeUsage({rate_limits:{five_hour:{utilization:100,resets_at:'not-a-date'}}});
 assert.equal(badIso?.rateLimitsByLimitId?.claude?.primary?.resetsAt,null);
 // A finite reset still decodes unchanged.
 const fine=decodeUsage({rateLimits:{primary:{usedPercent:50,resetsAt:1793890000}}});
 assert.equal(fine?.rateLimits?.primary?.resetsAt,1793890000);
});

test('a Claude window with a non-finite reset stays bounded and readable',()=>{
 const state=claudeExhaustion({rateLimitsByLimitId:{claude:{primary:{usedPercent:100,resetsAt:NaN}}}},undefined,NOW);
 assert.equal(state.exhausted,true);
 assert.equal(state.resetsAt,null,'a NaN reset is unknown, not a moment that never passes');
 assert.ok(!exhaustionLabel(state).includes('Invalid Date'));
});

test('a Go meter with a non-finite reset expires on the retry window',()=>{
 const availability=new OpencodeAvailability();
 availability.applyUsage({rateLimitsByLimitId:{'opencode-go-weekly':{primary:{usedPercent:100,resetsAt:NaN}}}},NOW);
 assert.equal(availability.available(goPaid,NOW),false);
 assert.equal(availability.available(goPaid,NOW+OPENCODE_RETRY_AFTER_SECONDS+1),true,'the block must not outlive the retry window');
});

test('every limit reader agrees on the wordings',()=>{
 for(const message of ['rate_limit_error','rate-limit exceeded','quota exceeded','HTTP 429','too many requests','limit reached','usage limit reached']){
  assert.equal(codexExhaustion(null,message,NOW).exhausted,true,'codex '+message);
  assert.equal(claudeExhaustion(null,message,NOW).exhausted,true,'claude '+message);
  assert.equal(opencodeExhaustion(message,null).exhausted,true,'opencode '+message);
  assert.equal(classifyOpencodeFailure(message).kind,'usage-limit','classify '+message);
  assert.match(friendlyOpencodeError(Error(message)),/usage limit/i,'friendly '+message);
  assert.ok(LIMIT_ERROR.test(message),message);
 }
 for(const message of ['network unreachable','socket hang up','error code 14293']){
  assert.equal(codexExhaustion(null,message,NOW).exhausted,false,'codex '+message);
  assert.equal(claudeExhaustion(null,message,NOW).exhausted,false,'claude '+message);
  assert.equal(opencodeExhaustion(message,null).exhausted,false,'opencode '+message);
  assert.equal(classifyOpencodeFailure(message).scope,'none','classify '+message);
 }
 // Precedence is unchanged: free limits and model refusals are not usage limits.
 assert.equal(opencodeExhaustion('Free usage limit reached.',null).scope,'free models');
 assert.equal(classifyOpencodeFailure('Free usage limit reached.').kind,'free-limit');
 assert.equal(classifyOpencodeFailure('Model unavailable: x/y').kind,'unavailable');
});

test('CRLF and lone CR in limit errors do not hide the limit',()=>{
 assert.equal(codexExhaustion(null,'HTTP 429\r\nrate_limit_exceeded',NOW).exhausted,true);
 assert.equal(claudeExhaustion(null,'429\r',NOW).exhausted,true);
 assert.equal(opencodeExhaustion('too many requests\r\n',null).exhausted,true);
 assert.equal(classifyOpencodeFailure('limit reached\r').kind,'usage-limit');
 assert.match(friendlyOpencodeError(Error('quota\r')),/usage limit/i);
});

test('reset times parse to absolute epochs across timezone offsets and DST',()=>{
 // US fall-back: 01:30 at UTC-4 is 05:30Z; spring-forward: 02:30 at UTC-5 is
 // 07:30Z. The epoch must not depend on the host's timezone or DST rules.
 const fallBack=Date.UTC(2026,10,1,5,30)/1000;
 const springForward=Date.UTC(2026,2,8,7,30)/1000;
 const fall=decodeClaudeUsage({rate_limits:{five_hour:{utilization:100,resets_at:'2026-11-01T01:30:00-04:00'}}});
 assert.equal(fall?.rateLimitsByLimitId?.claude?.primary?.resetsAt,fallBack);
 const spring=decodeClaudeUsage({rate_limits:{five_hour:{utilization:100,resets_at:'2026-03-08T02:30:00-05:00'}}});
 assert.equal(spring?.rateLimitsByLimitId?.claude?.primary?.resetsAt,springForward);
 const zulu=decodeClaudeUsage({rate_limits:{five_hour:{utilization:100,resets_at:'2026-11-01T05:30:00Z'}}});
 assert.equal(zulu?.rateLimitsByLimitId?.claude?.primary?.resetsAt,fallBack);
 const halfOffset=decodeClaudeUsage({rate_limits:{five_hour:{utilization:100,resets_at:'2026-11-19T12:00:00+05:30'}}});
 assert.equal(halfOffset?.rateLimitsByLimitId?.claude?.primary?.resetsAt,Date.UTC(2026,10,19,6,30)/1000);
 // Expiry is epoch math: the window blocks until the reset second, not past it.
 assert.equal(claudeExhaustion(fall,undefined,fallBack-1).exhausted,true);
 assert.equal(claudeExhaustion(fall,undefined,fallBack).exhausted,false);
 // OpenCode Go reports milliseconds; the conversion keeps the same epoch.
 const go=decodeOpencodeUsage({go:{rolling:{percent:100,limited:true,resetsAt:fallBack*1000}}});
 assert.equal(go?.rateLimitsByLimitId?.['opencode-go-rolling']?.primary?.resetsAt,fallBack);
 const availability=new OpencodeAvailability();
 availability.applyUsage(go,NOW);
 assert.equal(availability.available(goPaid,fallBack-1),false);
 assert.equal(availability.available(goPaid,fallBack),true);
});

test('a sparse merge keeps finite windows when an incoming percentage is non-finite',()=>{
 const initial=updateUsage(null,{rateLimitsByLimitId:{codex:{primary:{usedPercent:10,resetsAt:NOW+600},secondary:{usedPercent:20}}}});
 const merged=updateUsage(initial,{rateLimitsByLimitId:{codex:{primary:{usedPercent:NaN}}}});
 const rows=usageWindows(merged);
 assert.deepEqual(rows.map(row=>row.used),[20],'the non-finite window is unknown, the other window stays');
 assert.equal(codexExhaustion(merged,undefined,NOW).exhausted,false);
 assert.equal(claudeExhaustion(merged,undefined,NOW).exhausted,false);
});

test('fenced Markdown with CRLF line endings is unwrapped',()=>{
 assert.equal(stripFence('```markdown\r\n[[Note]]\r\n```'),'[[Note]]');
 assert.equal(stripFence('```\r\nx=2\r\n```'),'x=2');
 assert.equal(stripFence('```md\r\na\r\nb\r\n```'),'a\r\nb');
 // POSIX line endings are unchanged.
 assert.equal(stripFence('```markdown\n[[Note]]\n```'),'[[Note]]');
 assert.equal(stripFence('no fence'),'no fence');
 // Inline math bodies keep their trimmed shape with CRLF input.
 assert.equal(stripFence('$$x=2\r$$'),'$$\nx=2\n$$');
});

test('SSE sentinels survive CRLF chunk boundaries',()=>{
 assert.equal(parseJsonLine('[DONE]\r'),null);
 assert.equal(parseJsonLine('\r'),null);
 assert.equal(parseJsonLine(''),null);
 assert.deepEqual(parseJsonLine('data: {"a":1}\r'),{a:1});
 assert.deepEqual(parseJsonLine('{"a":1}\r'),{a:1});
 assert.equal(parseJsonLine(': keep-alive\r'),null);
 assert.equal(parseJsonLine('event: update\r'),null);
 assert.equal(parseJsonLine('id: 7\r'),null);
});

test('Windows path rules stay platform-parameterized',()=>{
 // Trailing dots and spaces are refused only on Windows, where NTFS drops them.
 assert.equal(allowedPath('Notes./A.md','','md','win32'),false);
 assert.equal(allowedPath('Notes /A.md','','md','win32'),false);
 assert.equal(allowedPath('Dr./A.md','','md','linux'),true);
 assert.equal(allowedPath('Notes./A.md','','md','linux'),true);
 // UNC vaults compare case-insensitively, like drive paths.
 assert.equal(isPathInside('\\\\SERVER\\SHARE\\Vault','\\\\server\\share\\vault\\A.md','win32'),true);
 assert.equal(isPathInside('\\\\SERVER\\SHARE\\Vault','\\\\server\\share\\other\\A.md','win32'),false);
 assert.equal(isPathInside('C:\\Vault','c:\\vault\\A.md','win32'),true);
 assert.equal(isPathInside('C:\\Vault','C:\\Other\\A.md','win32'),false);
 // POSIX behaviour is unchanged.
 assert.equal(isPathInside('/vault','/vault/Notes/A.md','linux'),true);
 assert.equal(isPathInside('/vault','/other/A.md','linux'),false);
});
