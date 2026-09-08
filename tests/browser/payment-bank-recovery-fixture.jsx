import {preparePaymentBankMatch} from '__API__';import {readPaymentBankIntent,reservePaymentBankIntent,releasePaymentBankIntent,paymentBankIntentKey} from '__RECOVERY__';import React from 'react';import {createRoot} from 'react-dom/client';import {PaymentBankMatch} from '__COMPONENT__';
const id=n=>`${n.toString(16).padStart(8,'0')}-1111-4111-8111-111111111111`;
const config={baseUrl:'https://fixture.example',entityId:id(1),periodId:id(2),getAccessToken:async()=>'fixture-token-'.repeat(4)};
const bank={bank_source_id:id(3),bank_account_ref:'BANK-1',version:0,currency:'USD',amount:'-1.2345',bank_match_id:null};
const candidate=n=>({business_document_id:id(800+n),source_document_id:null,occurrence_kind:'AP_PAYMENT',journal_number:'PAY-'+n,payment_occurrence_id:id(100+n),occurrence_revision:'1',document_number:'BILL-'+n,period_id:id(2),counterparty_ref:'VENDOR-1',counterparty_name:'Vendor One',bank_member_ref:'BANK-1',cash_account_code:'111001',accounting_date:'2026-07-15',currency:'USD',amount:'1.2345',journal_entry_id:id(200+n),journal_revision:'4',journal_line_id:id(300+n),ledger_line_id:id(400+n),date_delta_days:0});
const rows=Array.from({length:25},(_,i)=>candidate(i+1)),chosen=candidate(26);let actor='matcher',posts=[],reads=[],refreshes=0;
const receipt={source_document_id:null,bank_match_id:id(500),bank_source_id:bank.bank_source_id,payment_occurrence_id:chosen.payment_occurrence_id,journal_entry_id:chosen.journal_entry_id,journal_line_id:chosen.journal_line_id,ledger_line_id:chosen.ledger_line_id,status:'ACTIVE',revision:0,idempotent:true};
const response=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});

