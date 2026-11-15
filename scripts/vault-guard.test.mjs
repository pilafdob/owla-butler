import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {vaultGuardInvariants} from './vault-guard.mjs';

const source = readFileSync('src/opencode-plugin.ts', 'utf8');
assert.doesNotThrow(() => vaultGuardInvariants(source));
assert.throws(() => vaultGuardInvariants(''), /Missing removed tool/);
console.log('vault guard tests ok');
