import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

export async function runFixedAssetBrowserProof({api,token,ids,assetTag}){
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const output=resolve(process.env.REFS_ASSET_BROWSER_OUTPUT||'');
 assert.ok(process.env.REFS_ASSET_BROWSER_OUTPUT,'Set a dedicated browser evidence directory');
 const require=createRequire(import.meta.url),{chromium}=require(process.env.REFS_PLAYWRIGHT_MODULE||'playwright');
 const {build}=await import(new URL('../../../node_modules/esbuild/lib/main.js',import.meta.url));
 const boot={entityId:ids.entityId,periodId:ids.periodId,token};
 const entry=`import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {AuthoritativeFixedAssetsWorkspace} from './src/authoritative-fixed-assets-workspace.jsx';import {refreshCurrentActorAccess} from './src/accounting-api.js';const base={...window.boot,baseUrl:location.origin,getAccessToken:async()=>window.boot.token};function App(){const [access,setAccess]=useState(null);useEffect(()=>{refreshCurrentActorAccess({config:base}).then(setAccess);},[]);return access?.ok?<AuthoritativeFixedAssetsWorkspace config={{...base,tenantId:access.row.tenant_id,scopePresentation:{entityLabel:'Owned asset fixture'}}}/>:<p>Loading fixture identity</p>;}createRoot(document.getElementById('root')).render(<App/>);`;
 const bundle=await build({stdin:{contents:entry,resolveDir:root,loader:'jsx'},bundle:true,write:false,platform:'browser',jsx:'automatic',loader:{'.js':'jsx'}});
 const index=await readFile(resolve(root,'index.html'),'utf8'),styles=[...index.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[0]).join('\n');
 const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}</head><body><div id="root"></div><script>window.boot=${JSON.stringify(boot).replace(/</g,'\\u003c')}</script><script src="/bundle.js"></script></body></html>`;
 const reads=[],server=createServer(async(req,res)=>{
  try{
   if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return;}
   if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(bundle.outputFiles[0].contents);return;}
   if(req.url?.startsWith('/api/')){
    assert.equal(req.method,'GET','Browser fixture may only read accounting data');
    const result=await api({method:req.method,url:req.url,headers:req.headers});reads.push({method:req.method,path:req.url,status:result.status});
    res.writeHead(result.status,{'content-type':'application/json',...result.headers});res.end(JSON.stringify(result.body));return;
   }
   res.setHeader('content-type','text/html');res.end(html);
  }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));let browser;
 try{
  await mkdir(output,{recursive:true});browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const url='http://127.0.0.1:'+server.address().port;await page.goto(url);
  const asset=()=>page.getByRole('button',{name:'View asset '+assetTag,exact:true});await asset().click();await page.getByRole('heading',{name:assetTag,exact:true}).waitFor();
  await page.getByRole('region',{name:'Posted asset activity',exact:true}).waitFor();
  const acquisition=()=>page.getByRole('button',{name:'ASSET-ACQUISITION',exact:true}).first();await acquisition().click();await page.getByRole('heading',{name:'Journal entry ASSET-ACQUISITION',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open GL evidence',exact:true}).first().click();await page.getByRole('heading',{name:'Posted ledger line',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to prior evidence',exact:true}).click();await page.getByRole('button',{name:'Back to prior evidence',exact:true}).click();assert.equal(await acquisition().evaluate(el=>el===document.activeElement),true);
  const source=()=>page.getByRole('button',{name:'View posting source',exact:true}).first();await source().click();await page.getByRole('heading',{name:'Source Document evidence',exact:true}).waitFor();
  await page.getByRole('button',{name:'Open linked Journal',exact:true}).first().click();await page.getByRole('region',{name:'Journal lineage evidence',exact:true}).waitFor();
  await page.getByRole('button',{name:'Back to prior evidence',exact:true}).click();await page.getByRole('button',{name:'Back to prior evidence',exact:true}).click();assert.equal(await source().evaluate(el=>el===document.activeElement),true);
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Close details',exact:true}).click();assert.equal(await asset().evaluate(el=>el===document.activeElement),true);
  await page.locator('input[type=date]').fill('2026-07-14');await asset().click();await page.getByRole('region',{name:'Posted asset activity',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Posted asset activity',exact:true}).locator('tbody tr').count(),2);
  await page.locator('input[type=date]').fill('2026-07-31');await asset().click();await page.getByRole('region',{name:'Posted asset activity',exact:true}).waitFor();assert.equal(await page.getByRole('region',{name:'Posted asset activity',exact:true}).locator('tbody tr').count(),11);
  await page.reload();await asset().waitFor();
  assert.deepEqual(errors,[]);assert.ok(reads.length>=8);assert.ok(reads.every(read=>read.status===200));
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  await writeFile(resolve(output,'result.json'),JSON.stringify({sha,worktreeClean:execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()==='',browserBundleSha256:createHash('sha256').update(bundle.outputFiles[0].contents).digest('hex'),scope:'Owned PostgreSQL, real accounting API handler and HTTP, isolated Chromium. Test-only authenticated identity; not production OIDC or deployed full-app acceptance.',passed:true,reads,errors},null,2)+'\n');
 }finally{if(browser)await browser.close();await new Promise(close=>server.close(close));}
}
