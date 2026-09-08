import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyFixedAssetAcquisitionBrowserReceipt} from '../runtime/fixed-asset-acquisition-browser-receipt.mjs';

test('acquisition browser receipt binds the release, real HTTP write, cross-period read, identity and report result',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'refs-asset-acquisition-receipt-')),sha='a'.repeat(40),screenshots=[];
 try{
  for(const [name,width,height] of [['draft-desktop.png',1280,900],['draft-mobile.png',390,844]]){const bytes=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);await writeFile(join(dir,name),bytes);screenshots.push({name,viewport:{width,height},sha256:createHash('sha256').update(bytes).digest('hex')});}
  const result={kind:'OWNED_POSTGRES_ACQUISITION_BROWSER_E2E',passed:true,sha,worktreeClean:true,browserBundleSha256:'b'.repeat(64),playwrightModule:'owned-playwright',chromiumVersion:'owned-chromium',scope:'Owned test; not production OIDC.',ui_period_id:'ui',journal_period_id:'journal',actor_access:{permissions:['GL.JE.VIEW','FIXED_ASSET.REGISTER.VIEW','GL.JE.CREATE'],session_refresh_required:false},reads:[{method:'GET',status:200,path:'/access/self'},{method:'GET',status:200,path:'/fixed-assets/register?'},{method:'GET',status:200,path:'/fixed-assets/register/id?'},{method:'GET',status:200,path:'/acquisition-options'},{method:'GET',status:200,path:'/journal-entries/id'}],writes:[{method:'POST',status:201,path:'/acquisitions'}],checks:['real-register-list-and-detail','real-options-and-source-date','single-real-post-under-double-click','cross-period-fresh-journal-read','mobile-no-horizontal-overflow'],errors:[],http_errors:[],screenshots,business:{period_id:'journal',status:'POSTED',ledger_line_count:2}};
  const save=value=>writeFile(join(dir,'result.json'),JSON.stringify(value));await save(result);await verifyFixedAssetAcquisitionBrowserReceipt(dir,sha);
  for(const patch of [{sha:'c'.repeat(40)},{worktreeClean:false},{ui_period_id:'journal'},{writes:[]},{reads:[]},{checks:[]},{actor_access:{permissions:['GL.JE.POST'],session_refresh_required:false}},{business:{period_id:'journal',status:'APPROVED',ledger_line_count:0}}]){await save({...result,...patch});await assert.rejects(verifyFixedAssetAcquisitionBrowserReceipt(dir,sha));}
 }finally{await rm(dir,{recursive:true,force:true});}
});
