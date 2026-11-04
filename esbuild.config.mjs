import esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

// Community installs receive only three files. Preserve all redistributed
// licences alongside the code, embedded skills and bird icon in main.js.
const notices = ['LICENSE', 'assets/PHOSPHOR-LICENSE',
  'assets/skills/OBSIDIAN-SKILLS-LICENSE', 'assets/DIFF-LICENSE'];
const licenseBanner = '/*\n' + notices.map(path => path + ':\n' +
  readFileSync(new URL('./' + path, import.meta.url), 'utf8')).join('\n')
  .replace(/\*\//g, '* /') + '\n*/';
await esbuild.build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',external:['obsidian','electron'],outfile:'main.js',banner:{js:licenseBanner},logLevel:'info'});
