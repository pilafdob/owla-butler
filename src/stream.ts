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
 // The last delimiter.length-1 characters of the pending record: a delimiter
 // can straddle any number of chunks, not just the last two.
 private tail='';
 overflow=false;
 constructor(private readonly delimiter:string,private readonly limit=Number.POSITIVE_INFINITY){
  if(!delimiter)throw Error('A record delimiter is required.');
 }

 /** The complete records that end in this chunk, in order. */
 push(chunk:string):string[]{
  if(this.overflow||!chunk)return [];
  const delimiter=this.delimiter;
  const straddles=delimiter.length>1&&(this.tail+chunk.slice(0,delimiter.length-1)).includes(delimiter);
  if(!straddles&&!chunk.includes(delimiter)){
   this.parts.push(chunk);
   this.pending+=chunk.length;
   if(delimiter.length>1)this.tail=(this.tail+chunk).slice(1-delimiter.length);
   if(this.pending>this.limit)this.stop();
   return [];
  }
  const records=(this.parts.join('')+chunk).split(delimiter);
  const rest=records.pop()??'';
  this.parts=rest?[rest]:[];
  this.pending=rest.length;
  this.tail=delimiter.length>1?rest.slice(1-delimiter.length):'';
  const oversized=records.findIndex(record=>record.length>this.limit);
  if(oversized>=0){this.stop();return records.slice(0,oversized);}
  if(this.pending>this.limit)this.stop();
  return records;
 }

 private stop(){this.overflow=true;this.parts=[];this.pending=0;this.tail='';}
}
