import {homedir} from 'node:os';
export function record(value:unknown):Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export function list(value:unknown):unknown[]{return Array.isArray(value)?value:[];}

const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/**
 * Credential and path redaction for any provider error detail that reaches
 * chat or status (SECURITY-AUDIT-3.6.2 L15). On Windows the same home path
 * arrives in several spellings: forward slashes from Node/Python URLs, another
 * case from the registry, the `\\?\` extended-length prefix, an 8.3 short name,
 * or a UNC profile path. All of them name the user's private files; UNC paths
 * also leak server and share names. POSIX keeps the exact-home replacement.
 * Shared by every bridge so the Windows shapes are redacted everywhere.
 */
export function redactErrorDetail(text:string,home=homedir(),platform:NodeJS.Platform=process.platform):string{
 let out=text.replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [redacted]')
  .replace(/\b((?:access|refresh)[_-]?token|token|api[_-]?key|authorization|password|secret)\s*[:=]\s*["']?[^\s"',}]+/gi,'$1=[redacted]');
 if(platform==='win32'){
  // `\\?\C:\…` and `\\.\C:\…` spell the same drive path; `\\?\UNC\…` a UNC one.
  out=out.replace(/\\\\\?\\UNC\\/gi,'\\\\').replace(/\\\\[?.]\\(?=[a-z]:)/gi,'');
  // UNC paths (both separator spellings) never belong in chat; a scheme's
  // '://' is a URL, not a UNC path, and stays readable. The exemption applies
  // only to the '//' side: a backslash UNC after a colon ('path:\\server\…')
  // is still a UNC path and must be redacted.
  out=out.replace(/(?:\\\\|(?<!:)\/\/)[a-z0-9._-]+[\\/][^\s"'<>:|?*]+(?:[\\/][^\s"'<>]*)?/gi,'[redacted-path]');
  const segments=home.split(/[\\/]+/).filter(Boolean).map(escapeRegExp);
  // The boundary keeps the home rule from matching the FILIP prefix of an 8.3
  // short name (FILIP~1); the generic Users rule below redacts those whole.
  if(segments.length)out=out.replace(new RegExp(segments.join('[\\\\/]+')+'(?=[\\\\/\\s"\'<>:]|$)','gi'),'~');
  // Any other profile under \Users\<name>: other users and 8.3 short spellings.
  out=out.replace(/\b[a-z]:[\\/]+users[\\/]+[^\\/\s"'<>:|?*]+/gi,'~');
 }
 return out.split(home).join('~');
}

/**
 * Tool results are vault content — untrusted. A structural delimiter plus the
 * standing rule in the prompt keeps instructions injected into a note from
 * reading as OWLA's own guidance (round-1 security recommendation, §5.6).
 * An embedded closing tag is escaped so content cannot pose as the boundary.
 */
export function untrustedToolText(text:string):string{
 return '<untrusted_content>\n'+text.replace(/<\/untrusted_content>/gi,'<\\/untrusted_content>')+'\n</untrusted_content>';
}
