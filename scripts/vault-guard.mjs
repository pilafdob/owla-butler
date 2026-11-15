import {readFileSync} from 'node:fs';

export function vaultGuardInvariants(source) {
  const requiredRemoved = ['shell', 'write', 'edit', 'patch', 'webfetch', 'execute', 'subagent'];
  for (const tool of requiredRemoved) {
    if (!new RegExp('\\b' + tool + '\\b').test(source)) throw Error('Missing removed tool: ' + tool);
  }
  if (!/OWLA_WEB_SEARCH\s*!==\s*"1"/.test(source)) throw Error('Web search gating missing');
  if (!/mcp\.transform/.test(source)) throw Error('MCP removal missing');
  if (!/editor\.remove/.test(source)) throw Error('Tool removal missing');
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const source = readFileSync('src/opencode-plugin.ts', 'utf8');
  vaultGuardInvariants(source);
  console.log('vault guard ok');
}
