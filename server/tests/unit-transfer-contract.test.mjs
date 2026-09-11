import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {
  validUnitTransferCreateOptions,
  validUnitTransferCancelReceipt,
  validUnitTransferDraftReceipt,
  validUnitTransferPair,
  validUnitTransferPostReceipt,
  validUnitTransferRegister,
  validUnitTransferTransitionReceipt
} from '../runtime/unit-transfer-contract.mjs';

const id=()=>randomUUID();
const hash=character=>`sha256:${character.repeat(64)}`;
const sourceEntityId=id(),targetEntityId=id(),sourcePeriodId=id(),targetPeriodId=id(),pairId=id(),unitControlId=id();
const sourceJournalId=id(),targetJournalId=id();
const actionFlags={can_create_draft:false,can_submit:true,can_review:false,can_approve:false,can_reject:false,can_cancel:true,can_post:false};

test('Unit Transfer create options expose only server-derived command evidence',()=>{
 const targetAttachmentId=id(),sourceAttachmentId=id(),costLineId=id(),sourceDocumentId=id(),sourceDocumentLineId=id(),sourceMappingId=id(),targetMappingId=id();
 const option={source_document_id:sourceDocumentId,source_document_line_id:sourceDocumentLineId,document_no:'UTA-301',property_ref:'PROPERTY-1',unit_ref:'UNIT-301',currency:'USD',transfer_price:'200.0000',expected_source_version:3,expected_source_hash:hash('a'),expected_source_line_hash:hash('b'),source_attachment_ids:[sourceAttachmentId],expected_source_attachment_hash:hash('c'),source_mapping_snapshot_id:sourceMappingId,expected_source_mapping_hash:hash('d'),target_mapping_snapshot_id:targetMappingId,expected_target_mapping_hash:hash('e'),source_carrying_account_codes:['151000'],source_gain_loss_account_code:'490100',target_inventory_account_code:'141000',source_lifecycle_stage:'CWIP',target_lifecycle_stage:'FINISHED_INVENTORY',expected_carrying_amount:'175.0000',source_cost_ledger_line_ids:[costLineId],source_cost_layers:[{account_code:'151000',amount:'175.0000',ledger_line_ids:[costLineId],basis_hash:hash('f')}],source_cost_basis_hash:hash('f'),expected_unit_version:0,target_period_id:targetPeriodId};
 const candidate={attachment_id:targetAttachmentId,name:'target-approval.pdf',media_type:'application/pdf',size_bytes:'1024',content_hash:hash('0'),uploaded_at:'2026-09-12T00:00:00.000Z'};
 const value={schema_version:'UNIT_TRANSFER_CREATE_OPTIONS_V1',tenant_id:id(),source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:sourcePeriodId,target_period_id:targetPeriodId,transfer_date:'2026-09-12',currency:'USD',options:[option],target_attachment_candidates:[candidate],selected_target_attachment_ids:[targetAttachmentId],selected_target_attachment_snapshot_hash:hash('1'),action_flags:{can_create_draft:true,can_submit:false,can_review:false,can_approve:false,can_reject:false,can_cancel:false,can_post:false}};
 const scope={tenantId:value.tenant_id,sourceEntityId,sourcePeriodId,targetEntityId,transferDate:value.transfer_date};
 assert.equal(validUnitTransferCreateOptions(value,scope),true);
 assert.equal(validUnitTransferCreateOptions({...value,options:[{...option,expected_source_hash:hash('9')}],action_flags:{...value.action_flags,can_post:true}},scope),false);
 assert.equal(validUnitTransferCreateOptions({...value,selected_target_attachment_ids:[],selected_target_attachment_snapshot_hash:null,action_flags:{...value.action_flags,can_create_draft:false}},scope),true);
});

const pairCostLineId=id();
const pair={
  schema_version:'UNIT_TRANSFER_PAIR_V1',unit_transfer_pair_id:pairId,unit_control_id:unitControlId,property_ref:'PROPERTY-1',current_owner_entity_id:sourceEntityId,current_unit_version:'0',
  source_entity_id:sourceEntityId,target_entity_id:targetEntityId,source_period_id:sourcePeriodId,target_period_id:targetPeriodId,transfer_date:'2026-09-12',currency:'USD',unit_ref:'UNIT-301',carrying_amount:'175.0000',transfer_price:'200.0000',
  source_cost_ledger_line_ids:[pairCostLineId],source_cost_layers:[{account_code:'151000',amount:'175.0000',ledger_line_ids:[pairCostLineId],basis_hash:hash('a')}],source_cost_basis_hash:hash('a'),source_document_id:id(),source_document_line_id:id(),source_document_version:'3',source_payload_hash:hash('b'),source_line_hash:hash('c'),
  source_attachment_ids:[id()].sort(),source_attachment_snapshot_hash:hash('d'),target_attachment_ids:[id()].sort(),target_attachment_snapshot_hash:hash('e'),
  source_mapping_snapshot_id:id(),source_mapping_snapshot_hash:hash('f'),target_mapping_snapshot_id:id(),target_mapping_snapshot_hash:hash('0'),
  source_carrying_account_codes:['151000'],source_due_from_account_code:'132000',source_gain_account_code:'490100',target_inventory_account_code:'141000',target_due_to_account_code:'232000',source_lifecycle_stage:'CWIP',target_lifecycle_stage:'FINISHED_INVENTORY',
  source_journal_entry_id:sourceJournalId,source_journal_status:'DRAFT',source_journal_revision:'0',target_journal_entry_id:targetJournalId,target_journal_status:'DRAFT',target_journal_revision:'0',
  status:'DRAFT_PAIR',revision:'0',evidence_hash:hash('1'),elimination_basis:null,created_by:'maker',created_at:'2026-09-12T00:00:00.000Z',completed_at:null,cancelled_by:null,cancelled_at:null,cancel_reason:null,action_flags:actionFlags
};

