// Regression tests for the orchestrator's cross-file pass on src/cli.ts
// (3.7.0 RC; SECURITY-AUDIT-3.6.2 L9 — git/editor/pager/Python hijack vars).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizedEnv} from '../src/cli';
import {hermesEnvKeyBlocked} from '../src/hermes';

test('git config, editor, pager and Python interpreter variables never reach a provider child',()=>{
 const env=sanitizedEnv({
  PATH:'/usr/bin',
  GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.sshCommand',GIT_CONFIG_VALUE_0:'touch /tmp/pwned',
  GIT_SSH_COMMAND:'touch /tmp/pwned',GIT_EXEC_PATH:'/tmp/evil',GIT_TEMPLATE_DIR:'/tmp/templates',GIT_PAGER:'touch /tmp/pwned',
  PAGER:'touch /tmp/pwned',EDITOR:'touch /tmp/pwned',VISUAL:'touch /tmp/pwned',
  UV_PYTHON:'/tmp/evil-python',VIRTUAL_ENV:'/tmp/venv',
  HTTPS_PROXY:'http://proxy.corp:8080',NODE_EXTRA_CA_CERTS:'/etc/ssl/corp.pem',
 });
 for(const key of ['GIT_CONFIG_COUNT','GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_SSH_COMMAND','GIT_EXEC_PATH','GIT_TEMPLATE_DIR','GIT_PAGER','PAGER','EDITOR','VISUAL','UV_PYTHON','VIRTUAL_ENV'])
  assert.equal(env[key],undefined,key+' must be stripped');
 assert.equal(env.HTTPS_PROXY,'http://proxy.corp:8080','enterprise proxies stay');
 assert.equal(env.NODE_EXTRA_CA_CERTS,'/etc/ssl/corp.pem','custom certificate bundles stay');
 assert.equal(env.PATH,'/usr/bin');
});

test('the Hermes .env filter blocks the same families (override semantics)',()=>{
 for(const key of ['GIT_CONFIG_KEY_0','GIT_CONFIG_VALUE_0','GIT_SSH_COMMAND','PAGER','EDITOR','VIRTUAL_ENV','UV_PYTHON'])
  assert.equal(hermesEnvKeyBlocked(key),true,key+' must not survive the .env copy');
 assert.equal(hermesEnvKeyBlocked('ANTHROPIC_API_KEY'),false,'provider sign-ins stay');
});