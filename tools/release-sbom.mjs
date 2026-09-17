#!/usr/bin/env node
// O12 / A11: produce a CycloneDX SBOM for the root (client) and server packages with `npm sbom` (npm ≥ 9.7),
// production dependencies only, and stamp them with the git SHA. Output: <outDir>/sbom-root.cdx.json, sbom-server.cdx.json,
// sbom-manifest.json (sha256 of each). Exit 0 only when both SBOMs were produced from a consistent node_modules
// (`npm ci` first); ESBOMPROBLEMS (missing/extraneous packages) is a real finding, not noise.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
const outDir=process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:resolve(root,'outputs','release');
mkdirSync(outDir,{recursive:true});
const sha=(()=>{try{return execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch{return 'unknown';}})();
const results=[];
for(const [name,cwd] of [['root',root],['server',resolve(root,'server')]]){
  const target=resolve(outDir,`sbom-${name}.cdx.json`);
  try{
    const out=execFileSync('npm',['sbom','--sbom-format','cyclonedx','--omit','dev'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024});
    const bom=JSON.parse(out);bom.metadata=bom.metadata||{};bom.metadata.properties=[...(bom.metadata.properties||[]),{name:'refs:git_sha',value:sha}];
    const text=JSON.stringify(bom,null,2);writeFileSync(target,text);
    results.push({package:name,ok:true,file:target,components:bom.components?.length??0,sha256:createHash('sha256').update(text).digest('hex')});
  }catch(error){results.push({package:name,ok:false,file:target,error:String(error.stderr||error.message).split('\n').filter(Boolean).slice(0,3).join(' | ')});}
}
const manifest={schema_version:'REFS_RELEASE_SBOM_MANIFEST_V1',git_sha:sha,generated_at:new Date().toISOString(),results};
writeFileSync(resolve(outDir,'sbom-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
process.exitCode=results.every(r=>r.ok)?0:3;
