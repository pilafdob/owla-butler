import {test} from 'node:test';import assert from 'node:assert/strict';import {updateUsage,usageWindows} from '../src/usage';
test('reported quotas preserve actual percentages, windows and Unix reset timestamps',()=>{const data=updateUsage(null,{rateLimits:{limitId:'codex',primary:{usedPercent:25,windowDurationMins:300,resetsAt:1793890000},secondary:{usedPercent:80,windowDurationMins:10080,resetsAt:1794000000}}});const rows=usageWindows(data);assert.equal(rows[0].remaining,75);assert.equal(rows[0].window,'5-hour window');assert.equal(rows[0].resetsAt,1793890000);assert.equal(rows[1].remaining,20);assert.equal(rows[1].window,'7-day window');});
test('sparse notifications update their bucket without fabricating or losing other windows',()=>{const initial=updateUsage(null,{rateLimitsByLimitId:{codex:{primary:{usedPercent:10},secondary:{usedPercent:20}},other:{primary:{usedPercent:5}}}});const next=updateUsage(initial,{rateLimits:{limitId:'codex',primary:{usedPercent:12}}});assert.equal(usageWindows(next).length,3);assert.equal(usageWindows(next)[0].used,12);assert.equal(usageWindows(next)[1].used,20);});
test('unknown or missing data is unavailable, never assumed zero usage',()=>{assert.deepEqual(usageWindows(null),[]);assert.deepEqual(usageWindows(updateUsage(null,{rateLimits:{primary:null,secondary:null}})),[]);const old=updateUsage(null,{rateLimits:{primary:{usedPercent:50}}});assert.deepEqual(usageWindows(updateUsage(old,{},true)),[]);});
test('over-limit usage remains visible and remaining allowance cannot become negative',()=>{const rows=usageWindows(updateUsage(null,{rateLimits:{limitId:'codex',primary:{usedPercent:105}}}));assert.equal(rows[0].used,105);assert.equal(rows[0].remaining,0);});

test('malformed Codex usage data does not fabricate or coerce counters',async()=>{
 const {decodeUsage}=await import('../src/usage');assert.equal(decodeUsage({unrelated:true}),null);
 const actual=decodeUsage({rateLimits:{limitId:'codex',primary:{usedPercent:'80'},secondary:{usedPercent:45,windowDurationMins:10080,resetsAt:1794000000}},rateLimitResetCredits:{availableCount:2}});
 const rows=usageWindows(updateUsage(null,actual??{}));assert.deepEqual(rows.map(row=>[row.used,row.resetsAt]),[[45,1794000000]]);assert.equal(actual?.rateLimitResetCredits?.availableCount,2);
});
test('a sparse bucket report keeps the windows and buckets it does not mention',()=>{
 const initial=updateUsage(null,{rateLimitsByLimitId:{codex:{limitId:'codex',primary:{usedPercent:10},secondary:{usedPercent:20}},other:{primary:{usedPercent:5}}}});
 const next=updateUsage(initial,{rateLimitsByLimitId:{codex:{primary:{usedPercent:12}}}});
 const rows=usageWindows(next);
 assert.equal(rows.length,3);
 assert.deepEqual(rows.map(row=>row.used),[12,20,5]);
 // An explicit null window clears that window; a replace report starts fresh.
 const cleared=updateUsage(next,{rateLimitsByLimitId:{codex:{secondary:null}}});
 assert.deepEqual(usageWindows(cleared).map(row=>row.used),[12,5]);
 assert.deepEqual(usageWindows(updateUsage(cleared,{rateLimitsByLimitId:{fresh:{primary:{usedPercent:1}}}},true)).map(row=>row.used),[1]);
});
