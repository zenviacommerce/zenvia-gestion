import {build} from 'esbuild';
import {copyFile,mkdir} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
await build({entryPoints:['src/index.ts'],outfile:'dist/index.js',bundle:true,format:'esm',platform:'browser',target:['es2018','safari13'],jsx:'automatic',external:['react','react/*','lucide-react'],minify:false});
await Promise.all(['styles.css','forms.css'].map(name=>copyFile('src/'+name,'dist/'+name)));
