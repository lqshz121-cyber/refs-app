import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {readFixedAssetBrowserRepositoryState,verifyFixedAssetBrowserReceipt} from '../runtime/fixed-asset-browser-receipt.mjs';

test('browser runner resolves both release and cleanliness from its own repository',()=>{
 const calls=[],root=resolve('owned-repository'),sha='a'.repeat(40);
 const state=readFixedAssetBrowserRepositoryState(root,(file,args,options)=>{
  calls.push({file,args,options});
  return args[0]==='rev-parse'?sha+'\n':'';
 });
 assert.deepEqual(state,{sha,clean:true});
 assert.deepEqual(calls.map(call=>call.args),[['rev-parse','HEAD'],['status','--porcelain']]);
 assert.ok(calls.every(call=>call.file==='git'&&call.options.cwd===root&&call.options.encoding==='utf8'));
});

test('browser receipt rejects wrong release, dirty code, missing checks and detached screenshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'refs-asset-receipt-')),sha='a'.repeat(40),screenshots=[],images=new Map();
 try{
  for(const [name,width,height] of [['desktop.png',1280,900],['mobile.png',390,844]]){
   // Header-only fixture tests the receipt's PNG dimensions/hash checks, not image rendering.
   const bytes=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);await writeFile(join(dir,name),bytes);images.set(name,bytes);
   screenshots.push({name,viewport:{width,height},sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  const result={sha,passed:true,worktreeClean:true,browserBundleSha256:'b'.repeat(64),playwrightModule:'test-module',chromiumVersion:'test-version',reads:Array.from({length:8},()=>({method:'GET',status:200})),errors:[],screenshots,checks:['keyboard-detail-journal-gl-back','zoom-200','journal-drift-rejected','source-drift-rejected','date-scope','refresh','mobile-hidden-columns']};
  const save=value=>writeFile(join(dir,'result.json'),JSON.stringify(value));await save(result);await verifyFixedAssetBrowserReceipt(dir,sha);
  for(const patch of [{sha:'c'.repeat(40)},{worktreeClean:false},{checks:[]},{browserBundleSha256:'invalid'},{playwrightModule:''},{chromiumVersion:''},{screenshots:[]},{reads:[{method:'POST',status:200}]}]){await save({...result,...patch});await assert.rejects(verifyFixedAssetBrowserReceipt(dir,sha));}
  await save(result);const changed=Buffer.from(images.get('desktop.png'));changed[8]=1;await writeFile(join(dir,'desktop.png'),changed);await assert.rejects(verifyFixedAssetBrowserReceipt(dir,sha),/Screenshot changed/);await writeFile(join(dir,'desktop.png'),images.get('desktop.png'));
  await rm(join(dir,'mobile.png'));await assert.rejects(verifyFixedAssetBrowserReceipt(dir,sha));
 }finally{assert.equal(dirname(resolve(dir)),resolve(tmpdir()));assert.ok(basename(dir).startsWith('refs-asset-receipt-'));await rm(dir,{recursive:true,force:true});}
});
