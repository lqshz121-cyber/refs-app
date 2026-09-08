import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../../runtime/kernel-repository.mjs';
export async function proveCounterpartyMaintenanceReads({adminPool,runtimePool,seed,trustedSession,migrateDownThrough,migrateUp}){
 const ids=await seed({status:'DRAFT',attachmentStatus:null}),sibling=await seed({tenantId:ids.tenantId,status:'DRAFT',attachmentStatus:null});
 const maker=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'master-read-maker',['MASTER.COUNTERPARTY.PROPOSE'])});
 const approver=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'master-read-approver',['MASTER.COUNTERPARTY.APPROVE'])});
 const reader=new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>trustedSession(ids,'master-read-reader',['AP.VIEW'])});
 const propose=(ref,name,key,kind='VENDOR')=>maker.proposeCounterpartyChange({...ids,kind,memberRef:ref,changeType:'CREATE',expectedVersion:0,displayName:name,active:true,reason:'Maintain master data',idempotencyKey:key});
 const first=await propose('HISTORY-1','First vendor','history-create-first');
 const second=await propose('HISTORY-2','Second vendor','history-create-second');
 await approver.reviewCounterpartyChange({...ids,changeId:first.counterparty_change_id,expectedVersion:0,decision:'APPROVE',reason:'Reviewed vendor data',idempotencyKey:'history-approve-first'});
 const third=await propose('HISTORY-C','Customer','history-create-customer','CUSTOMER');
 const read=(status='ALL',ref=null,after=null,limit=25,scope=ids)=>reader.inSession(async c=>(await c.query('SELECT refs_read_counterparty_changes($1,$2,$3,$4,$5,$6,$7) value',[scope.tenantId,scope.entityId,'VENDOR',status,ref,after,limit])).rows[0].value);
 const detail=(ref,kind='VENDOR',scope=ids)=>reader.inSession(async c=>(await c.query('SELECT refs_read_counterparty_detail($1,$2,$3,$4) value',[scope.tenantId,scope.entityId,kind,ref])).rows[0].value);
 assert.deepEqual(await detail('HISTORY-1'),{schema_version:'COUNTERPARTY_DETAIL_V1',entity_id:ids.entityId,kind:'VENDOR',member_ref:'HISTORY-1',display_name:'First vendor',active:true,revision:0});
 await assert.rejects(detail('HISTORY-2'),e=>e.code==='23503');
 await assert.rejects(detail('HISTORY-C','CUSTOMER'),e=>e.code==='42501');
 await assert.rejects(detail('HISTORY-1','VENDOR',sibling),e=>e.code==='42501');
 const page=await read('ALL',null,null,1);assert.equal(page.rows.length,1);assert.equal(page.rows[0].counterparty_change_id,second.counterparty_change_id);assert.equal(page.next_change_id,second.counterparty_change_id);
 const tail=await read('ALL',null,page.next_change_id,1);assert.equal(tail.rows[0].counterparty_change_id,first.counterparty_change_id);assert.equal(tail.next_change_id,null);
 assert.equal(tail.rows[0].reviewed_by,'master-read-approver');assert.equal(tail.rows[0].status,'APPROVED');
 assert.deepEqual(tail.rows[0].desired_state,{display_name:'First vendor',active:true});assert.equal(tail.rows[0].before_state,null);
 assert.deepEqual((await read('PENDING')).rows.map(r=>r.counterparty_change_id),[second.counterparty_change_id]);
 assert.deepEqual((await read('ALL','HISTORY-1')).rows.map(r=>r.counterparty_change_id),[first.counterparty_change_id]);
 await assert.rejects(read('ALL',null,third.counterparty_change_id),e=>e.code==='22023');
 await assert.rejects(read('ALL','HISTORY-1',second.counterparty_change_id),e=>e.code==='22023');
 await assert.rejects(read('ALL',null,null,101),e=>e.code==='22023');
 await assert.rejects(read('ALL',null,null,25,sibling),e=>e.code==='42501');
 // A cursor remains usable after its own row leaves the pending queue.
 await approver.reviewCounterpartyChange({...ids,changeId:second.counterparty_change_id,expectedVersion:0,decision:'REJECT',reason:'Duplicate vendor request',idempotencyKey:'history-reject-second'});
 assert.equal((await read('PENDING',null,second.counterparty_change_id)).rows.length,0);
 const before=await read();await migrateDownThrough(adminPool,'330_counterparty_maintenance_reads.sql');
 assert.equal((await adminPool.query('SELECT count(*)::int n FROM counterparty_change WHERE tenant_id=$1 AND entity_id=$2',[ids.tenantId,ids.entityId])).rows[0].n,3);
 await migrateUp(adminPool);assert.deepEqual(await read(),before);
}
