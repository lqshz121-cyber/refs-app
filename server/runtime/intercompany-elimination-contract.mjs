const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^-?(?:0|[1-9]\d{0,15})\.\d{4}$/;

export const INTERCOMPANY_ELIMINATION_CREATE_FIELDS=['reportingPeriodId','consolidationSnapshotId','sourceEntityId','sourcePeriodId','counterpartyEntityId','counterpartyPeriodId','sourceAccountCode','expectedSourceEvidenceHash','reason'];
export const INTERCOMPANY_ELIMINATION_ACTION_FLAGS=['can_create_draft','can_submit','can_review','can_approve','can_cancel','can_post'];
export const INTERCOMPANY_ELIMINATION_STATUSES=['DRAFT','PENDING_REVIEW','REVIEWED','APPROVED','POSTED','CANCELLED'];

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const uuid=value=>typeof value==='string'&&UUID.test(value);
const sha=value=>typeof value==='string'&&SHA.test(value);
const money=value=>typeof value==='string'&&MONEY.test(value);
const moneyUnits=value=>money(value)?BigInt(value.replace('.','')):null;
const abs=value=>value<0n?-value:value;
const matchedUnits=(left,right)=>abs(left)<abs(right)?abs(left):abs(right);
const revision=value=>typeof value==='string'&&/^(?:0|[1-9]\d*)$/.test(value);
const flags=value=>exact(value,INTERCOMPANY_ELIMINATION_ACTION_FLAGS)&&INTERCOMPANY_ELIMINATION_ACTION_FLAGS.every(key=>typeof value[key]==='boolean');
const DATE=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ACCOUNT=/^[A-Za-z0-9._-]{1,64}$/;
const canonicalText=(value,max)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const canonicalDate=value=>{if(!DATE.test(value))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.toISOString().slice(0,10)===value;};

const SOURCE_KEYS=['schema_version','reporting_entity_id','reporting_period_id','period_cutoff','reporting_period_start','reporting_period_end','reporting_period_ledger_code','reporting_period_status','reporting_period_version','consolidation_snapshot_id','consolidation_version','consolidation_snapshot_hash','consolidation_receipt_hash','consolidation_member_population_hash','consolidation_account_map_population_hash','group_ref','currency','source_entity_id','source_period_id','source_period_start','source_period_end','source_period_ledger_code','source_period_status','source_period_version','source_account_code','source_classification','source_normal_sign','source_closing_balance','source_mapping_snapshot_id','source_mapping_version','source_mapping_snapshot_hash','source_journal_entry_ids','source_journal_line_ids','source_ledger_line_ids','source_document_ids','source_member_snapshot_hash','source_member_receipt_hash','counterparty_entity_id','counterparty_period_id','counterparty_period_start','counterparty_period_end','counterparty_period_ledger_code','counterparty_period_status','counterparty_period_version','counterparty_account_code','counterparty_classification','counterparty_normal_sign','counterparty_closing_balance','counterparty_mapping_snapshot_id','counterparty_mapping_version','counterparty_mapping_snapshot_hash','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids','counterparty_member_snapshot_hash','counterparty_member_receipt_hash','source_presentation_account_code','source_presentation_side','source_consolidation_mapping_hash','counterparty_presentation_account_code','counterparty_presentation_side','counterparty_consolidation_mapping_hash','matched_amount','raw_mismatch','canonical_source_scope_hash','source_evidence_hash'];

