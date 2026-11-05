export function record(value:unknown):Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export function list(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
