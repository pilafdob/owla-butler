import {record} from './validation';

/**
 * Windows Defender, OneDrive and the search indexer briefly lock freshly
 * written files (EBUSY/EPERM/EACCES). A short bounded retry rides out the
 * transient lock instead of failing a save, rename or delete; other errors
 * propagate at once. Atomics.wait throws on Electron's renderer main thread,
 * where Obsidian plugins run, so the pause is a bounded busy-wait: at most two
 * 25 ms spins, only on the rare transient-lock path.
 */
export function retryLocked<T>(fn:()=>T):T{
 for(let attempt=0;;attempt++){
  try{return fn();}
  catch(error){
   const code=record(error).code;
   if(attempt>=2||(code!=='EBUSY'&&code!=='EPERM'&&code!=='EACCES'))throw error;
   const until=performance.now()+25;
   while(performance.now()<until){/* bounded spin */}
  }
 }
}
