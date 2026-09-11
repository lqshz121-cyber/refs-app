import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=()=>randomUUID(),hash=`sha256:${'a'.repeat(64)}`;
const tenantId=id(),sourceEntityId=id(),targetEntityId=id(),sourcePeriodId=id(),targetPeriodId=id(),pairId=id(),reversalPairId=id(),unitControlId=id(),sourceDocumentId=id(),sourceDocumentLineId=id(),sourceJournalId=id(),targetJournalId=id(),sourceReversalJournalId=id(),targetReversalJournalId=id(),sourceMappingId=id(),targetMappingId=id(),sourceAttachmentId=id(),targetAttachmentId=id(),costLineId=id();
const noActions={can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_reject:false,can_cancel:false,can_post:false,can_reverse:false};
const createBody={targetEntityId,sourcePeriodId,targetPeriodId,transferDate:'2026-09-12',unitRef:'UNIT-301',sourceDocumentId,sourceDocumentLineId,expectedSourceVersion:3,expectedSourceHash:hash,expectedSourceLineHash:hash,expectedSourceAttachmentHash:hash,expectedTransferPrice:'200.0000',sourceMappingSnapshotId:sourceMappingId,expectedSourceMappingHash:hash,targetMappingSnapshotId:targetMappingId,expectedTargetMappingHash:hash,sourceCarryingAccountCodes:['151000'],sourceGainLossAccountCode:'490100',targetInventoryAccountCode:'141000',expectedCarryingAmount:'175.0000',expectedUnitVersion:0,targetAttachmentIds:[targetAttachmentId],expectedTargetAttachmentHash:hash,sourceJournalNumber:'UT-S-001',targetJournalNumber:'UT-T-001',reason:'Approved paired unit transfer evidence.'};
const draft={schema_version:'UNIT_TRANSFER_DRAFT_PAIR_V1',unit_transfer_pair_id:pairId,source_entity_id:sourceEntityId,target_entity_id:targetEntityId,unit_ref:'UNIT-301',currency:'USD',carrying_amount:'175.0000',transfer_price:'200.0000',source_journal_entry_id:sourceJournalId,target_journal_entry_id:targetJournalId,status:'DRAFT_PAIR',revision:0,evidence_hash:hash,idempotent:false};
const pair={schema_version:'UNIT_TRANSFER_PAIR_V1',unit_transfer_pair_id:pairId,unit_control_id:unitControlId,property_ref:'PROPERTY-1',current_owner_entity_id:sourceEntityId,current_unit_version:'0',source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:sourcePeriodId,target_period_id:targetPeriodId,transfer_date:'2026-09-12',currency:'USD',unit_ref:'UNIT-301',carrying_amount:'175.0000',transfer_price:'200.0000',source_carrying_account_codes:['151000'],source_cost_ledger_line_ids:[costLineId],source_cost_layers:[{account_code:'151000',amount:'175.0000',ledger_line_ids:[costLineId],basis_hash:hash}],source_cost_basis_hash:hash,source_document_id:sourceDocumentId,source_document_line_id:sourceDocumentLineId,source_document_version:'3',source_payload_hash:hash,source_line_hash:hash,source_attachment_ids:[sourceAttachmentId],source_attachment_snapshot_hash:hash,target_attachment_ids:[targetAttachmentId],target_attachment_snapshot_hash:hash,source_mapping_snapshot_id:sourceMappingId,source_mapping_snapshot_hash:hash,target_mapping_snapshot_id:targetMappingId,target_mapping_snapshot_hash:hash,source_due_from_account_code:'132000',source_gain_account_code:'490100',target_inventory_account_code:'141000',target_due_to_account_code:'232000',source_lifecycle_stage:'CWIP',target_lifecycle_stage:'FINISHED_INVENTORY',source_journal_entry_id:sourceJournalId,source_journal_status:'DRAFT',source_journal_revision:'0',target_journal_entry_id:targetJournalId,target_journal_status:'DRAFT',target_journal_revision:'0',status:'DRAFT_PAIR',revision:'0',evidence_hash:hash,elimination_basis:null,reversal_history:[],active_reversal:null,created_by:'maker',created_at:'2026-09-12T00:00:00.000Z',completed_at:null,cancelled_by:null,cancelled_at:null,cancel_reason:null,action_flags:noActions};
const option={source_document_id:sourceDocumentId,source_document_line_id:sourceDocumentLineId,document_no:'UTA-301',property_ref:'PROPERTY-1',unit_ref:'UNIT-301',currency:'USD',transfer_price:'200.0000',expected_source_version:3,expected_source_hash:hash,expected_source_line_hash:hash,source_attachment_ids:[sourceAttachmentId],expected_source_attachment_hash:hash,source_mapping_snapshot_id:sourceMappingId,expected_source_mapping_hash:hash,target_mapping_snapshot_id:targetMappingId,expected_target_mapping_hash:hash,source_carrying_account_codes:['151000'],source_gain_loss_account_code:'490100',target_inventory_account_code:'141000',source_lifecycle_stage:'CWIP',target_lifecycle_stage:'FINISHED_INVENTORY',expected_carrying_amount:'175.0000',source_cost_ledger_line_ids:[costLineId],source_cost_layers:[{account_code:'151000',amount:'175.0000',ledger_line_ids:[costLineId],basis_hash:hash}],source_cost_basis_hash:hash,expected_unit_version:0,target_period_id:targetPeriodId};
const createOptions=selected=>({schema_version:'UNIT_TRANSFER_CREATE_OPTIONS_V1',tenant_id:tenantId,source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:sourcePeriodId,target_period_id:targetPeriodId,transfer_date:'2026-09-12',currency:'USD',options:[option],target_attachment_candidates:[{attachment_id:targetAttachmentId,name:'target-approval.pdf',media_type:'application/pdf',size_bytes:'1024',content_hash:hash,uploaded_at:'2026-09-12T00:00:00.000Z'}],selected_target_attachment_ids:selected?[targetAttachmentId]:[],selected_target_attachment_snapshot_hash:selected?hash:null,action_flags:{...noActions,can_create_draft:selected}});