const uuidArray=value=>Array.isArray(value)&&value.every(uuid)&&new Set(value).size===value.length;
export function validIntercompanyEliminationSource(value){
  if(!exact(value,SOURCE_KEYS)||value.schema_version!=='INTERCOMPANY_ELIMINATION_SOURCE_V1')return false;
  const left=moneyUnits(value.source_closing_balance),right=moneyUnits(value.counterparty_closing_balance),matched=moneyUnits(value.matched_amount),raw=moneyUnits(value.raw_mismatch);
  return left!==null&&right!==null&&matched!==null&&raw!==null&&matched>0n&&matched===matchedUnits(left,right)&&raw===left+right&&
    ['reporting_entity_id','reporting_period_id','consolidation_snapshot_id','source_entity_id','source_period_id','source_mapping_snapshot_id','counterparty_entity_id','counterparty_period_id','counterparty_mapping_snapshot_id'].every(key=>uuid(value[key]))&&
    ['consolidation_snapshot_hash','consolidation_receipt_hash','consolidation_member_population_hash','consolidation_account_map_population_hash','source_mapping_snapshot_hash','source_member_snapshot_hash','source_member_receipt_hash','counterparty_mapping_snapshot_hash','counterparty_member_snapshot_hash','counterparty_member_receipt_hash','source_consolidation_mapping_hash','counterparty_consolidation_mapping_hash','canonical_source_scope_hash','source_evidence_hash'].every(key=>sha(value[key]))&&
    ['reporting_period_version','consolidation_version','source_period_version','counterparty_period_version'].every(key=>revision(value[key]))&&[value.source_mapping_version,value.counterparty_mapping_version].every(item=>Number.isSafeInteger(item)&&item>0)&&
    ['source_journal_entry_ids','source_journal_line_ids','source_ledger_line_ids','source_document_ids','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids'].every(key=>uuidArray(value[key]))&&
    ['source_closing_balance','counterparty_closing_balance','matched_amount','raw_mismatch'].every(key=>money(value[key]))&&
    value.source_entity_id!==value.counterparty_entity_id&&[value.period_cutoff,value.reporting_period_start,value.reporting_period_end,value.source_period_start,value.source_period_end,value.counterparty_period_start,value.counterparty_period_end].every(canonicalDate)&&value.period_cutoff===value.reporting_period_end&&value.reporting_period_start===value.source_period_start&&value.reporting_period_start===value.counterparty_period_start&&value.reporting_period_end===value.source_period_end&&value.reporting_period_end===value.counterparty_period_end&&value.reporting_period_start<=value.reporting_period_end&&
    /^[A-Z]{3}$/.test(value.currency)&&canonicalText(value.group_ref,160)&&[value.source_account_code,value.counterparty_account_code,value.source_presentation_account_code,value.counterparty_presentation_account_code].every(item=>ACCOUNT.test(item))&&
    value.reporting_period_ledger_code==='PRIMARY'&&value.source_period_ledger_code==='PRIMARY'&&value.counterparty_period_ledger_code==='PRIMARY'&&
    [value.reporting_period_status,value.source_period_status,value.counterparty_period_status].every(item=>['OPEN','SOFT_CLOSED','CLOSED'].includes(item))&&
    ((value.source_classification==='DUE_FROM'&&left>0n&&value.source_normal_sign==='DEBIT_POSITIVE'&&value.source_presentation_side==='DEBIT'&&value.counterparty_classification==='DUE_TO'&&right<0n&&value.counterparty_normal_sign==='CREDIT_NEGATIVE'&&value.counterparty_presentation_side==='CREDIT')||
     (value.source_classification==='DUE_TO'&&left<0n&&value.source_normal_sign==='CREDIT_NEGATIVE'&&value.source_presentation_side==='CREDIT'&&value.counterparty_classification==='DUE_FROM'&&right>0n&&value.counterparty_normal_sign==='DEBIT_POSITIVE'&&value.counterparty_presentation_side==='DEBIT'));
}

