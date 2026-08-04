import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const root = dirname(fileURLToPath(import.meta.url));
mkdirSync('dist', { recursive: true });
const opts = {
  absWorkingDir:root, entryPoints:[join(root,'src/app.jsx')], bundle:true, outfile:join(root,'dist/bundle.js'),
  format:'iife', jsx:'automatic', loader:{'.js':'jsx','.jsx':'jsx'},
  minify:true, sourcemap:false, target:['es2020'], logLevel:'info',
};
if (process.argv.includes('--watch')) { const c=await esbuild.context(opts); await c.watch(); console.log('watching...'); }
else { await esbuild.build(opts); const sha=(process.env.GITHUB_SHA||'dev').slice(0,7); const bt=new Date().toISOString().slice(0,16).replace('T',' ');
  writeFileSync('dist/index.html', readFileSync('index.html','utf8').replace('bundle.js','bundle.js?b='+Date.now()).replace('</head>', `<script>window.__BUILD={sha:'${sha}',time:'${bt} UTC'};</script></head>`)); console.log('build done -> dist/'); }
