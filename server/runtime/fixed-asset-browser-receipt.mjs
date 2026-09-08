import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export async function verifyFixedAssetBrowserReceipt(output,expectedSha){
 const result=JSON.parse(await readFile(resolve(output,'result.json'),'utf8'));
 assert.equal(result.passed,true);assert.equal(result.sha,expectedSha);assert.equal(result.worktreeClean,true);
 assert.match(result.browserBundleSha256||'',/^[a-f0-9]{64}$/);
 assert.ok(typeof result.playwrightModule==='string'&&result.playwrightModule.length>0);
 assert.ok(typeof result.chromiumVersion==='string'&&result.chromiumVersion.length>0);
 assert.ok(Array.isArray(result.reads)&&result.reads.length>=8&&result.reads.every(read=>read.method==='GET'&&read.status===200));
 assert.deepEqual(result.errors,[]);
 for(const check of ['keyboard-detail-journal-gl-back','zoom-200','journal-drift-rejected','source-drift-rejected','date-scope','refresh','mobile-hidden-columns'])assert.ok(result.checks?.includes(check),'Missing browser check: '+check);
 assert.equal(result.screenshots?.length,2);
 for(const [name,width,height] of [['desktop.png',1280,900],['mobile.png',390,844]]){
  const item=result.screenshots.find(image=>image.name===name);assert.ok(item,'Missing screenshot: '+name);
  assert.deepEqual(item.viewport,{width,height});assert.match(item.sha256||'',/^[a-f0-9]{64}$/);
  const bytes=await readFile(resolve(output,name));assert.ok(bytes.length>=24);assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),width);assert.ok(bytes.readUInt32BE(20)>=height);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'Screenshot changed: '+name);
 }
 return result;
}
