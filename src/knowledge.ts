import references from '../assets/reference-pack.json';
export const REFERENCE_NAMES=Object.keys(references);
export function readReference(name:string,offset=0):string{
 const value=(references as Record<string,string>)[name];if(typeof value!=='string')throw Error('Choose a bundled reference: '+REFERENCE_NAMES.join(', '));
 if(!Number.isSafeInteger(offset)||offset<0||offset>=value.length)throw Error('Reference offset is outside the document.');
 const end=Math.min(value.length,offset+1400);
 return `REFERENCE ${name} (${offset}–${end} of ${value.length} characters)\n${value.slice(offset,end)}`+(end<value.length?`\nRead the next passage at offset ${end}.`:'');
}
