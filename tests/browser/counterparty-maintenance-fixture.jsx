import React from 'react';import {createRoot} from 'react-dom/client';
import {CounterpartyRegisterWorkspace} from '__COMPONENT__';
const phase=new URLSearchParams(location.search).get('phase'),checks={},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async(fn,label='condition')=>{for(let i=0;i<240;i++){if(fn())return;await sleep(25);}throw Error('Timed out: '+label);};
const config={baseUrl:'https://fixture.example',tenantId:'33333333-3333-4333-8333-333333333333',entityId:'11111111-1111-4111-8111-111111111111',periodId:'22222222-2222-4222-8222-222222222222',getAccessToken:async()=>'fixture-token-'.repeat(4)};
let actor='maker',master=null,loseFirst=true;const changes=[],receipts=new Map(),posts=[];
const reply=data=>({ok:true,status:200,json:async()=>({ok:true,data})});
const fetcher=async(url,init)=>{
 const u=new URL(url),q=u.searchParams,path=u.pathname;
 if(path.endsWith('/access/self')){const permissions=['AP.VIEW',actor==='maker'?'MASTER.COUNTERPARTY.PROPOSE':'MASTER.COUNTERPARTY.APPROVE'].sort();return reply({actor_id:actor,tenant_id:config.tenantId,entity_id:config.entityId,grant_set_version:1,permissions,configured_permissions:permissions,session_refresh_required:false});}
 if(init.method==='POST'){
  const key=init.headers['idempotency-key'],body=JSON.parse(init.body);posts.push({key,body,headers:init.headers,actor});
  if(receipts.has(key))return reply({...receipts.get(key),idempotent:true});
  let result;
  if(path.endsWith('/review')){
   const row=changes.find(r=>r.counterparty_change_id===path.split('/').at(-2));
   row.status=body.decision==='APPROVE'?'APPROVED':'REJECTED';row.revision=1;row.reviewed_by=actor;row.review_reason=body.reason;row.reviewed_at=new Date().toISOString();
   if(body.decision==='APPROVE')master={...row.desired_state,member_ref:row.member_ref,revision:master?master.revision+1:0};
   result={counterparty_change_id:row.counterparty_change_id,entity_id:config.entityId,kind:'VENDOR',member_ref:row.member_ref,status:row.status,revision:1,member_revision:body.decision==='APPROVE'?master.revision:null,idempotent:false};
  }else{
   const row={counterparty_change_id:`44444444-4444-4444-8444-${String(changes.length+1).padStart(12,'0')}`,member_ref:body.memberRef,kind:body.kind,change_type:body.changeType,expected_member_revision:master?.revision||0,
    before_state:body.changeType==='CREATE'?null:{display_name:master.display_name,active:master.active,revision:master.revision},desired_state:{display_name:body.displayName,active:body.active},reason:body.reason,proposed_by:actor,created_at:new Date().toISOString(),status:'PENDING',revision:0,reviewed_by:null,review_reason:null,reviewed_at:null};
   changes.unshift(row);result={counterparty_change_id:row.counterparty_change_id,entity_id:config.entityId,member_ref:row.member_ref,kind:row.kind,status:'PENDING',revision:0,idempotent:false};
  }
  receipts.set(key,result);if(loseFirst){loseFirst=false;throw Error('Response lost after commit');}return reply(result);
 }
 if(path.endsWith('/counterparties/detail'))return reply({schema_version:'COUNTERPARTY_DETAIL_V1',entity_id:config.entityId,kind:'VENDOR',...master});
 if(path.endsWith('/counterparty-changes'))return reply({schema_version:'COUNTERPARTY_CHANGES_V1',entity_id:config.entityId,kind:'VENDOR',status:q.get('status'),member_ref:q.get('memberRef'),after_id:q.get('afterId'),limit:Number(q.get('limit')),
  rows:changes.filter(r=>(q.get('status')==='ALL'||r.status===q.get('status'))&&(!q.get('memberRef')||r.member_ref===q.get('memberRef'))).map(r=>({...r})),next_change_id:null});
 const status=q.get('status'),rows=master&&(status==='ALL'||master.active===(status==='ACTIVE'))?[{member_ref:master.member_ref,member_type:'VENDOR',display_name:master.display_name,active:master.active}]:[];
 return reply({schema_version:'COUNTERPARTY_REGISTER_V1',entity_id:config.entityId,kind:'VENDOR',status,query:q.get('query'),after_ref:q.get('afterRef'),limit:Number(q.get('limit')),rows,next_ref:null});
};
const root=createRoot(document.getElementById('root'));const render=()=>root.render(<CounterpartyRegisterWorkspace key={actor} config={config} fetcher={fetcher}/>);
const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
const fill=(el,value)=>{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));};
const submit=()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
const editField=(label,value)=>fill([...document.querySelectorAll('label')].find(l=>l.textContent===label)?.querySelector('input,textarea'),value);
(async()=>{try{
 sessionStorage.clear();render();await wait(()=>button('New vendor'));button('New vendor').click();await wait(()=>button('Submit for review'),'create form');checks.createHeadingFocused=document.activeElement?.tagName==='H2';
 editField('Reference','V-NEW');editField('Name','Fixture vendor');editField('Reason for change','Create fixture vendor');await sleep(50);submit();
 await wait(()=>button('Retry saved request')&&!button('Retry saved request').disabled,'uncertain request');checks.pendingMasterUnchanged=master===null;checks.pendingProposalCount=changes.length===1;
 button('Back to vendors').click();await wait(()=>button('New vendor'));button('New vendor').click();await wait(()=>button('Retry saved request'),'restored request');button('Retry saved request').click();
 await wait(()=>document.body.textContent.includes('Change submitted for review.'));checks.exactReplay=posts[0].key===posts[1].key&&changes.length===1;checks.recoveryCleared=sessionStorage.length===0;
 actor='approver';render();await wait(()=>button('Review changes'));button('Review changes').click();await wait(()=>button('Approve V-NEW'),'review queue');
 checks.beforeApprovalVisible=document.body.textContent.includes('New contact: Fixture vendor');fill(document.querySelector('textarea'),'Reviewed fixture vendor');await sleep(50);button('Approve V-NEW').click();
 await wait(()=>master?.active===true&&!button('Approve V-NEW'));checks.approvedSaved=master.display_name==='Fixture vendor';
 actor='maker';render();await wait(()=>button('Fixture vendor'));button('Fixture vendor').click();await wait(()=>button('Submit for review'),'edit form');
 editField('Name','Renamed vendor');document.querySelector('input[type=checkbox]').click();editField('Reason for change','Retire renamed vendor');await sleep(50);submit();await wait(()=>changes.length===2&&document.body.textContent.includes('Change submitted for review.'));
 checks.updateUsesVersion=posts.at(-1).headers['if-match']==='"0"';checks.noImmediateMutation=master.display_name==='Fixture vendor'&&master.active;
 actor='approver';render();await wait(()=>button('Review changes'));button('Review changes').click();await wait(()=>button('Approve V-NEW'));fill(document.querySelector('textarea'),'Reviewed vendor retirement');await sleep(50);button('Approve V-NEW').click();await wait(()=>master?.active===false);checks.deactivated=master.display_name==='Renamed vendor'&&master.revision===1;
 await wait(()=>!button('Approve V-NEW'));const select=document.querySelector('select');select.value='ALL';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>document.querySelectorAll('article').length===2);checks.historyRetained=document.body.textContent.includes('Reviewed vendor retirement');
 checks.fitsViewport=document.documentElement.scrollWidth<=innerWidth;checks.noClientActorInBody=posts.every(p=>!('actorId' in p.body)&&!('tenantId' in p.body));
 window.__durableResult={phase,ok:Object.values(checks).every(Boolean),checks};
 }catch(e){window.__durableResult={phase,ok:false,checks,error:e.stack||e.message};}})();