function setup(overrides={}){
 const calls=[];
 const kernel={
  createUnitTransfer:async args=>(calls.push(['create',args]),draft),
  transitionUnitTransfer:async args=>(calls.push(['transition',args]),{schema_version:'UNIT_TRANSFER_TRANSITION_RECEIPT_V1',unit_transfer_pair_id:pairId,status:'PENDING_REVIEW_PAIR',revision:1,source_journal:{journal_entry_id:sourceJournalId,status:'PENDING_REVIEW',revision:1,idempotent:false},target_journal:{journal_entry_id:targetJournalId,status:'PENDING_REVIEW',revision:1,idempotent:false},idempotent:false}),
  cancelUnitTransfer:async args=>(calls.push(['cancel',args]),{schema_version:'UNIT_TRANSFER_CANCEL_RECEIPT_V1',unit_transfer_pair_id:pairId,status:'CANCELLED_PAIR',revision:1,source_journal_entry_id:sourceJournalId,source_journal_revision:0,target_journal_entry_id:targetJournalId,target_journal_revision:0,cancelled_by:'reviewer',cancelled_at:'2026-09-12T00:02:00.000Z',cancel_reason:args.reason,pair_evidence_hash:hash,idempotent:false}),
  postUnitTransfer:async args=>(calls.push(['post',args]),{schema_version:'UNIT_TRANSFER_POST_RECEIPT_V1',unit_transfer_pair_id:pairId,unit_control_id:unitControlId,unit_version:1,status:'POSTED_PAIR',revision:4,source_journal:{journal_entry_id:sourceJournalId,posting_batch_id:id(),idempotent:false},target_journal:{journal_entry_id:targetJournalId,posting_batch_id:id(),idempotent:false},idempotent:false}),
  createUnitTransferReversal:async args=>(calls.push(['reversal-create',args]),{schema_version:'UNIT_TRANSFER_REVERSAL_DRAFT_PAIR_V1',unit_transfer_reversal_pair_id:reversalPairId,original_unit_transfer_pair_id:pairId,source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:id(),target_period_id:id(),reversal_date:args.reversalDate,source_reversal_journal_entry_id:sourceReversalJournalId,target_reversal_journal_entry_id:targetReversalJournalId,status:'DRAFT_PAIR',revision:0,evidence_hash:hash,idempotent:false}),
  transitionUnitTransferReversal:async args=>(calls.push(['reversal-transition',args]),{schema_version:'UNIT_TRANSFER_REVERSAL_TRANSITION_RECEIPT_V1',unit_transfer_reversal_pair_id:reversalPairId,original_unit_transfer_pair_id:pairId,status:'PENDING_REVIEW_PAIR',revision:1,source_journal:{journal_entry_id:sourceReversalJournalId,status:'PENDING_REVIEW',revision:1,idempotent:false},target_journal:{journal_entry_id:targetReversalJournalId,status:'PENDING_REVIEW',revision:1,idempotent:false},idempotent:false}),
  cancelUnitTransferReversal:async args=>(calls.push(['reversal-cancel',args]),{schema_version:'UNIT_TRANSFER_REVERSAL_CANCEL_RECEIPT_V1',unit_transfer_reversal_pair_id:reversalPairId,original_unit_transfer_pair_id:pairId,status:'CANCELLED_PAIR',revision:1,source_reversal_journal_entry_id:sourceReversalJournalId,source_reversal_journal_revision:0,target_reversal_journal_entry_id:targetReversalJournalId,target_reversal_journal_revision:0,cancelled_by:'reviewer',cancelled_at:'2026-10-01T00:02:00.000Z',cancel_reason:args.reason,evidence_hash:hash,idempotent:false}),
  postUnitTransferReversal:async args=>(calls.push(['reversal-post',args]),{schema_version:'UNIT_TRANSFER_REVERSAL_POST_RECEIPT_V1',unit_transfer_reversal_pair_id:reversalPairId,original_unit_transfer_pair_id:pairId,unit_control_id:unitControlId,unit_version:2,status:'POSTED_PAIR',revision:4,source_journal:{journal_entry_id:sourceReversalJournalId,posting_batch_id:id(),idempotent:false},target_journal:{journal_entry_id:targetReversalJournalId,posting_batch_id:id(),idempotent:false},elimination_reversal_basis_id:id(),evidence_hash:hash,idempotent:false}),
  readUnitTransferPair:async args=>(calls.push(['pair',args]),pair),
  readUnitTransferRegister:async args=>(calls.push(['register',args]),{schema_version:'UNIT_TRANSFER_REGISTER_V1',entity_id:sourceEntityId,period_id:sourcePeriodId,read_at:'2026-09-12T00:01:00.000Z',rows:[pair],limit:args.limit,has_more:false,next_cursor:null,action_flags:noActions}),
  readUnitTransferCreateOptions:async args=>(calls.push(['options',args]),createOptions(args.targetAttachmentIds.length>0)),
  ...overrides
 };
 return {calls,api:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel})};
}