const OPTION_KEYS=['schema_version','reporting_entity_id','reporting_period_id','group_ref','source_entity_id','source_period_id','counterparty_entity_id','counterparty_period_id','consolidation_snapshot_id','currency','options','action_flags'];
export function validIntercompanyEliminationCreateOptions(value,{reportingEntityId,reportingPeriodId,groupRef,sourceEntityId,sourcePeriodId,counterpartyEntityId,counterpartyPeriodId}={}){
  return exact(value,OPTION_KEYS)&&value.schema_version==='INTERCOMPANY_ELIMINATION_CREATE_OPTIONS_V1'&&uuid(value.reporting_entity_id)&&uuid(value.reporting_period_id)&&
    (!reportingEntityId||value.reporting_entity_id===reportingEntityId)&&(!reportingPeriodId||value.reporting_period_id===reportingPeriodId)&&
    uuid(value.source_entity_id)&&uuid(value.source_period_id)&&uuid(value.counterparty_entity_id)&&uuid(value.counterparty_period_id)&&value.source_entity_id!==value.counterparty_entity_id&&(!groupRef||value.group_ref===groupRef)&&(!sourceEntityId||value.source_entity_id===sourceEntityId)&&(!sourcePeriodId||value.source_period_id===sourcePeriodId)&&(!counterpartyEntityId||value.counterparty_entity_id===counterpartyEntityId)&&(!counterpartyPeriodId||value.counterparty_period_id===counterpartyPeriodId)&&
    (value.consolidation_snapshot_id===null||uuid(value.consolidation_snapshot_id))&&(value.currency===null||/^[A-Z]{3}$/.test(value.currency))&&
    Array.isArray(value.options)&&value.options.every(option=>validIntercompanyEliminationSource(option)&&option.reporting_entity_id===value.reporting_entity_id&&option.reporting_period_id===value.reporting_period_id&&option.group_ref===value.group_ref&&option.source_entity_id===value.source_entity_id&&option.source_period_id===value.source_period_id&&option.counterparty_entity_id===value.counterparty_entity_id&&option.counterparty_period_id===value.counterparty_period_id&&option.consolidation_snapshot_id===value.consolidation_snapshot_id&&option.currency===value.currency)&&flags(value.action_flags)&&value.action_flags.can_create_draft===(value.options.length>0);
}

const LINE_KEYS=['line_no','member_entity_id','member_period_id','source_account_code','source_classification','presentation_account_code','presentation_side','entry_side','debit_amount','credit_amount','consolidation_mapping_hash','line_evidence_hash'];
const HISTORY_KEYS=['from_status','to_status','revision','actor_id','reason','event_hash','created_at'];
const BATCH_KEYS=['schema_version','intercompany_elimination_batch_id','reporting_entity_id','reporting_period_id','reporting_period_ledger_code','reporting_period_status','reporting_period_version','period_start','period_end','consolidation_snapshot_id','consolidation_version','consolidation_snapshot_hash','consolidation_receipt_hash','consolidation_member_population_hash','consolidation_account_map_population_hash','group_ref','currency','source_entity_id','source_period_id','source_period_ledger_code','source_period_status','source_period_version','source_account_code','source_classification','source_normal_sign','source_closing_balance','source_mapping_snapshot_id','source_mapping_snapshot_hash','source_journal_entry_ids','source_journal_line_ids','source_ledger_line_ids','source_document_ids','source_presentation_account_code','source_presentation_side','source_consolidation_mapping_hash','counterparty_entity_id','counterparty_period_id','counterparty_period_ledger_code','counterparty_period_status','counterparty_period_version','counterparty_account_code','counterparty_classification','counterparty_normal_sign','counterparty_closing_balance','counterparty_mapping_snapshot_id','counterparty_mapping_snapshot_hash','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids','counterparty_presentation_account_code','counterparty_presentation_side','counterparty_consolidation_mapping_hash','matched_amount','raw_mismatch','canonical_source_scope_hash','source_evidence_hash','source_current','status','revision','lines','history','consolidation_results','created_by','created_at','submitted_by','submitted_at','reviewed_by','reviewed_at','approved_by','approved_at','posted_by','posted_at','cancelled_by','cancelled_at','cancel_reason','post_evidence_hash','action_flags'];

