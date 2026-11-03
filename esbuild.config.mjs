import esbuild from 'esbuild';
await esbuild.build({entryPoints:['src/main.ts'],bundle:true,platform:'node',format:'cjs',target:'es2022',external:['obsidian','electron'],outfile:'main.js',logLevel:'info'});
