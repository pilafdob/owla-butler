/**
 * Splits a text stream into delimiter-separated records.
 *
 * Appending every chunk to one growing string and searching it again is
 * quadratic for a long record that arrives in many chunks: V8 has to flatten
 * the whole concatenated string on every search. A single 16 MiB protocol
 * message took 0.3–1.4 s of blocked main thread that way (PERFORMANCE-AUDIT.md,
 * finding 3). The splitter keeps a partial record as a list of chunks and joins
 * them only once a delimiter arrives, so each byte is copied a constant number
 * of times.
 *
 * A record longer than `limit` is not returned. The splitter then reports
 * `overflow` and returns nothing further, so a caller can close the stream.
 */
export class RecordSplitter{
 private parts:string[]=[];
 private pending=0;
 overflow=false;
 constructor(private readonly delimiter:string,private readonly limit=Number.POSITIVE_INFINITY){
  if(!delimiter)throw Error('A record delimiter is required.');
 }

 /** The complete records that end in this chunk, in order. */
 push(chunk:string):string[]{
  if(this.overflow||!chunk)return [];
  const delimiter=this.delimiter;
  const last=this.parts.at(-1);
  // A delimiter of several characters can begin in one chunk and end in the next.
  const straddles=last!==undefined&&delimiter.length>1&&(last.slice(1-delimiter.length)+chunk.slice(0,delimiter.length-1)).includes(delimiter);
  if(!straddles&&!chunk.includes(delimiter)){
   this.parts.push(chunk);
   this.pending+=chunk.length;
   if(this.pending>this.limit)this.stop();
   return [];
  }
  const records=(this.parts.join('')+chunk).split(delimiter);
  const rest=records.pop()??'';
  this.parts=rest?[rest]:[];
  this.pending=rest.length;
  const oversized=records.findIndex(record=>record.length>this.limit);
  if(oversized>=0){this.stop();return records.slice(0,oversized);}
  if(this.pending>this.limit)this.stop();
  return records;
 }

 private stop(){this.overflow=true;this.parts=[];this.pending=0;}
}