const line=value=>exact(value,LINE_KEYS)&&[1,2].includes(value.line_no)&&uuid(value.member_entity_id)&&uuid(value.member_period_id)&&['DUE_FROM','DUE_TO'].includes(value.source_classification)&&['DEBIT','CREDIT'].includes(value.presentation_side)&&['DEBIT','CREDIT'].includes(value.entry_side)&&money(value.debit_amount)&&money(value.credit_amount)&&sha(value.consolidation_mapping_hash)&&sha(value.line_evidence_hash);
const history=value=>exact(value,HISTORY_KEYS)&&(value.from_status===null||INTERCOMPANY_ELIMINATION_STATUSES.includes(value.from_status))&&INTERCOMPANY_ELIMINATION_STATUSES.includes(value.to_status)&&revision(value.revision)&&typeof value.actor_id==='string'&&sha(value.event_hash);
const pairPresent=(actor,at)=>(actor===null&&at===null)||(typeof actor==='string'&&actor.length>0&&typeof at==='string'&&at.length>0);
const lifecycleValid=value=>{
  if(!pairPresent(value.submitted_by,value.submitted_at)||!pairPresent(value.reviewed_by,value.reviewed_at)||!pairPresent(value.approved_by,value.approved_at)||!pairPresent(value.posted_by,value.posted_at)||!pairPresent(value.cancelled_by,value.cancelled_at))return false;
  const submitted=value.submitted_by!==null,reviewed=value.reviewed_by!==null,approved=value.approved_by!==null,posted=value.posted_by!==null,cancelled=value.cancelled_by!==null;
  if((reviewed&&!submitted)||(approved&&!reviewed)||(posted&&!approved)||(cancelled!==(value.status==='CANCELLED'))||(value.cancel_reason===null)!==!cancelled)return false;
  if(value.status==='DRAFT'&&(submitted||reviewed||approved||posted)||value.status==='PENDING_REVIEW'&&(!submitted||reviewed||approved||posted)||value.status==='REVIEWED'&&(!reviewed||approved||posted)||value.status==='APPROVED'&&(!approved||posted)||value.status==='POSTED'&&!posted)return false;
  const actors=[value.created_by,value.reviewed_by,value.approved_by,value.posted_by].filter(Boolean);if(new Set(actors).size!==actors.length)return false;
  if(cancelled&&[value.created_by,value.reviewed_by,value.approved_by].filter(Boolean).includes(value.cancelled_by))return false;
  const currentRevision=Number(value.revision);if(!Number.isSafeInteger(currentRevision)||value.history.length!==currentRevision+1)return false;
  return value.history.every((event,index)=>{
    if(event.revision!==String(index)||!Number.isFinite(Date.parse(event.created_at))||event.to_status!=='POSTED'&&!canonicalText(event.reason,2000)||event.to_status==='POSTED'&&event.reason!==null)return false;
    if(index===0)return event.from_status===null&&event.to_status==='DRAFT'&&event.actor_id===value.created_by;
    if(event.from_status!==value.history[index-1].to_status)return false;
    const actor={PENDING_REVIEW:value.submitted_by,REVIEWED:value.reviewed_by,APPROVED:value.approved_by,POSTED:value.posted_by,CANCELLED:value.cancelled_by}[event.to_status];return actor!==undefined&&event.actor_id===actor;
  })&&value.history.at(-1).to_status===value.status;
};
const batchFlagsValid=value=>{
  if(value.action_flags.can_create_draft)return false;const allowed={DRAFT:['can_submit','can_cancel'],PENDING_REVIEW:['can_review','can_cancel'],REVIEWED:['can_approve','can_cancel'],APPROVED:['can_post','can_cancel'],POSTED:[],CANCELLED:[]}[value.status];
  return INTERCOMPANY_ELIMINATION_ACTION_FLAGS.every(key=>!value.action_flags[key]||allowed.includes(key));
};
const CONSOLIDATION_KEYS=['group_ref','period_id','period_code','period_start','period_end','currency','presentation_account_code','presentation_side','report_status','classification_basis','member_count','evidence_member_count','member_actual_amount','elimination_amount','consolidated_amount','consolidation_snapshot_id','consolidation_version','consolidation_snapshot_hash','consolidation_receipt_hash','consolidation_source_ref','consolidation_source_version','member_entity_ids','journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','elimination_refs'];
const textArray=value=>Array.isArray(value)&&value.every(item=>typeof item==='string')&&new Set(value).size===value.length;
const validConsolidationResult=(item,batch,lineItem)=>{
  if(!exact(item,CONSOLIDATION_KEYS)||item.group_ref!==batch.group_ref||item.period_id!==batch.reporting_period_id||item.currency!==batch.currency||item.consolidation_snapshot_id!==batch.consolidation_snapshot_id||item.consolidation_version!==batch.consolidation_version||item.consolidation_snapshot_hash!==batch.consolidation_snapshot_hash||item.consolidation_receipt_hash!==batch.consolidation_receipt_hash||item.presentation_account_code!==lineItem.presentation_account_code||item.presentation_side!==lineItem.presentation_side)return false;
  if(!Number.isInteger(item.member_count)||item.member_count<1||!Number.isInteger(item.evidence_member_count)||item.evidence_member_count<0||!uuidArray(item.member_entity_ids)||!uuidArray(item.journal_entry_ids)||!uuidArray(item.journal_line_ids)||!uuidArray(item.ledger_line_ids)||!uuidArray(item.source_document_ids)||!textArray(item.elimination_refs))return false;
  const expectedRef=`INTERCOMPANY_ELIMINATION_BATCH:${batch.intercompany_elimination_batch_id}:LINE:${lineItem.line_no}`;
  if(!item.elimination_refs.includes(expectedRef))return false;
  if(batch.source_current){
    const member=moneyUnits(item.member_actual_amount),elimination=moneyUnits(item.elimination_amount),consolidated=moneyUnits(item.consolidated_amount),matched=moneyUnits(batch.matched_amount);
    return item.report_status==='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT'&&member!==null&&elimination===matched&&consolidated===member-elimination;
  }
  return item.report_status==='BLOCKED_STALE_INTERCOMPANY_ELIMINATION_SOURCE'&&item.classification_basis==='POSTED_INTERCOMPANY_ELIMINATION_SOURCE_EVIDENCE_CHANGED_NEW_CONSOLIDATION_SNAPSHOT_REQUIRED'&&item.member_actual_amount===null&&item.elimination_amount===null&&item.consolidated_amount===null;
};

