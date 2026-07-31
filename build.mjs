import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
mkdirSync('dist', { recursive: true });
const opts = {
  entryPoints:['src/app.jsx'], bundle:true, outfile:'dist/bundle.js',
  format:'iife', jsx:'automatic', loader:{'.js':'jsx','.jsx':'jsx'},
  minify:true, sourcemap:false, target:['es2020'], logLevel:'info',
};
if (process.argv.includes('--watch')) { const c=await esbuild.context(opts); await c.watch(); console.log('watching...'); }
else { await esbuild.build(opts); writeFileSync('dist/index.html', readFileSync('index.html','utf8').replace('bundle.js','bundle.js?b='+Date.now())); console.log('build done -> dist/'); }
