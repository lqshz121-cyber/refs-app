import {prepareSalesBankMatch} from '__API__';import {readSalesBankIntent,reserveSalesBankIntent,releaseSalesBankIntent,salesBankIntentKey} from '__RECOVERY__';import React from 'react';import {createRoot} from 'react-dom/client';import {SalesReceiptBankMatch} from '__COMPONENT__';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const config={baseUrl:'https://fixture.example',entityId:id(1),periodId:id(2),getAccessToken:async()=>'fixture-token-'.repeat(4)};
const bank={bank_source_id:id(3),bank_account_ref:'BANK-1',version:0,currency:'USD',amount:'1.2345',bank_match_id:null};
const candidate=n=>({sales_receipt_id:id(100+n),receipt_revision:'1',receipt_number:'SALE-'+n,period_id:id(2),customer_ref:'CUST-1',customer_name:'Customer One',bank_member_ref:'BANK-1',cash_account_code:'111001',accounting_date:'2026-07-15',currency:'USD',amount:'1.2345',journal_entry_id:id(200+n),journal_revision:'4',journal_line_id:id(300+n),ledger_line_id:id(400+n),date_delta_days:0});
const rows=Array.from({length:25},(_,i)=>candidate(i+1)),chosen=candidate(26);let actor='matcher',posts=[],reads=[],refreshes=0;
const receipt={bank_match_id:id(500),bank_source_id:bank.bank_source_id,sales_receipt_id:chosen.sales_receipt_id,journal_entry_id:chosen.journal_entry_id,journal_line_id:chosen.journal_line_id,ledger_line_id:chosen.ledger_line_id,status:'ACTIVE',revision:0,idempotent:true};
const response=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});

const phase=new URL(location.href).searchParams.get('phase'),checks={},scope={config,bankSourceId:bank.bank_source_id,actorId:'matcher'};
const assert=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name);};
const proof=command=>({key:command.idempotencyKey,body:JSON.stringify(command.body),version:'"'+command.bankRevision+'"'});
const fetcher=async(url,options)=>{
 if(url.endsWith('/access/self'))return response({tenant_id:id(9),entity_id:config.entityId,actor_id:actor,grant_set_version:1,permissions:['BANK.MATCH.CREATE'],configured_permissions:['BANK.MATCH.CREATE'],session_refresh_required:false});
 if(options.method==='GET'){reads.push(url);return response({schema_version:'SALES_RECEIPT_BANK_CANDIDATES_V1',entity_id:config.entityId,bank_source_id:bank.bank_source_id,bank_revision:'0',after_id:null,limit:25,rows:[chosen],next_id:null});}
 const saved=await readSalesBankIntent(scope);assert('intentSavedBeforePOST',saved?.command.idempotencyKey===options.headers['idempotency-key']);
 posts.push({key:options.headers['idempotency-key'],body:options.body,version:options.headers['if-match']});
 if(phase==='prepare')throw Error('Response lost after commit');return response(receipt);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),root=createRoot(document.getElementById('root'));
const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);
const wait=async predicate=>{for(let i=0;i<160;i++){if(await predicate())return;await sleep(25);}throw Error('Timed out: '+predicate);};
const active={...bank,bank_match_id:receipt.bank_match_id,match_status:'ACTIVE',match_source_kind:'SALES_RECEIPT',sales_receipt_id:chosen.sales_receipt_id,journal_entry_id:chosen.journal_entry_id,journal_line_id:chosen.journal_line_id,ledger_line_id:chosen.ledger_line_id};
const render=()=>root.render(<SalesReceiptBankMatch config={config} row={phase==='prepare'?bank:active} recoveryOnly={phase!=='prepare'} fetcher={fetcher} onChanged={async()=>({ok:true,rows:[active]})}/>);
(async()=>{try{
 if(phase==='prepare'){
  const prepare=()=>prepareSalesBankMatch({config,bank,candidate:chosen,bankRevision:'0',reason:'Reviewed receipt and exact bank amount',expectedActorId:actor,fetcher});
  const a=await prepare(),b=await prepare();assert('distinctReviewNonce',a.ok&&b.ok&&a.command.idempotencyKey!==b.command.idempotencyKey);
  const reserved=await Promise.all([reserveSalesBankIntent(scope,a.command),reserveSalesBankIntent(scope,b.command)]);
  assert('concurrentReservationKeepsOriginal',reserved[0].command.idempotencyKey===reserved[1].command.idempotencyKey);
  const original=reserved[0].command;
  assert('wrongKeyCannotDelete',await releaseSalesBankIntent(scope,'wrong-key')===false&&!!await readSalesBankIntent(scope));
  assert('otherActorIsolated',await readSalesBankIntent({...scope,actorId:'other'})===null);
  assert('otherBankIsolated',await readSalesBankIntent({...scope,bankSourceId:id(999)})===null);
  let unavailable=false;try{await reserveSalesBankIntent(scope,a.command,{indexedDB:null});}catch{unavailable=true;}assert('unavailableStorageRejects',unavailable&&posts.length===0);
  const raw=await new Promise((resolve,reject)=>{const request=indexedDB.open('refs-accounting-command-intents',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('salesBankMatches','readwrite'),store=tx.objectStore('salesBankMatches'),get=store.get(salesBankIntentKey(scope));let before;get.onsuccess=()=>{before=structuredClone(get.result);const altered=structuredClone(before);altered.command.trace.ledger_line_id=id(999);store.put(altered);};tx.oncomplete=()=>{db.close();resolve(before);};tx.onabort=()=>reject(tx.error);};});
  assert('onlyCommandIntentStored',Object.keys(raw).sort().join(',')==='command,key,schemaVersion'&&!JSON.stringify(raw).includes('fixture-token')&&!('receipt' in raw)&&!('status' in raw));
  let tampered=false;try{await readSalesBankIntent(scope);}catch{tampered=true;}assert('changedTraceRejected',tampered);
  await releaseSalesBankIntent(scope,original.idempotencyKey);
 }
 render();
 if(phase==='prepare'){
  await wait(()=>document.querySelector('select'));const select=document.querySelector('select');select.value=chosen.sales_receipt_id;select.dispatchEvent(new Event('change',{bubbles:true}));
  const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Reviewed receipt and exact bank amount');input.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>button('Match sales receipt')&&!button('Match sales receipt').disabled);button('Match sales receipt').click();
 }
 await wait(()=>button('Retry same match request')&&!button('Retry same match request').disabled);
 const retained=await readSalesBankIntent(scope),originalProof=proof(retained.command);
 assert('originalReviewDisplayed',document.body.textContent.includes(retained.command.body.reason)&&document.body.textContent.includes(chosen.sales_receipt_id));
 assert('noAutomaticReplay',posts.length===(phase==='prepare'?1:0));assert('recoveryDoesNotReadCandidates',phase==='prepare'||reads.length===0);
 assert('retryFocused',document.activeElement===button('Retry same match request'));assert('fitsMobile',document.documentElement.scrollWidth<=innerWidth);
 if(phase==='restart'){
  button('Retry same match request').click();await wait(async()=>await readSalesBankIntent(scope)===null&&!button('Retry same match request'));
  assert('confirmedIntentRemoved',await readSalesBankIntent(scope)===null);assert('exactOriginalReplay',posts.length===1&&JSON.stringify(posts[0])===JSON.stringify(originalProof));
 }
 window.__durableResult={ok:true,phase,checks,proof:originalProof,posts};
 }catch(error){window.__durableResult={ok:false,phase,checks,error:String(error)};}})();
