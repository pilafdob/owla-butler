export function searchScore(path:string,text:string,query:string):number{
 const q=query.toLocaleLowerCase().trim(),p=path.toLocaleLowerCase(),body=text.toLocaleLowerCase();const raw=q.split(/\s+/).filter(Boolean).slice(0,8);const stop=new Set(['the','a','an','and','about','for','notes','note','in','of','to','find','related','der','die','das','und','über','notizen']);const specific=raw.filter(w=>!stop.has(w));const words=specific.length?specific:raw;
 let score=p.includes(q)?100:0;if(body.includes(q))score+=15;let hits=0;for(const word of words){if(p.includes(word)){score+=12;hits++;}else if(body.includes(word)){score+=3;hits++;}}
 return score+hits*10;
}

export function lookupText(request:string):string{
 return request.split(/[.!?;\n]+/).filter(clause=>!/\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,3}(?:read|search|find|look|compare)\b/i.test(clause)&&!/\b(?:nicht|keine)\s+(?:\w+\s+){0,3}(?:lesen|suchen|vergleichen)\b/i.test(clause)).join(' ');
}
export function needsLookup(request:string):boolean{return /\b(find|search|look up|read|compare|related|suche|finde|vergleiche|lies)\b/i.test(lookupText(request))||lookupText(request).includes('[[');}

export function standaloneQuestion(prompt:string):boolean{return /^(why|what|how|explain|solve|simplify|calculate)\b/i.test(prompt)&&! /\b(?:my|this|these|open|current|supplied|attached|selected|the)\s+(?:\w+\s+){0,2}(?:note|notes|text|passage|selection|context|author|teacher)\b|\baccording\b/i.test(prompt);}