test('Unit Transfer pair and register validators accept only closed scoped evidence',()=>{
  assert.equal(validUnitTransferPair(pair,{entityId:sourceEntityId,pairId}),true);
  const register={schema_version:'UNIT_TRANSFER_REGISTER_V1',entity_id:sourceEntityId,period_id:sourcePeriodId,read_at:'2026-09-12T00:01:00.000Z',rows:[{...pair,action_flags:{...actionFlags,can_submit:false}}],limit:100,has_more:false,next_cursor:null,action_flags:{...actionFlags,can_submit:false,can_cancel:false}};
  assert.equal(validUnitTransferRegister(register,{entityId:sourceEntityId,periodId:sourcePeriodId}),true);
  assert.equal(validUnitTransferPair({...pair,unexpected:true},{entityId:sourceEntityId,pairId}),false);
  assert.equal(validUnitTransferPair({...pair,current_owner_entity_id:targetEntityId},{entityId:id(),pairId}),false);
  assert.equal(validUnitTransferPair({...pair,current_owner_entity_id:targetEntityId,current_unit_version:'3'},{entityId:sourceEntityId,pairId}),true);
  const cancelledHistory={...pair,current_owner_entity_id:targetEntityId,current_unit_version:'3',status:'CANCELLED_PAIR',revision:'1',cancelled_by:'reviewer',cancelled_at:'2026-09-12T00:02:00.000Z',cancel_reason:'The Draft pair used stale supporting evidence.',action_flags:{...actionFlags,can_submit:false,can_cancel:false}};
  assert.equal(validUnitTransferPair(cancelledHistory,{entityId:sourceEntityId,pairId}),true);
  assert.equal(validUnitTransferRegister({...register,rows:[{...register.rows[0],action_flags:{...register.rows[0].action_flags,can_post:true}}]},{entityId:sourceEntityId,periodId:sourcePeriodId}),false);
  const page={...register,limit:1,has_more:true,next_cursor:{transfer_date:pair.transfer_date,unit_transfer_pair_id:pair.unit_transfer_pair_id}};
  assert.equal(validUnitTransferRegister(page,{entityId:sourceEntityId,periodId:sourcePeriodId,limit:1}),true);
  assert.equal(validUnitTransferRegister({...page,next_cursor:{...page.next_cursor,unit_transfer_pair_id:id()}},{entityId:sourceEntityId,periodId:sourcePeriodId,limit:1}),false);
});

test('Unit Transfer command receipts bind both journals, pair state and replay state',()=>{
  const draft={schema_version:'UNIT_TRANSFER_DRAFT_PAIR_V1',unit_transfer_pair_id:pairId,source_entity_id:sourceEntityId,target_entity_id:targetEntityId,unit_ref:'UNIT-301',currency:'USD',carrying_amount:'175.0000',transfer_price:'200.0000',source_journal_entry_id:sourceJournalId,target_journal_entry_id:targetJournalId,status:'DRAFT_PAIR',revision:0,evidence_hash:hash('2'),idempotent:false};
  assert.equal(validUnitTransferDraftReceipt(draft,{sourceEntityId,targetEntityId}),true);
  assert.equal(validUnitTransferDraftReceipt({...draft,target_entity_id:id()},{sourceEntityId,targetEntityId}),false);

  const journal=(journal_entry_id,status,revision)=>({journal_entry_id,status,revision,idempotent:false});
  const transition={schema_version:'UNIT_TRANSFER_TRANSITION_RECEIPT_V1',unit_transfer_pair_id:pairId,status:'PENDING_REVIEW_PAIR',revision:1,source_journal:journal(sourceJournalId,'PENDING_REVIEW',1),target_journal:journal(targetJournalId,'PENDING_REVIEW',1),idempotent:false};
  assert.equal(validUnitTransferTransitionReceipt(transition,{pairId,action:'SUBMIT'}),true);
  assert.equal(validUnitTransferTransitionReceipt({...transition,status:'APPROVED_PAIR'},{pairId,action:'SUBMIT'}),false);
  assert.equal(validUnitTransferTransitionReceipt({...transition,source_journal:{...transition.source_journal,status:'DRAFT'}},{pairId,action:'SUBMIT'}),false);

  const postedJournal=journal_entry_id=>({journal_entry_id,posting_batch_id:id(),idempotent:false});
  const post={schema_version:'UNIT_TRANSFER_POST_RECEIPT_V1',unit_transfer_pair_id:pairId,unit_control_id:unitControlId,unit_version:1,status:'POSTED_PAIR',revision:4,source_journal:postedJournal(sourceJournalId),target_journal:postedJournal(targetJournalId),idempotent:false};
  assert.equal(validUnitTransferPostReceipt(post,{pairId}),true);
  assert.equal(validUnitTransferPostReceipt({...post,unit_version:0},{pairId}),false);

  const cancel={schema_version:'UNIT_TRANSFER_CANCEL_RECEIPT_V1',unit_transfer_pair_id:pairId,status:'CANCELLED_PAIR',revision:1,source_journal_entry_id:sourceJournalId,source_journal_revision:0,target_journal_entry_id:targetJournalId,target_journal_revision:0,cancelled_by:'reviewer',cancelled_at:'2026-09-12T00:02:00.000Z',cancel_reason:'The Draft pair used stale supporting evidence.',pair_evidence_hash:hash('1'),idempotent:false};
  assert.equal(validUnitTransferCancelReceipt(cancel,{pairId}),true);
  assert.equal(validUnitTransferCancelReceipt({...cancel,cancel_reason:'short'},{pairId}),false);
});
