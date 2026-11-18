import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sanitizedEnv,trustedComSpecPath} from '../src/cli';

for(const platform of ['darwin','win32'] as const){
 test(platform+': child environments remove execution overrides regardless of casing',()=>{
  const input={Path:'/bin',node_options:'--require /untrusted.js',PyThOnPaTh:'/untrusted',PYTHONHOME:'/untrusted',BASH_ENV:'/untrusted.sh',PERL5OPT:'-Muntrusted',HTTPS_PROXY:'http://enterprise-proxy',NODE_EXTRA_CA_CERTS:'/enterprise-ca.pem'};
  const clean=sanitizedEnv(input,{platform,keepCredentials:true});
  for(const key of ['node_options','PyThOnPaTh','PYTHONHOME','BASH_ENV','PERL5OPT'])assert.equal(clean[key],undefined,key);
  assert.equal(clean.Path,input.Path);
  assert.equal(clean.HTTPS_PROXY,input.HTTPS_PROXY);
  assert.equal(clean.NODE_EXTRA_CA_CERTS,input.NODE_EXTRA_CA_CERTS);
 });

 test(platform+': subscription-only children do not inherit unrelated service credentials',()=>{
  const input={github_token:'test-token',AWS_SECRET_ACCESS_KEY:'test-secret',NPM_TOKEN:'test-token',openai_base_url:'https://untrusted',OPENAI_API_KEY:'test-key'};
  const clean=sanitizedEnv(input,{platform});
  assert.deepEqual(clean,platform==='win32'?{ComSpec:trustedComSpecPath(input)}:{});
  // OpenCode deliberately accepts provider credentials; execution hooks are still stripped.
  assert.equal(sanitizedEnv({OPENAI_API_KEY:'test-key',NODE_OPTIONS:'--require /bad'},{platform,keepCredentials:true}).OPENAI_API_KEY,'test-key');
 });
}

test('Windows child environments have exactly one pinned ComSpec key',()=>{
 const input={COMSPEC:'C:\\Untrusted\\cmd.exe',cOmSpEc:'C:\\Other\\cmd.exe'};
 const clean=sanitizedEnv(input,{platform:'win32'});
 assert.deepEqual(Object.keys(clean).filter(key=>key.toLowerCase()==='comspec'),['ComSpec']);
 assert.equal(clean.ComSpec,trustedComSpecPath(input));
});
