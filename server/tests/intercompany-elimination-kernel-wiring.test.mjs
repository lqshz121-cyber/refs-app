import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const id=()=>randomUUID(),hash=`sha256:${'a'.repeat(64)}`;
function setup(){
 const calls=[],kernel=new PostgresAccountingKernel({}, {sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
 kernel.inSession=async work=>work({query:async(text,args=[])=>{calls.push({text:String(text),args});return {rowCount:1,rows:[String(text).includes('_hash(')?{request_hash:hash}:{result:{ok:true}}]};}});
 return {kernel,calls};
}

test('intercompany elimination kernel binds the complete create evidence before command execution',async()=>{
 const {kernel,calls}=setup(),input={tenantId:id(),reportingEntityId:id(),reportingPeriodId:id(),consolidationSnapshotId:id(),sourceEntityId:id(),sourcePeriodId:id(),counterpartyEntityId:id(),counterpartyPeriodId:id(),sourceAccountCode:'120200',expectedSourceEvidenceHash:hash,reason:'Create the exact matched presentation elimination Draft.',idempotencyKey:'intercompany-create-001'};
 assert.deepEqual(await kernel.createIntercompanyElimination(input),{ok:true});assert.equal(calls.length,2);
 assert.match(calls[0].text,/refs_intercompany_elimination_create_hash/);assert.deepEqual(calls[0].args,[input.tenantId,input.reportingEntityId,input.reportingPeriodId,input.consolidationSnapshotId,input.sourceEntityId,input.sourcePeriodId,input.counterpartyEntityId,input.counterpartyPeriodId,input.sourceAccountCode,input.expectedSourceEvidenceHash,input.reason]);
 assert.match(calls[1].text,/refs_create_intercompany_elimination/);assert.deepEqual(calls[1].args,[...calls[0].args,input.idempotencyKey,hash]);
});

test('intercompany elimination kernel binds lifecycle action and revision hashes',async()=>{
 const {kernel,calls}=setup(),scope={tenantId:id(),reportingEntityId:id(),batchId:id(),expectedRevision:2};
 await kernel.transitionIntercompanyElimination({...scope,action:'APPROVE',reason:'Approve the retained matched presentation evidence.',idempotencyKey:'intercompany-approve-001'});
 assert.match(calls[0].text,/refs_intercompany_elimination_transition_hash/);assert.deepEqual(calls[0].args,[scope.tenantId,scope.reportingEntityId,scope.batchId,'APPROVE',2,'Approve the retained matched presentation evidence.']);assert.deepEqual(calls[1].args,[...calls[0].args,'intercompany-approve-001',hash]);
 calls.length=0;await kernel.cancelIntercompanyElimination({...scope,reason:'Cancel this retained Draft evidence after review.',idempotencyKey:'intercompany-cancel-001'});assert.match(calls[0].text,/refs_intercompany_elimination_transition_hash/);assert.deepEqual(calls[0].args,[scope.tenantId,scope.reportingEntityId,scope.batchId,2,'Cancel this retained Draft evidence after review.']);assert.deepEqual(calls[1].args,[...calls[0].args,'intercompany-cancel-001',hash]);
 calls.length=0;await kernel.postIntercompanyElimination({...scope,idempotencyKey:'intercompany-post-001'});assert.match(calls[0].text,/refs_intercompany_elimination_post_hash/);assert.deepEqual(calls[0].args,[scope.tenantId,scope.reportingEntityId,scope.batchId,2]);assert.deepEqual(calls[1].args,[...calls[0].args,'intercompany-post-001',hash]);
});

test('intercompany elimination reads bind reporting scope and never issue command hashes',async()=>{
 const {kernel,calls}=setup(),tenantId=id(),reportingEntityId=id(),reportingPeriodId=id(),batchId=id(),sourceEntityId=id(),sourcePeriodId=id(),counterpartyEntityId=id(),counterpartyPeriodId=id();
 await kernel.readIntercompanyEliminationRegister({tenantId,reportingEntityId,reportingPeriodId});await kernel.readIntercompanyEliminationBatch({tenantId,reportingEntityId,batchId});await kernel.readIntercompanyEliminationCreateOptions({tenantId,reportingEntityId,reportingPeriodId,groupRef:'GROUP-1',sourceEntityId,sourcePeriodId,counterpartyEntityId,counterpartyPeriodId});
 assert.equal(calls.length,3);assert.deepEqual(calls[0].args,[tenantId,reportingEntityId,reportingPeriodId,100]);assert.deepEqual(calls[1].args,[tenantId,reportingEntityId,batchId]);assert.deepEqual(calls[2].args,[tenantId,reportingEntityId,reportingPeriodId,'GROUP-1',sourceEntityId,sourcePeriodId,counterpartyEntityId,counterpartyPeriodId]);
});