const phase=new URL(location.href).searchParams.get('phase'),checks={},scope={config,bankSourceId:bank.bank_source_id,actorId:'matcher'};
const assert=(name,value)=>{checks[name]=!!value;if(!value)throw Error(name);};
const proof=command=>({key:command.idempotencyKey,body:JSON.stringify(command.body),version:'"'+command.bankRevision+'"'});
const fetcher=async(url,options)=>{
 if(url.endsWith('/access/self'))return response({tenant_id:id(9),entity_id:config.entityId,actor_id:actor,grant_set_version:1,permissions:['BANK.MATCH.CREATE'],configured_permissions:['BANK.MATCH.CREATE'],session_refresh_required:false});
 if(options.method==='GET'){reads.push(url);const afterId=new URL(url).searchParams.get('afterId');return response({schema_version:'PAYMENT_BANK_CANDIDATES_V1',entity_id:config.entityId,bank_source_id:bank.bank_source_id,bank_revision:'0',after_id:afterId,limit:25,rows:afterId?[chosen]:rows,next_id:afterId?null:rows.at(-1).payment_occurrence_id});}
 const saved=await readPaymentBankIntent(scope);assert('intentSavedBeforePOST',saved?.command.idempotencyKey===options.headers['idempotency-key']);
 posts.push({key:options.headers['idempotency-key'],body:options.body,version:options.headers['if-match']});
 if(phase==='prepare')throw Error('Response lost after commit');return response(receipt);
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),root=createRoot(document.getElementById('root'));
const button=text=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);
const wait=async predicate=>{for(let i=0;i<160;i++){if(await predicate())return;await sleep(25);}throw Error('Timed out: '+predicate);};
const active={...bank,business_source_document_id:null,bank_match_id:receipt.bank_match_id,match_status:'ACTIVE',match_source_kind:'PAYMENT',payment_occurrence_id:chosen.payment_occurrence_id,journal_entry_id:chosen.journal_entry_id,journal_line_id:chosen.journal_line_id,ledger_line_id:chosen.ledger_line_id};
const render=()=>root.render(<PaymentBankMatch config={config} row={['prepare','selection'].includes(phase)?bank:active} recoveryOnly={!['prepare','selection'].includes(phase)} fetcher={fetcher} onChanged={async()=>({ok:true,rows:[active]})}/>);
(async()=>{try{
 if(phase==='prepare'){
  const prepare=()=>preparePaymentBankMatch({config,bank,candidate:chosen,bankRevision:'0',reason:'Reviewed payment and exact bank amount',expectedActorId:actor,fetcher});
  const a=await prepare(),b=await prepare();assert('distinctReviewNonce',a.ok&&b.ok&&a.command.idempotencyKey!==b.command.idempotencyKey);
  const reserved=await Promise.all([reservePaymentBankIntent(scope,a.command),reservePaymentBankIntent(scope,b.command)]);
  assert('concurrentReservationKeepsOriginal',reserved[0].command.idempotencyKey===reserved[1].command.idempotencyKey);
  const original=reserved[0].command;
  assert('wrongKeyCannotDelete',await releasePaymentBankIntent(scope,'wrong-key')===false&&!!await readPaymentBankIntent(scope));
  assert('otherActorIsolated',await readPaymentBankIntent({...scope,actorId:'other'})===null);
  assert('otherBankIsolated',await readPaymentBankIntent({...scope,bankSourceId:id(999)})===null);
  let unavailable=false;try{await reservePaymentBankIntent(scope,a.command,{indexedDB:null});}catch{unavailable=true;}assert('unavailableStorageRejects',unavailable&&posts.length===0);
  const raw=await new Promise((resolve,reject)=>{const request=indexedDB.open('refs-accounting-payment-command-intents',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('paymentBankMatches','readwrite'),store=tx.objectStore('paymentBankMatches'),get=store.get(paymentBankIntentKey(scope));let before;get.onsuccess=()=>{before=structuredClone(get.result);const altered=structuredClone(before);altered.command.trace.ledger_line_id=id(999);store.put(altered);};tx.oncomplete=()=>{db.close();resolve(before);};tx.onabort=()=>reject(tx.error);};});
  assert('onlyCommandIntentStored',Object.keys(raw).sort().join(',')==='command,key,schemaVersion'&&!JSON.stringify(raw).includes('fixture-token')&&!('receipt' in raw)&&!('status' in raw));
  let tampered=false;try{await readPaymentBankIntent(scope);}catch{tampered=true;}assert('changedTraceRejected',tampered);
  await releasePaymentBankIntent(scope,original.idempotencyKey);
 }
 render();
 if(['prepare','selection'].includes(phase)){
  await wait(()=>document.querySelectorAll('select option').length===26);assert('multipleCandidatesRemainSelectable',!document.querySelector('select').disabled&&posts.length===0);button('Next payments').click();await wait(()=>document.querySelectorAll('select option').length===2);assert('pageNavigationClearsSelection',document.querySelector('select').value===''&&button('Match payment').disabled);const select=document.querySelector('select');select.value=chosen.payment_occurrence_id;select.dispatchEvent(new Event('change',{bubbles:true}));
  const input=document.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Reviewed payment and exact bank amount');input.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>button('Match payment')&&!button('Match payment').disabled);
  if(phase==='selection'){
    const details=document.querySelector('details');details.open=true;
    assert('selectedPaymentAndTraceVisible',document.body.textContent.includes(chosen.journal_number)&&document.body.textContent.includes(chosen.ledger_line_id));
    assert('noPostBeforeReview',posts.length===0);assert('selectionFitsViewport',document.documentElement.scrollWidth<=innerWidth);
    window.__durableResult={ok:true,phase,checks};return;
  }
  button('Match payment').click();
 }
 await wait(()=>button('Retry same match request')&&!button('Retry same match request').disabled);
 const retained=await readPaymentBankIntent(scope),originalProof=proof(retained.command);
 assert('originalReviewDisplayed',document.body.textContent.includes(retained.command.body.reason)&&document.body.textContent.includes(chosen.payment_occurrence_id));
 assert('noAutomaticReplay',posts.length===(phase==='prepare'?1:0));assert('recoveryDoesNotReadCandidates',phase==='prepare'||reads.length===0);
 assert('retryFocused',document.activeElement===button('Retry same match request'));assert('fitsMobile',document.documentElement.scrollWidth<=innerWidth);
 if(phase==='restart'){
  button('Retry same match request').click();await wait(async()=>await readPaymentBankIntent(scope)===null&&!button('Retry same match request'));
  assert('confirmedIntentRemoved',await readPaymentBankIntent(scope)===null);assert('exactOriginalReplay',posts.length===1&&JSON.stringify(posts[0])===JSON.stringify(originalProof));
 }
 window.__durableResult={ok:true,phase,checks,proof:originalProof,posts};
 }catch(error){window.__durableResult={ok:false,phase,checks,error:String(error)};}})();
