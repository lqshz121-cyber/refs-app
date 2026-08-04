import * as esbuild from 'esbuild';
import { copyFileSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execFileSync } from 'child_process';

mkdirSync('dist', {recursive:true});
const buildTime=new Date().toISOString();
let buildSha=process.env.GITHUB_SHA?.slice(0,7);
if(!buildSha){
  try{buildSha=execFileSync('git',['rev-parse','--short=7','HEAD'],{encoding:'utf8'}).trim();}
  catch{throw new Error('Build provenance unavailable: inject a valid GITHUB_SHA or build from a trusted Git worktree.');}
}
if(!/^[0-9a-f]{7}$/i.test(buildSha))throw new Error(`Invalid build SHA: ${buildSha||'missing'}`);

const opts={
  entryPoints:['src/app.jsx'],bundle:true,outfile:'dist/bundle.js',format:'iife',jsx:'automatic',
  loader:{'.js':'jsx','.jsx':'jsx'},
  define:{__REFS_BUILD_SHA__:JSON.stringify(buildSha),__REFS_BUILD_TIME__:JSON.stringify(buildTime)},
  minify:true,sourcemap:false,target:['es2020'],logLevel:'info',
};

if(process.argv.includes('--watch')){
  const context=await esbuild.context(opts);
  await context.watch();
  console.log('watching...');
}else{
  await esbuild.build(opts);
  copyFileSync('refs-runtime-lock.js','dist/refs-runtime-lock.js');
  copyFileSync('refs-runtime-config.js','dist/refs-runtime-config.js');
  writeFileSync('dist/refs-build.js',`window.__BUILD=${JSON.stringify({sha:buildSha,time:buildTime})};\n`);
  const html=readFileSync('index.html','utf8')
    .replace('bundle.js','bundle.js?b='+Date.now())
    .replace('</head>','<script src="./refs-build.js"></script></head>');
  writeFileSync('dist/index.html',html);
  console.log(`build done -> dist/ (${buildSha} · ${buildTime})`);
}
