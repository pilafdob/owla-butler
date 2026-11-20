// 3.7.0 RC security audit: the Hermes mirror exclusion must cover EVERY live
// daemon endpoint, lock, pid, registry, dotenv and writable cache of the real
// provider home. The entry list below is the name-only enumeration of the
// installed Hermes home on the audit host (79 entries, 2026-11-19); credential
// contents were never read. A new Hermes state artifact must be added to the
// exclusion, not mirrored (SECURITY-AUDIT-3.6.2 M9, audits/3.7.0-rc).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hermesMirrorExcluded} from '../src/hermes';

const REAL_HOME_ENTRIES=[
 '.auto_prune_estimate.json','.curator_backups','.env','.env.lock',
 '.hermes-update-in-progress.lock','.hermes_history','.install_id.lock',
 '.mcp-discovery.lock','.skills_prompt_snapshot.json',
 'SOUL.md','assets','audio_cache','auth.json','auth.lock','backups',
 'bootstrap-cache','bot_relay','cache','channel_directory.json','config.yaml',
 'context_length_cache.yaml','context_length_cache.yaml.lock','cron',
 'desktop-plugins','gateway-connections.json','gateway-starts.log',
 'gateway.lock','gateway.pid','gateway.sock','gateway_state.json',
 'hermes-agent','hermes-setup','hooks','image_cache','import-sync.json',
 'install_id','installs','kanban','kanban.db','kanban.db-shm','kanban.db-wal',
 'kanban.db.dispatch.lock','kanban.db.init.lock','locks','log_hash_salt','logs',
 'lsp','memories','models_dev_cache.etag','models_dev_cache.json','pairing',
 'pending_messages','platforms','plugin-update-checks','plugins',
 'processes.json','processes.json.lock','projects.db',
 'provider_models_cache.json','provider_models_cache.json.lock','runtime',
 'sessions','shared','shell-hooks-allowlist.json','skills','source-checks',
 'spawn-ledger.json','spawn-ledger.json.lock','state','state.db','state.db-shm',
 'state.db-wal','state.db.auto-maintenance.lock','state.db.fts_rebuild.lock',
 'state.db.quarantine.lock','telemetry','terminal-sessions','tools',
 'ui-preferences.json',
];

// The only entries that may stay mirrored: the install, the sign-ins with the
// locks that serialize their refresh, and the read-mostly model caches. `.env`
// is excluded here because it is written as a filtered copy, never linked.
const MAY_MIRROR=new Set([
 'assets','auth.json','auth.lock','context_length_cache.yaml',
 'context_length_cache.yaml.lock','hermes-agent','hermes-setup','installs',
 'models_dev_cache.etag','models_dev_cache.json','provider_models_cache.json',
 'provider_models_cache.json.lock','shared','tools',
]);

test('every real Hermes home entry is either excluded or an intentional keep',()=>{
 assert.equal(REAL_HOME_ENTRIES.length,79);
 const mirrored=REAL_HOME_ENTRIES.filter(entry=>!hermesMirrorExcluded(entry));
 assert.deepEqual([...mirrored].sort(),[...MAY_MIRROR].sort());
 // The decisive escape artifacts are never mirrored, in any spelling.
 for(const entry of ['gateway.sock','gateway.lock','gateway.pid','runtime','state','locks','processes.json','processes.json.lock','.env'])
  for(const spelling of [entry,entry.toUpperCase(),entry[0].toUpperCase()+entry.slice(1)])
   assert.equal(hermesMirrorExcluded(spelling),true,spelling);
});