const command=(url,body,key='unit-transfer-command-001')=>({method:'POST',url,headers:{'idempotency-key':key},body});

test('Unit Transfer HTTP derives identity and accepts only the complete evidence-bound create command',async()=>{
 const {api,calls}=setup();
 const response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers`,createBody,'unit-transfer-create-001'));
 assert.equal(response.status,201);assert.equal(response.headers.etag,'"0"');
 assert.deepEqual(calls[0],['create',{...createBody,tenantId,entityId:sourceEntityId,idempotencyKey:'unit-transfer-create-001'}]);
 for(const body of [{...createBody,tenantId},{...createBody,expectedTransferPrice:'200'},{...createBody,targetAttachmentIds:[]},{...createBody,targetEntityId:sourceEntityId},{...createBody,reason:'short'}])assert.equal((await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers`,body))).status,400);
});

test('Unit Transfer HTTP binds all three revisions and returns clear missing-field errors',async()=>{
 const {api,calls}=setup(),transitionBody={action:'submit',expectedPairRevision:0,expectedSourceRevision:0,expectedTargetRevision:0,reason:'Both companies submitted retained evidence.'};
 let response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/transitions`,transitionBody,'unit-transfer-submit-001'));
 assert.equal(response.status,200);assert.deepEqual(calls[0][1],{tenantId,entityId:sourceEntityId,pairId,expectedPairRevision:0,expectedSourceRevision:0,expectedTargetRevision:0,idempotencyKey:'unit-transfer-submit-001',action:'SUBMIT',reason:transitionBody.reason});
 response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/post`,{expectedPairRevision:3,expectedSourceRevision:2,expectedTargetRevision:2},'unit-transfer-post-001'));
 assert.equal(response.status,200);assert.equal(calls[1][0],'post');
 response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/post`,{expectedPairRevision:3,expectedSourceRevision:2},'unit-transfer-post-missing'));
 assert.equal(response.status,400);assert.equal(response.body.code,'REQUIRED_FIELD_MISSING');
});

test('Unit Transfer HTTP cancels only with all three revisions and a retained reason',async()=>{
 const {api,calls}=setup(),body={expectedPairRevision:0,expectedSourceRevision:0,expectedTargetRevision:0,reason:'Cancel the stale Draft evidence and retain both Journals.'};
 const response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/cancel`,body,'unit-transfer-cancel-001'));
 assert.equal(response.status,200);assert.equal(calls[0][0],'cancel');assert.deepEqual(calls[0][1],{tenantId,entityId:sourceEntityId,pairId,...body,idempotencyKey:'unit-transfer-cancel-001'});
 assert.equal((await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/cancel`,{...body,reason:'short'},'unit-transfer-cancel-002'))).status,400);
 assert.equal((await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/cancel`,{expectedPairRevision:0,expectedSourceRevision:0,reason:body.reason},'unit-transfer-cancel-003'))).body.code,'REQUIRED_FIELD_MISSING');
});

