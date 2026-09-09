import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=new URL('../',import.meta.url),require=createRequire(new URL('package.json',root));
const {build}=require('esbuild');
const {chromium}=await import(process.env.REFS_PLAYWRIGHT_MODULE||'playwright');
const fixture={fixed_asset_register_evidence_id:'asset-1',asset_tag:'Scope test asset',asset_class:'BUILDING',placed_in_service_date:'2026-07-01',currency:'USD',cost_basis:'25000.0000',accumulated_depreciation:'0.0000',accumulated_impairment:'0.0000',net_book_value:'25000.0000',posted_cost_balance:'25000.0000',salvage_value:'0.0000',useful_life_months:120,status:'ACTIVE'};
const row={ledger_line_id:'ledger-1',journal_entry_id:'journal-1',accounting_period_id:'source-period',journal_number:'ACQ-1',journal_date:'2026-07-02',account_code:'150100',currency:'USD',debit_amount:'25000.0000',credit_amount:'0.0000',source_binding_status:'EXACT_ACQUISITION_SOURCE',source_document_id:'source-1',source_payload_hash:'retained-hash',source_document_version:1};
const api=`const fixture=${JSON.stringify(fixture)},row=${JSON.stringify(row)};
export async function refreshAuthoritativeFixedAssets(){return {ok:true,data:{rows:[fixture],next_cursor:null}};}
export async function refreshAuthoritativeFixedAssetMovements(){return {ok:true,data:{rows:[row],next_cursor:null}};}
export function readAuthoritativeSourceDocumentDetail(){window.sourceReads=(window.sourceReads||0)+1;return new Promise(resolve=>{window.resolveSource=(patch={})=>resolve({ok:true,detail:{source_document_id:'source-1',payload_hash:'retained-hash',source_document_revision:1,currency:'USD',posted_journal_entry_ids:['journal-1'],...patch}});});}
export async function readAuthoritativeJournalEntryDetail(){throw new Error('Unexpected journal read');}
export async function readAuthoritativeAcquisitionOptions(){throw new Error('Unexpected options read');}
export async function readAuthoritativeDepreciationOptions(){throw new Error('Unexpected depreciation read');}
export async function createAuthoritativeAssetDepreciation(){throw new Error('Unexpected depreciation mutation');}
export async function createAuthoritativeAssetAcquisition(){throw new Error('Unexpected mutation');}`;
const lineage=`import React from 'react';export function AuthoritativeLineageDrill({config,onExit}){return <div role="region" aria-label="Opened source drill"><p>{config.periodId}</p><button onClick={onExit}>Close source drill</button></div>;}`;
const built=await build({stdin:{contents:`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AuthoritativeFixedAssetsWorkspace}from'./src/authoritative-fixed-assets-workspace.jsx';function Harness(){const[period,setPeriod]=useState('first-period');window.changePeriod=setPeriod;return <><p data-testid="period">{period}</p><AuthoritativeFixedAssetsWorkspace config={{tenantId:'tenant-1',entityId:'entity-1',periodId:period,baseUrl:'owned-mock',scopePresentation:{entityLabel:'Owned test company'}}}/></>;}createRoot(document.getElementById('app')).render(<Harness/>);`,resolveDir:fileURLToPath(root),loader:'jsx'},bundle:true,jsx:'automatic',write:false,format:'iife',platform:'browser',plugins:[{name:'owned-module-fixtures',setup(plugin){plugin.onResolve({filter:/accounting-api\.js$/},()=>({path:'api',namespace:'fixture'}));plugin.onResolve({filter:/authoritative-lineage-drill\.jsx$/},()=>({path:'lineage',namespace:'fixture'}));plugin.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='api'?api:lineage,loader:'jsx',resolveDir:fileURLToPath(root)}));}}]});
const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?built.outputFiles[0].text:'<!doctype html><div id="app"></div><script src="/app.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'View asset Scope test asset',exact:true}).click();
 const source=()=>page.getByRole('button',{name:'View posting source',exact:true}),drill=()=>page.getByRole('region',{name:'Opened source drill',exact:true});
 const originalSource=await source().elementHandle();await source().click();await page.waitForFunction(()=>window.sourceReads===1);
 await page.evaluate(()=>{window.lateSource=window.resolveSource;window.changePeriod('second-period');});
 await page.waitForFunction(()=>document.querySelector('[data-testid="period"]').textContent==='second-period');
 await page.waitForFunction(element=>!element.isConnected,originalSource);await source().waitFor();
 await page.evaluate(()=>window.lateSource());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await drill().count(),0,'late source response must not open the old drill');
 await source().click();await page.waitForFunction(()=>window.sourceReads===2);await page.evaluate(()=>window.resolveSource());await drill().waitFor();assert.match(await drill().innerText(),/source-period/);
 const originalDrill=await drill().elementHandle();await page.evaluate(()=>window.changePeriod('third-period'));
 await page.waitForFunction(()=>document.querySelector('[data-testid="period"]').textContent==='third-period');
 await page.waitForFunction(element=>!element.isConnected,originalDrill);await source().waitFor();assert.equal(await drill().count(),0,'period switch must close an already-open drill');
 for(const patch of [{payload_hash:'different-hash'},{source_document_revision:2},{currency:'CAD'},{posted_journal_entry_ids:[]}]){
  const before=await page.evaluate(()=>window.sourceReads);await source().click();await page.waitForFunction(count=>window.sourceReads===count,before+1);await page.evaluate(value=>window.resolveSource(value),patch);await page.getByRole('alert').waitFor();assert.match(await page.getByRole('alert').innerText(),/current source differs/);assert.equal(await drill().count(),0);
 }
 assert.deepEqual(errors,[]);
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'refs-asset-scope-'));await page.screenshot({path:path.join(output,'scope.png'),fullPage:true});
 await fs.writeFile(path.join(output,'result.json'),JSON.stringify({kind:'OWNED_MOCK_MODULE_COMPONENT_BROWSER_NOT_REAL_API',checks:['late source response ignored after same-company period change','matching source opens in retained row period','opened drill closes on period change','changed hash blocked','changed version blocked','changed currency blocked','missing posted journal membership blocked','no page errors']},null,2));
 console.log('PASS asset scope browser: 8 checks; mocked API and lineage renderer, not full source drill acceptance');console.log(output);
}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