export function validIntercompanyEliminationBatch(value,{reportingEntityId,batchId}={}){
  if(!exact(value,BATCH_KEYS)&&!(exact(value,[...BATCH_KEYS,'idempotent'])&&typeof value.idempotent==='boolean'))return false;
  const left=moneyUnits(value.source_closing_balance),right=moneyUnits(value.counterparty_closing_balance),matched=moneyUnits(value.matched_amount),raw=moneyUnits(value.raw_mismatch);
  if(left===null||right===null||matched===null||raw===null||matched<=0n||raw!==left+right||matched!==matchedUnits(left,right))return false;
  if(!Array.isArray(value.lines)||value.lines.length!==2||!value.lines.every(line)||value.lines[0].line_no!==1||value.lines[1].line_no!==2)return false;
  const endpoints=[
    {entity:value.source_entity_id,period:value.source_period_id,account:value.source_account_code,classification:value.source_classification,presentationAccount:value.source_presentation_account_code,presentationSide:value.source_presentation_side,mappingHash:value.source_consolidation_mapping_hash,lineNo:1},
    {entity:value.counterparty_entity_id,period:value.counterparty_period_id,account:value.counterparty_account_code,classification:value.counterparty_classification,presentationAccount:value.counterparty_presentation_account_code,presentationSide:value.counterparty_presentation_side,mappingHash:value.counterparty_consolidation_mapping_hash,lineNo:2}
  ];
  if(endpoints.some(endpoint=>{
    const item=value.lines[endpoint.lineNo-1];
    if(item.line_no!==endpoint.lineNo||item.member_entity_id!==endpoint.entity||item.member_period_id!==endpoint.period||item.source_account_code!==endpoint.account||item.source_classification!==endpoint.classification||item.presentation_account_code!==endpoint.presentationAccount||item.presentation_side!==endpoint.presentationSide||item.consolidation_mapping_hash!==endpoint.mappingHash)return true;
    const debit=moneyUnits(item.debit_amount),credit=moneyUnits(item.credit_amount);
    return endpoint.classification==='DUE_FROM'?(item.presentation_side!=='DEBIT'||item.entry_side!=='CREDIT'||debit!==0n||credit!==matched):(item.presentation_side!=='CREDIT'||item.entry_side!=='DEBIT'||debit!==matched||credit!==0n);
  }))return false;
  const consolidationValid=value.status==='POSTED'?value.consolidation_results.length===2&&value.lines.every(lineItem=>value.consolidation_results.filter(item=>item.presentation_account_code===lineItem.presentation_account_code&&item.presentation_side===lineItem.presentation_side).length===1&&validConsolidationResult(value.consolidation_results.find(item=>item.presentation_account_code===lineItem.presentation_account_code&&item.presentation_side===lineItem.presentation_side),value,lineItem)):value.consolidation_results.length===0;
  return value.schema_version==='INTERCOMPANY_ELIMINATION_BATCH_V1'&&uuid(value.intercompany_elimination_batch_id)&&uuid(value.reporting_entity_id)&&uuid(value.reporting_period_id)&&
    (!reportingEntityId||value.reporting_entity_id===reportingEntityId)&&(!batchId||value.intercompany_elimination_batch_id===batchId)&&
    ['consolidation_snapshot_id','source_entity_id','source_period_id','source_mapping_snapshot_id','counterparty_entity_id','counterparty_period_id','counterparty_mapping_snapshot_id'].every(key=>uuid(value[key]))&&
    ['consolidation_snapshot_hash','consolidation_receipt_hash','consolidation_member_population_hash','consolidation_account_map_population_hash','source_mapping_snapshot_hash','source_consolidation_mapping_hash','counterparty_mapping_snapshot_hash','counterparty_consolidation_mapping_hash','canonical_source_scope_hash','source_evidence_hash'].every(key=>sha(value[key]))&&
    (value.post_evidence_hash===null||sha(value.post_evidence_hash))&&['reporting_period_version','consolidation_version','source_period_version','counterparty_period_version','revision'].every(key=>revision(value[key]))&&
    ['source_journal_entry_ids','source_journal_line_ids','source_ledger_line_ids','source_document_ids','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids'].every(key=>uuidArray(value[key]))&&
    ['source_closing_balance','counterparty_closing_balance','matched_amount','raw_mismatch'].every(key=>money(value[key]))&&value.reporting_period_ledger_code==='PRIMARY'&&value.source_period_ledger_code==='PRIMARY'&&value.counterparty_period_ledger_code==='PRIMARY'&&['OPEN','SOFT_CLOSED','CLOSED'].includes(value.reporting_period_status)&&['OPEN','SOFT_CLOSED','CLOSED'].includes(value.source_period_status)&&['OPEN','SOFT_CLOSED','CLOSED'].includes(value.counterparty_period_status)&&
    value.source_entity_id!==value.counterparty_entity_id&&canonicalDate(value.period_start)&&canonicalDate(value.period_end)&&value.period_start<=value.period_end&&/^[A-Z]{3}$/.test(value.currency)&&canonicalText(value.group_ref,160)&&[value.source_account_code,value.counterparty_account_code,value.source_presentation_account_code,value.counterparty_presentation_account_code].every(item=>ACCOUNT.test(item))&&canonicalText(value.created_by,200)&&Number.isFinite(Date.parse(value.created_at))&&(value.status==='POSTED'?sha(value.post_evidence_hash):value.post_evidence_hash===null)&&
    ((value.source_classification==='DUE_FROM'&&left>0n&&value.source_normal_sign==='DEBIT_POSITIVE'&&value.counterparty_classification==='DUE_TO'&&right<0n&&value.counterparty_normal_sign==='CREDIT_NEGATIVE')||(value.source_classification==='DUE_TO'&&left<0n&&value.source_normal_sign==='CREDIT_NEGATIVE'&&value.counterparty_classification==='DUE_FROM'&&right>0n&&value.counterparty_normal_sign==='DEBIT_POSITIVE'))&&
    INTERCOMPANY_ELIMINATION_STATUSES.includes(value.status)&&typeof value.source_current==='boolean'&&
    Array.isArray(value.history)&&value.history.every(history)&&lifecycleValid(value)&&Array.isArray(value.consolidation_results)&&consolidationValid&&flags(value.action_flags)&&batchFlagsValid(value);
}