test('Unit Transfer HTTP creates one exact paired reversal and rejects incomplete or extra commands',async()=>{
 const {api,calls}=setup(),body={expectedPairRevision:4,expectedSourceRevision:3,expectedTargetRevision:3,reversalDate:'2026-10-01',sourceJournalNumber:'UT-RS-001',targetJournalNumber:'UT-RT-001',reason:'Reverse the exact posted pair after retained controller review.'};
 let response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/reversals`,body,'unit-transfer-reversal-001'));
 assert.equal(response.status,201);assert.equal(response.headers.etag,'"0"');assert.equal(calls[0][0],'reversal-create');assert.deepEqual(calls[0][1],{tenantId,entityId:sourceEntityId,pairId,...body,idempotencyKey:'unit-transfer-reversal-001'});
 response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/reversals`,{...body,amount:'175.0000'},'unit-transfer-reversal-extra'));assert.equal(response.status,400);
 response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/reversals`,{...body,reason:'short'},'unit-transfer-reversal-short'));assert.equal(response.status,400);
 const {api:replay}=setup({createUnitTransferReversal:async args=>({schema_version:'UNIT_TRANSFER_REVERSAL_DRAFT_PAIR_V1',unit_transfer_reversal_pair_id:reversalPairId,original_unit_transfer_pair_id:pairId,source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:id(),target_period_id:id(),reversal_date:args.reversalDate,source_reversal_journal_entry_id:sourceReversalJournalId,target_reversal_journal_entry_id:targetReversalJournalId,status:'DRAFT_PAIR',revision:0,evidence_hash:hash,idempotent:true})});
 response=await replay(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/reversals`,body,'unit-transfer-reversal-001'));assert.equal(response.status,200);
});

test('Unit Transfer HTTP binds reversal lifecycle commands to both reversal Journals',async()=>{
 const {api,calls}=setup(),base=`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/reversals/${reversalPairId}`;
 const transition={action:'submit',expectedReversalPairRevision:0,expectedSourceReversalRevision:0,expectedTargetReversalRevision:0,reason:'Submit both exact reversal Drafts for independent review.'};
 let response=await api(command(`${base}/transitions`,transition,'unit-transfer-reversal-submit'));assert.equal(response.status,200);assert.equal(calls[0][0],'reversal-transition');assert.equal(calls[0][1].action,'SUBMIT');
 const cancel={expectedReversalPairRevision:0,expectedSourceReversalRevision:0,expectedTargetReversalRevision:0,reason:'Cancel both retained reversal Drafts after independent review.'};
 response=await api(command(`${base}/cancel`,cancel,'unit-transfer-reversal-cancel'));assert.equal(response.status,200);assert.equal(calls[1][0],'reversal-cancel');
 const post={expectedReversalPairRevision:3,expectedSourceReversalRevision:3,expectedTargetReversalRevision:3};
 response=await api(command(`${base}/post`,post,'unit-transfer-reversal-post'));assert.equal(response.status,200);assert.equal(response.headers.etag,'"4"');assert.equal(calls[2][0],'reversal-post');
 response=await api(command(`${base}/post`,{...post,amount:'1.0000'},'unit-transfer-reversal-post-extra'));assert.equal(response.status,400);
 response=await api(command(`${base}/transitions`,{...transition,action:'POST'},'unit-transfer-reversal-invalid-transition'));assert.equal(response.status,400);
});

