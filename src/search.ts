const SEARCH_STOP=new Set(['the','a','an','and','about','for','notes','note','in','of','to','find','related','der','die','das','und','über','notizen']);
const escapeRegExp=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/**
 * Word-boundary term matcher. `includes('graph')` also fires on "paragraph" and
 * `includes('integral')` on unrelated substrings, which pulled off-topic notes
 * (music, English) into vault search. A term only counts at a letter/digit
 * boundary, so "graph" no longer matches "paragraph". Compiled once per query
 * term and cached, because searchScore runs over every vault file.
 */
const termRegexCache=new Map<string,RegExp>();
function termRegex(term:string):RegExp{
 let re=termRegexCache.get(term);
 if(!re){re=new RegExp('(?<![\\p{L}\\p{N}])'+escapeRegExp(term)+'(?![\\p{L}\\p{N}])','giu');if(termRegexCache.size>=512)termRegexCache.clear();termRegexCache.set(term,re);}
 re.lastIndex=0;return re;
}
function termHits(haystack:string,term:string):number{
 if(!term)return 0;const re=termRegex(term);let n=0;while(re.exec(haystack))n++;return n;
}
export function searchScore(path:string,text:string,query:string):number{
 const q=query.toLowerCase().trim(),p=path.toLowerCase(),body=text.toLowerCase();
 const raw=q.split(/\s+/).filter(Boolean).slice(0,8);
 const specific=raw.filter(w=>!SEARCH_STOP.has(w));const words=specific.length?specific:raw;
 if(!words.length)return 0;
 // Whole-phrase matches (path or body) are the strongest signal.
 const phrasePath=termHits(p,q),phraseBody=termHits(body,q);
 let score=phrasePath>0?100:0;if(phraseBody>0)score+=15;
 let distinct=0,pathHits=0;
 for(const word of words){
  const ph=termHits(p,word),bh=termHits(body,word);
  if(ph>0){score+=12+Math.min(ph,3)*2;pathHits++;distinct++;}
  else if(bh>0){score+=3+Math.min(bh,4);distinct++;}
 }
 if(score<=0)return 0;
 // Relevance floor: a long query satisfied by a single generic body word is
 // noise (e.g. "function graph derivative integral parabel" matching only
 // "function" in a music-theory note). Require a path/phrase hit, two distinct
 // terms, or a short query where one term is a reasonable match.
 if(words.length>=3&&distinct<2&&pathHits===0&&phrasePath===0&&phraseBody===0)return 0;
 return score+distinct*10;
}

export function lookupText(request:string):string{
 return request.split(/[.!?;\n]+/).filter(clause=>!/\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,3}(?:read|search|find|look|compare)\b/i.test(clause)&&!/\b(?:nicht|keine)\s+(?:\w+\s+){0,3}(?:lesen|suchen|vergleichen)\b/i.test(clause)).join(' ');
}
export function needsLookup(request:string):boolean{return /\b(find|search|look up|read|compare|related|suche|finde|vergleiche|lies)\b/i.test(lookupText(request))||lookupText(request).includes('[[');}

export function standaloneQuestion(prompt:string):boolean{return /^(why|what|how|explain|solve|simplify|calculate)\b/i.test(prompt)&&! /\b(?:my|this|these|open|current|supplied|attached|selected|the)\s+(?:\w+\s+){0,2}(?:note|notes|text|passage|selection|context|author|teacher)\b|\baccording\b/i.test(prompt);}