const validCommandBatch=(value,scope,status,revisionValue)=>validIntercompanyEliminationBatch(value,scope)&&typeof value.idempotent==='boolean'&&value.status===status&&value.revision===String(revisionValue);
export const validIntercompanyEliminationCreateReceipt=(value,{reportingEntityId,reportingPeriodId,consolidationSnapshotId,sourceEntityId,sourcePeriodId,counterpartyEntityId,counterpartyPeriodId,sourceAccountCode,expectedSourceEvidenceHash}={})=>
  validCommandBatch(value,{reportingEntityId},'DRAFT',0)&&value.reporting_period_id===reportingPeriodId&&value.consolidation_snapshot_id===consolidationSnapshotId&&value.source_entity_id===sourceEntityId&&value.source_period_id===sourcePeriodId&&value.counterparty_entity_id===counterpartyEntityId&&value.counterparty_period_id===counterpartyPeriodId&&value.source_account_code===sourceAccountCode&&value.source_evidence_hash===expectedSourceEvidenceHash;
export const validIntercompanyEliminationTransitionReceipt=(value,{action,expectedRevision,...scope}={})=>{
  const status={SUBMIT:'PENDING_REVIEW',REVIEW:'REVIEWED',APPROVE:'APPROVED'}[action];
  return Number.isSafeInteger(expectedRevision)&&expectedRevision>=0&&Boolean(status)&&validCommandBatch(value,scope,status,expectedRevision+1);
};
export const validIntercompanyEliminationCancelReceipt=(value,{expectedRevision,...scope}={})=>Number.isSafeInteger(expectedRevision)&&expectedRevision>=0&&validCommandBatch(value,scope,'CANCELLED',expectedRevision+1);
export const validIntercompanyEliminationPostReceipt=(value,{expectedRevision,...scope}={})=>Number.isSafeInteger(expectedRevision)&&expectedRevision>=0&&validCommandBatch(value,scope,'POSTED',expectedRevision+1);

const REGISTER_KEYS=['schema_version','reporting_entity_id','reporting_period_id','rows','limit','action_flags'];
export function validIntercompanyEliminationRegister(value,{reportingEntityId,reportingPeriodId,limit}={}){
  return exact(value,REGISTER_KEYS)&&value.schema_version==='INTERCOMPANY_ELIMINATION_REGISTER_V1'&&uuid(value.reporting_entity_id)&&uuid(value.reporting_period_id)&&
    (!reportingEntityId||value.reporting_entity_id===reportingEntityId)&&(!reportingPeriodId||value.reporting_period_id===reportingPeriodId)&&value.limit===limit&&
    Array.isArray(value.rows)&&value.rows.every(row=>validIntercompanyEliminationBatch(row,{reportingEntityId}))&&flags(value.action_flags);
}
