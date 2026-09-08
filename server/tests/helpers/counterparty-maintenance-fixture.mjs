import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../../runtime/kernel-repository.mjs';
import {createAccountingApi} from '../../api/accounting-http.mjs';

export async function proveCounterpartyMaintenance({adminPool,runtimePool,seed,trustedSession,migrateDownThrough,migrateUp}){
 const ids=await seed({status:'DRAFT',attachmentStatus:null});
 // Empty migration rollback must preserve pre-existing company masters.
 const masterCount=async()=>Number((await adminPool.query('SELECT count(*) n FROM member_master WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n);
 const countBefore=await masterCount();
 await migrateDownThrough(adminPool,'327_counterparty_maintenance.sql');await migrateUp(adminPool);
 assert.equal(await masterCount(),countBefore);
 const actor=(name,permissions)=>new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,name,permissions)});
 const maker=actor('counterparty-maker',['MASTER.COUNTERPARTY.PROPOSE']);
 const approver=actor('counterparty-approver',['MASTER.COUNTERPARTY.APPROVE']);
 const reader=actor('counterparty-reader',['AP.VIEW']);
 const propose=(kernel,{ref='CP-NEW',kind='VENDOR',type='CREATE',version=0,name='New vendor',active=true,key='cp-propose-create',entity=ids.entityId}={})=>kernel.inSession(async c=>(await c.query(
  'SELECT refs_propose_counterparty_change($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) value',
  [ids.tenantId,entity,kind,ref,type,version,name,active,'Maintain counterparty master',key])).rows[0].value);
 const review=(kernel,proposal,{decision='APPROVE',key='cp-review-create',entity=ids.entityId}={})=>kernel.inSession(async c=>(await c.query(
  'SELECT refs_review_counterparty_change($1,$2,$3,$4,$5,$6,$7) value',
  [ids.tenantId,entity,proposal.counterparty_change_id,0,decision,'Reviewed supporting master details',key])).rows[0].value);
 const read=async ref=>(await adminPool.query('SELECT display_name,active,counterparty_version::int revision FROM member_master WHERE tenant_id=$1 AND entity_id=$2 AND member_ref=$3',[ids.tenantId,ids.entityId,ref])).rows[0];
 const counts=async()=>(await adminPool.query(`SELECT
  (SELECT count(*)::int FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2) journals,
  (SELECT count(*)::int FROM audit_event WHERE tenant_id=$1 AND entity_id=$2 AND object_type='COUNTERPARTY_CHANGE') audits,
  (SELECT count(*)::int FROM outbox_event WHERE tenant_id=$1 AND entity_id=$2 AND aggregate_type='COUNTERPARTY_CHANGE') events,
  (SELECT count(*)::int FROM idempotency_receipt WHERE tenant_id=$1 AND operation_scope IN ('COUNTERPARTY_PROPOSE:'||$2::text,'COUNTERPARTY_REVIEW:'||$2::text)) receipts`,[ids.tenantId,ids.entityId])).rows[0];
 const initial=await counts();
 await assert.rejects(propose(reader),e=>e.code==='42501');
 const sibling=await seed({tenantId:ids.tenantId,status:'DRAFT',attachmentStatus:null});
 await assert.rejects(propose(maker,{entity:sibling.entityId}),e=>e.code==='42501');
 const created=await propose(maker);assert.equal(created.status,'PENDING');assert.equal(await read('CP-NEW'),undefined);
 assert.deepEqual(await propose(maker),{...created,idempotent:true});
 await assert.rejects(propose(maker,{name:'Different payload'}),e=>e.code==='23505');
 const secondMaker=actor('counterparty-other-maker',['MASTER.COUNTERPARTY.PROPOSE']);
 await assert.rejects(propose(secondMaker),e=>e.code==='23505');
 await assert.rejects(review(maker,created),e=>e.code==='42501');
 // A later role change still must not let the original maker self-approve.
 const makerAsApprover=actor('counterparty-maker',['MASTER.COUNTERPARTY.APPROVE']);
 await assert.rejects(review(makerAsApprover,created),e=>e.code==='42501');
 await assert.rejects(review(approver,created,{entity:sibling.entityId}),e=>e.code==='42501');
 const approved=await review(approver,created);assert.equal(approved.status,'APPROVED');assert.equal(approved.member_revision,0);
 assert.deepEqual(await read('CP-NEW'),{display_name:'New vendor',active:true,revision:0});
 assert.deepEqual(await review(approver,created),{...approved,idempotent:true});
 assert.deepEqual(await counts(),{...initial,audits:2,events:2,receipts:2});
 const edit=await propose(maker,{type:'UPDATE',name:'Renamed vendor',key:'cp-propose-rename'});
 const rival=await propose(secondMaker,{type:'UPDATE',name:'Stale competing name',key:'cp-propose-rival'});
 assert.equal((await review(approver,edit,{key:'cp-review-rename'})).member_revision,1);
 const beforeStale=await counts();
 await assert.rejects(review(approver,rival,{key:'cp-review-stale'}),e=>e.code==='55000');
 assert.deepEqual(await counts(),beforeStale,'Failed stale review must leave no receipt, audit or event');
 assert.deepEqual(await read('CP-NEW'),{display_name:'Renamed vendor',active:true,revision:1});
 assert.equal((await review(approver,rival,{decision:'REJECT',key:'cp-reject-rival'})).status,'REJECTED');
 const disable=await propose(maker,{type:'UPDATE',version:1,name:'Renamed vendor',active:false,key:'cp-propose-disable'});
 await review(approver,disable,{key:'cp-review-disable'});
 assert.deepEqual(await read('CP-NEW'),{display_name:'Renamed vendor',active:false,revision:2});
 const makerApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'counterparty-maker'}),kernelFactory:async()=>maker});
 const approverApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId:ids.tenantId,actorId:'counterparty-approver'}),kernelFactory:async()=>approver});
 const customerHttp=await makerApi({method:'POST',url:`/api/v1/entities/${ids.entityId}/counterparty-changes`,headers:{'idempotency-key':'cp-propose-customer'},
  body:{kind:'CUSTOMER',memberRef:'CP-CUSTOMER',changeType:'CREATE',displayName:'Customer name',active:true,reason:'Maintain customer master'}});
 assert.equal(customerHttp.status,201,JSON.stringify(customerHttp.body));
 const customer=customerHttp.body.data;
 const approvedHttp=await approverApi({method:'POST',url:`/api/v1/entities/${ids.entityId}/counterparty-changes/${customer.counterparty_change_id}/review`,
  headers:{'idempotency-key':'cp-review-customer','if-match':'"0"'},body:{decision:'APPROVE',reason:'Reviewed customer details'}});
 assert.equal(approvedHttp.status,200,JSON.stringify(approvedHttp.body));assert.equal(approvedHttp.body.data.status,'APPROVED');
 assert.equal((await read('CP-CUSTOMER')).display_name,'Customer name');
 const rejected=await propose(maker,{ref:'CP-REJECT',key:'cp-propose-reject'});
 await review(approver,rejected,{decision:'REJECT',key:'cp-review-reject'});
 assert.equal(await read('CP-REJECT'),undefined);
 // Simulate a failed response transaction after the real command has run.
 const rollback=await propose(maker,{ref:'CP-ROLLBACK',key:'cp-propose-rollback'});
 const beforeRollback=await counts();
 await assert.rejects(approver.inSession(async c=>{
  await c.query('SELECT refs_review_counterparty_change($1,$2,$3,0,$4,$5,$6)',[ids.tenantId,ids.entityId,rollback.counterparty_change_id,'APPROVE','Reviewed supporting master details','cp-review-rollback']);
  throw new Error('force transaction rollback');
 }),/force transaction rollback/);
 assert.equal(await read('CP-ROLLBACK'),undefined);assert.deepEqual(await counts(),beforeRollback);
 assert.equal((await adminPool.query('SELECT status FROM counterparty_change WHERE counterparty_change_id=$1',[rollback.counterparty_change_id])).rows[0].status,'PENDING');
 await assert.rejects(migrateDownThrough(adminPool,'327_counterparty_maintenance.sql'),e=>e.code==='55000');
 // Higher read-only migrations may have rolled down before the retained-history
 // guard refuses 327. Restore them so the following scenario sees the full schema.
 await migrateUp(adminPool);
 assert.equal((await counts()).journals,initial.journals,'Master maintenance must not create accounting journals');
}