test('Unit Transfer HTTP keeps reads no-store and rejects command fields on reads',async()=>{
 const {api,calls}=setup();
 let response=await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers?periodId=${sourcePeriodId}`,headers:{},body:null});
 assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
 response=await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers?periodId=${sourcePeriodId}&limit=1&afterDate=2026-09-12&afterPairId=${pairId}`,headers:{},body:null});
 assert.equal(response.status,200);assert.deepEqual(calls.at(-1)[1],{tenantId,entityId:sourceEntityId,periodId:sourcePeriodId,limit:1,afterDate:'2026-09-12',afterPairId:pairId});
 assert.equal((await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers?periodId=${sourcePeriodId}&afterDate=2026-09-12`,headers:{},body:null})).body.code,'INVALID_UNIT_TRANSFER_CURSOR');
 response=await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}`,headers:{},body:null});
 assert.equal(response.status,200);assert.deepEqual(calls.map(call=>call[0]),['register','register','pair']);
 assert.equal((await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers?periodId=${sourcePeriodId}`,headers:{'if-match':'"0"'},body:null})).status,400);
});

test('Unit Transfer HTTP reads closed create options and binds selected target attachments',async()=>{
 const secondTargetAttachmentId=id(),{api,calls}=setup(),url=`/api/v1/entities/${sourceEntityId}/unit-transfers/create-options?periodId=${sourcePeriodId}&targetEntityId=${targetEntityId}&transferDate=2026-09-12&targetAttachmentId=${targetAttachmentId}`;
 let response=await api({method:'GET',url,headers:{},body:null});
 assert.equal(response.status,200);assert.equal(response.body.data.action_flags.can_create_draft,true);
 assert.deepEqual(calls[0],['options',{tenantId,entityId:sourceEntityId,periodId:sourcePeriodId,targetEntityId,transferDate:'2026-09-12',targetAttachmentIds:[targetAttachmentId]}]);
 response=await api({method:'GET',url:`${url}&targetAttachmentId=${targetAttachmentId}`,headers:{},body:null});assert.equal(response.status,400);assert.equal(response.body.code,'INVALID_TARGET_ATTACHMENTS');
 response=await api({method:'GET',url:`${url}&targetAttachmentId=${secondTargetAttachmentId}`,headers:{},body:null});assert.equal(response.status,200);assert.deepEqual(calls.at(-1)[1].targetAttachmentIds,[secondTargetAttachmentId,targetAttachmentId].sort());
 response=await api({method:'GET',url:url.replace(targetEntityId,sourceEntityId),headers:{},body:null});assert.equal(response.status,400);assert.equal(response.body.code,'INVALID_TARGET_ENTITY');
 response=await api({method:'GET',url,headers:{'idempotency-key':'forbidden'},body:null});assert.equal(response.status,400);
});

test('Unit Transfer stale evidence maps to 412 and missing scoped pairs map to 404',async()=>{
 const stale=Object.assign(new Error('Unit ownership changed before Post'),{code:'40001'}),missing=Object.assign(new Error('Unit Transfer pair not found'),{code:'P0002'});
 let api=setup({postUnitTransfer:async()=>{throw stale;}}).api;
 let response=await api(command(`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}/post`,{expectedPairRevision:3,expectedSourceRevision:2,expectedTargetRevision:2}));
 assert.equal(response.status,412);assert.equal(response.body.code,'PRECONDITION_FAILED');
 api=setup({readUnitTransferPair:async()=>{throw missing;}}).api;
 response=await api({method:'GET',url:`/api/v1/entities/${sourceEntityId}/unit-transfers/${pairId}`,headers:{},body:null});
 assert.equal(response.status,404);assert.equal(response.body.code,'P0002');
});
