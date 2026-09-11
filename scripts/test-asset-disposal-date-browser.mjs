import assert from 'node:assert/strict';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const {chromium}=await import(process.env.REFS_PLAYWRIGHT_MODULE||'playwright');

// Component-only fixtures: these prove UI request handling, not ledger acceptance.
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=date=>({readiness_status:'READY',snapshot:{asset_tag:'Building',period:{period_code:'2026-07'},disposal_date:date,currency:'USD',cost_basis:'100.0000',accumulated_depreciation:'0.0000',accumulated_impairment:'0.0000',carrying_value:'100.0000',asset_account_code:'150100',accumulated_depreciation_account_code:'159100'},sources:[{source_document_id:'source-'+date,document_no:'Disposal '+date,business_date:date,gross_amount:'0.0000'}],proceeds_accounts:[],members:[],gain_loss_accounts:[{account_code:'680000',account_name:'Disposal loss'}],pending_journals:[]});
const bundle=await build({stdin:{contents:`import React from 'react';import{createRoot}from'react-dom/client';import{AuthoritativeAssetDisposal}from'./src/authoritative-asset-disposal.jsx';
 const fixture=${fixture.toString()};window.calls=[];window.pending=[];window.defer=false;
 const readOptions=({disposalDate})=>{window.calls.push(disposalDate);return window.defer?new Promise(resolve=>window.pending.push(()=>resolve({ok:true,data:fixture(disposalDate)}))):Promise.resolve({ok:true,data:fixture(disposalDate)});};
 window.saved=[];const createDraft=async request=>{window.saved.push({date:request.options.snapshot.disposal_date,source:request.sourceDocumentId});return {ok:true,data:{journal_entry_id:'journal',period_id:'period',proceeds:'0.0000',gain_or_loss:'-100.0000'}};};
 createRoot(document.getElementById('app')).render(<AuthoritativeAssetDisposal config={{baseUrl:location.origin,tenantId:'tenant',entityId:'entity',periodId:'period'}} assetId="asset" disposalDate="2026-07-01" readOptions={readOptions} createDraft={createDraft}/>);`,resolveDir:root,loader:'jsx'},bundle:true,jsx:'automatic',write:false,format:'iife',platform:'browser'});
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><html><body><main id="app"></main><script src="/app.js"></script></body></html>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('BROWSER',e.message);});
 const open=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'Record disposal',exact:true}).click();await page.getByRole('button',{name:'Save disposal draft',exact:true}).waitFor({timeout:5000}).catch(async e=>{console.error(await page.locator('body').innerText());throw e;});};
 const save=()=>page.getByRole('button',{name:'Save disposal draft',exact:true});
 await open();
 await page.getByLabel('Disposal date',{exact:true}).fill('2026-07-02');
 assert.equal(await save().count(),0,'Changing date must discard the previous date snapshot before any save');
 assert.deepEqual(await page.evaluate(()=>window.saved),[]);
 await page.getByRole('button',{name:'Load date',exact:true}).click();await save().waitFor();
 await page.getByLabel('Explanation',{exact:true}).fill('Dispose on the selected date');await save().click();
 await page.getByRole('heading',{name:'Disposal draft saved'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Disposal draft saved'}).evaluate(element=>element===document.activeElement),true,'A confirmed disposal draft must move keyboard focus to its result heading');
 assert.deepEqual(await page.evaluate(()=>window.saved),[{date:'2026-07-02',source:'source-2026-07-02'}]);
 console.log('PASS date edit requires fresh evidence and saves the newly loaded date/source');

 await open();await page.evaluate(()=>window.defer=true);
 await page.getByRole('button',{name:'Load date',exact:true}).click();
 await page.getByLabel('Disposal date',{exact:true}).fill('2026-07-03');
 await page.getByRole('button',{name:'Load date',exact:true}).click();
 await page.evaluate(()=>window.pending[1]());await save().waitFor();
 await page.evaluate(()=>window.pending[0]());
 await page.getByLabel('Explanation',{exact:true}).fill('Keep the newest date snapshot');await save().click();
 await page.getByRole('heading',{name:'Disposal draft saved'}).waitFor();
 assert.deepEqual(await page.evaluate(()=>window.saved),[{date:'2026-07-03',source:'source-2026-07-03'}]);
 console.log('PASS late old-date response cannot replace the newer snapshot');

 await open();await page.evaluate(()=>window.defer=true);await page.getByRole('button',{name:'Load date',exact:true}).click();
 await page.getByLabel('Disposal date',{exact:true}).fill('');await page.evaluate(()=>window.pending[0]());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await save().count(),0,'A late response must not restore an emptied date');
 assert.equal(await page.getByRole('button',{name:'Load date',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Close disposal',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Record disposal',exact:true}).evaluate(el=>el===document.activeElement),true);
 assert.deepEqual(errors,[]);console.log('PASS empty date rejects late response; closing returns focus; no browser errors');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
