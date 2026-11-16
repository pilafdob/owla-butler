/**
 * Per-reply tool budget and repeat detection. A model that cannot make
 * progress (for example re-reading the same opening of a long note) is told so,
 * then told to answer, and finally stopped, instead of looping for minutes.
 */
export const MAX_TOOL_CALLS=40;
export const MAX_TOOL_CALLS_HARD=50;

export class ToolGuard {
 private calls=0;
 private results=new Map<string,{result:string;count:number}>();
 constructor(private soft=MAX_TOOL_CALLS,private hard=MAX_TOOL_CALLS_HARD){}
 /** Starts a fresh budget, e.g. for an automatic retry on another model. */
 reset(){this.calls=0;this.results.clear();}
 /** Counts a call. 'stop' ends the reply; an Error is returned to the model instead of running the tool. */
 before():'ok'|'stop'|Error{
  this.calls++;
  if(this.calls>this.hard)return 'stop';
  if(this.calls>this.soft)return Error('This reply has used '+this.soft+' tool calls. Do not call more tools. Answer now with what you have and say what is still missing.');
  return 'ok';
 }
 /** Records a result; the third identical result of an identical call becomes an error. */
 after(name:string,args:unknown,result:string):Error|null{
  const key=name+'\u0000'+JSON.stringify(args??null);
  const seen=this.results.get(key);
  if(seen?.result===result){
   seen.count++;
   if(seen.count>=2)return Error('This exact call already returned the same result. Use that result, read a different heading or offset, or answer now.');
  }else this.results.set(key,{result,count:0});
  return null;
 }
}
