import * as esbuild from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const root = dirname(fileURLToPath(import.meta.url));
mkdirSync('dist', { recursive: true });
const opts = {
  absWorkingDir:root, entryPoints:[join(root,'src/app.jsx')], bundle:true, outfile:join(root,'dist/bundle.js'),
  format:'iife', jsx:'automatic', loader:{'.js':'jsx','.jsx':'jsx'},
  minify:true, sourcemap:false, target:['es2020'], logLevel:'info',
};
const writeStaticShell=()=>{ const candidateSha=process.env.GITHUB_SHA||process.env.RENDER_GIT_COMMIT||'dev',sha=/^[0-9a-f]{40}$/i.test(candidateSha)?candidateSha.toLowerCase():'dev',bt=new Date().toISOString().slice(0,16).replace('T',' '),cacheKey=Date.now();
  // Anchor the cache key to the script src attribute, never to a bare filename.
  // A plain string .replace() rewrites the FIRST occurrence in the document, and
  // index.html mentions these filenames in prose comments above the tags: the
  // bundle.js key used to land inside the Chart.js comment while the real
  // <script src="./bundle.js"> shipped unkeyed. bundle.js is the one asset with
  // no no-store header, so an unkeyed tag lets a cached stale bundle run beside
  // a fresh index.html and refs-build.js.
  writeFileSync('dist/index.html',readFileSync('index.html','utf8').replace(/src="\.\/(refs-build\.js|refs-runtime-config\.js|bundle\.js)"/g,(_match,asset)=>`src="./${asset}?b=${cacheKey}"`));
  writeFileSync('dist/refs-build.js',`window.__BUILD=${JSON.stringify({sha,time:`${bt} UTC`})};\n`,{encoding:'utf8'});
  copyFileSync(join(root,'refs-runtime-lock.js'),join(root,'dist/refs-runtime-lock.js'));
  copyFileSync(join(root,'refs-boot-guard.js'),join(root,'dist/refs-boot-guard.js'));
  copyFileSync(join(root,'refs-runtime-config.js'),join(root,'dist/refs-runtime-config.js'));
};
if (process.argv.includes('--watch')) { writeStaticShell(); const c=await esbuild.context(opts); await c.watch(); console.log('watching...'); }
else { await esbuild.build(opts); writeStaticShell(); console.log('build done -> dist/'); }
