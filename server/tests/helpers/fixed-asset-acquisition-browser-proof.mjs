import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const readBody=async request=>{
 const chunks=[];for await(const chunk of request)chunks.push(chunk);
 return chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):null;
};

export async function runFixedAssetAcquisitionBrowserProof({api,token,ids,uiPeriodId,assetId,assetTag,attachmentName,completeWorkflow}){
 const root=fileURLToPath(new URL('../../../',import.meta.url)),output=resolve(process.env.REFS_ASSET_ACQUISITION_BROWSER_OUTPUT||'');
 assert.ok(process.env.REFS_ASSET_ACQUISITION_BROWSER_OUTPUT,'Set a dedicated acquisition browser evidence directory');
 assert.notEqual(uiPeriodId,ids.periodId,'The browser must start in a different period to prove the handoff read');
 const require=createRequire(import.meta.url),playwrightModule=require.resolve(process.env.REFS_PLAYWRIGHT_MODULE||'playwright'),{chromium}=require(playwrightModule);
 const {build}=await import(new URL('../../../node_modules/esbuild/lib/main.js',import.meta.url));
 const boot={entityId:ids.entityId,periodId:uiPeriodId,token};
 const entry=`import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{AuthoritativeFixedAssetsWorkspace}from'./src/authoritative-fixed-assets-workspace.jsx';import{readAuthoritativeJournalEntryDetail,refreshCurrentActorAccess}from'./src/accounting-api.js';const base={...window.boot,baseUrl:location.origin,getAccessToken:async()=>window.boot.token};function App(){const[access,setAccess]=useState(null);useEffect(()=>{refreshCurrentActorAccess({config:base}).then(setAccess);},[]);if(!access)return <p>Loading fixture identity</p>;if(!access.ok)return <p role="alert">Identity unavailable</p>;const config={...base,tenantId:access.row.tenant_id,scopePresentation:{entityLabel:'Owned acquisition fixture'}};const open=async(receipt,explicitPeriodId)=>{const periodId=explicitPeriodId||receipt.period_id;const detail=await readAuthoritativeJournalEntryDetail({config:{...config,periodId},journalEntryId:receipt.journal_entry_id});window.handoff={receipt,periodId,detail};};window.actorAccess=access.row;return <AuthoritativeFixedAssetsWorkspace config={config} accessState={{status:'READY',row:access.row}} onOpenJournalWorkflow={open}/>;}createRoot(document.getElementById('root')).render(<App/>);`;
 const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',loader:{'.js':'jsx'}});
 const index=await readFile(resolve(root,'index.html'),'utf8'),styles=[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[0]).join('\n');
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script>window.boot=${JSON.stringify(boot).replace(/</g,'\\u003c')}</script><script src="/bundle.js"></script></body></html>`;
 const reads=[],writes=[],httpErrors=[];const server=createServer(async(request,response)=>{
  try{
   if(request.url==='/favicon.ico'){response.writeHead(204);response.end();return;}
   if(request.url==='/bundle.js'){response.setHeader('content-type','text/javascript');response.end(bundle.outputFiles[0].contents);return;}
   if(request.url?.startsWith('/api/')){
    assert.ok(['GET','POST'].includes(request.method),'Browser fixture issued an unexpected HTTP method');
    if(request.method==='POST')assert.match(request.url,/\/fixed-assets\/register\/[0-9a-f-]+\/acquisitions$/i,'Browser fixture may only write one acquisition Draft');
    const raw=await api({method:request.method,url:request.url,headers:request.headers,body:request.method==='POST'?await readBody(request):null}),result=JSON.parse(JSON.stringify(raw)),record={method:request.method,path:request.url,status:result.status};
    (request.method==='GET'?reads:writes).push(record);response.writeHead(result.status,result.headers);response.end(JSON.stringify(result.body));return;
   }
   response.setHeader('content-type','text/html');response.end(html);
  }catch(error){httpErrors.push(error.message);response.writeHead(500,{'content-type':'application/json'});response.end(JSON.stringify({ok:false,error:error.message}));}
 });
 await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));let browser;
 try{
  await mkdir(output,{recursive:true});browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],screenshots=[],checks=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port);const asset=page.getByRole('button',{name:'View asset '+assetTag,exact:true});await asset.waitFor();
  await page.getByLabel('As of date',{exact:true}).fill('2026-07-31');await asset.waitFor();await asset.click();await page.getByRole('heading',{name:assetTag,exact:true}).waitFor();checks.push('real-register-list-and-detail');
  await page.getByRole('button',{name:'Record acquisition',exact:true}).click();await page.getByRole('heading',{name:'Invoice attachments',exact:true}).waitFor();await page.getByText(attachmentName,{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Accounting date',{exact:true}).inputValue(),'2026-07-01');assert.ok(await page.getByText('2026-07',{exact:true}).count()>=1);checks.push('real-options-and-source-date');
  await page.getByLabel('Journal number',{exact:true}).fill('BROWSER-ASSET-1');await page.getByLabel('Accounting date',{exact:true}).fill('2026-07-02');await page.getByLabel('Explanation',{exact:true}).fill('Acquire reviewed building through the real browser and accounting API.');
  await page.getByRole('button',{name:'Save acquisition draft',exact:true}).dblclick();await page.getByRole('heading',{name:'Acquisition draft saved',exact:true}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].status,201);checks.push('single-real-post-under-double-click');
  await page.getByRole('button',{name:'Open journal',exact:true}).click();await page.waitForFunction(()=>window.handoff?.detail?.ok===true);const handoff=await page.evaluate(()=>window.handoff),actorAccess=await page.evaluate(()=>window.actorAccess);
  assert.equal(handoff.periodId,ids.periodId);assert.notEqual(handoff.periodId,uiPeriodId);assert.equal(handoff.receipt.journal_entry_id,handoff.detail.journal.journal_entry_id);assert.equal(handoff.detail.journal.period_id,ids.periodId);assert.equal(handoff.detail.journal.status,'DRAFT');
  assert.ok(reads.some(read=>read.path.includes('/journal-entries/'+handoff.receipt.journal_entry_id)&&read.path.includes('periodId='+ids.periodId)));checks.push('cross-period-fresh-journal-read');
  const capture=async name=>{const bytes=await page.screenshot({path:resolve(output,name),fullPage:true});screenshots.push({name,viewport:page.viewportSize(),sha256:createHash('sha256').update(bytes).digest('hex')});};await capture('draft-desktop.png');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push('mobile-no-horizontal-overflow');await capture('draft-mobile.png');
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.equal(writes.length,1);assert.ok(reads.some(read=>read.path.endsWith('/access/self')));assert.ok(reads.some(read=>/\/fixed-assets\/register\?/.test(read.path)));assert.ok(reads.some(read=>new RegExp('/fixed-assets/register/'+assetId+'\\?').test(read.path)));assert.ok(reads.some(read=>read.path.endsWith('/fixed-assets/register/'+assetId+'/acquisition-options')));
  const business=await completeWorkflow({journalEntryId:handoff.receipt.journal_entry_id,periodId:handoff.periodId,actorAccess,browserDraft:handoff.detail.journal});
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  await writeFile(resolve(output,'result.json'),JSON.stringify({kind:'OWNED_POSTGRES_ACQUISITION_BROWSER_E2E',sha,playwrightModule,chromiumVersion:browser.version(),screenshots,checks,worktreeClean:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()==='',browserBundleSha256:createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),scope:'Owned PostgreSQL, real accounting API handler and HTTP, isolated Chromium, and test-only authenticated maker identity. This is not production OIDC or deployed full-app acceptance.',passed:true,ui_period_id:uiPeriodId,journal_period_id:handoff.periodId,actor_access:actorAccess,reads,writes,errors,http_errors:httpErrors,business},null,2)+'\n');
 }finally{if(browser)await browser.close();await new Promise(close=>server.close(close));}
}
