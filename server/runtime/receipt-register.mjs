const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const nullableText=(value,max=256)=>value===null||text(value,max);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const nonnegative=value=>Number.isInteger(value)&&value>=0;
const bytes=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value);
const money=value=>typeof value==='string'&&/^-?(0|[1-9]\d{0,17})\.\d{4}$/.test(value);
const statuses=new Set(['FOR_REVIEW','REVIEWED']);
const flags=['can_upload','can_run_ocr','can_review','can_add_to_books','can_export','can_customize','can_promote_payment'];
const rowKeys=['receipt_id','receipt_created_by','receipt_created_at','attachment_id','attachment_name','media_type','size_bytes','content_hash','storage_ref','storage_version','uploaded_by','uploaded_at','verified_at','finalized_at','scan_status','finalization_status','source_document_id','source_document_revision','source_payload_hash','staging_item_id','staging_revision','review_status','reviewed_by','reviewed_at','extracted_facts','action_flags'];
const factKeys=['source_system','source_module','source_record_id','source_version','document_type','document_no','business_date','accounting_date','currency','gross_amount','line_count','party_refs','project_refs','property_refs','unit_refs','loan_refs','cost_code_refs'];
const pageKeys=['schema_version','entity_id','review_status','row_count','total_size_bytes','rows','action_flags'];
const falseFlags=value=>exact(value,flags)&&flags.every(key=>value[key]===false);
const textArray=value=>Array.isArray(value)&&value.every(item=>text(item))&&new Set(value).size===value.length;
export const validReceiptSelection=({reviewStatus})=>statuses.has(reviewStatus);
export function validReceiptRow(value,{receiptId=null}={}){
  if(!exact(value,rowKeys)||!uuid(value.receipt_id)||receiptId!==null&&value.receipt_id!==receiptId||!text(value.receipt_created_by)||!timestamp(value.receipt_created_at)||!uuid(value.attachment_id)||!text(value.attachment_name,255)||!text(value.media_type,255)||!bytes(value.size_bytes)||BigInt(value.size_bytes)<1n||!/^sha256:[0-9a-f]{64}$/.test(value.content_hash||'')||!text(value.storage_ref,2000)||!(/^(object|s3):\/\//.test(value.storage_ref))||!text(value.storage_version,512)||!text(value.uploaded_by)||!timestamp(value.uploaded_at)||!timestamp(value.verified_at)||!timestamp(value.finalized_at)||value.scan_status!=='CLEAN'||value.finalization_status!=='VERIFIED_CLEAN'||!uuid(value.source_document_id)||!nonnegative(value.source_document_revision)||!/^sha256:[0-9a-f]{64}$/.test(value.source_payload_hash||'')||!statuses.has(value.review_status)||!exact(value.extracted_facts,factKeys)||!falseFlags(value.action_flags))return false;
  const stageNull=value.staging_item_id===null&&value.staging_revision===null,stageFull=uuid(value.staging_item_id)&&nonnegative(value.staging_revision);
  if(!(stageNull||stageFull))return false;
  if(value.review_status==='REVIEWED'&&(!stageFull||!text(value.reviewed_by)||!timestamp(value.reviewed_at)))return false;
  if(value.review_status==='FOR_REVIEW'&&(value.reviewed_by!==null||value.reviewed_at!==null))return false;
  const facts=value.extracted_facts;
  return [facts.source_system,facts.source_module,facts.source_record_id,facts.source_version,facts.document_type].every(item=>text(item))&&nullableText(facts.document_no)&&date(facts.business_date)&&date(facts.accounting_date)&&/^[A-Z]{3}$/.test(facts.currency||'')&&money(facts.gross_amount)&&nonnegative(facts.line_count)&&['party_refs','project_refs','property_refs','unit_refs','loan_refs','cost_code_refs'].every(key=>textArray(facts[key]));
}
export function validReceiptRegister(value,{entityId,reviewStatus}){
  if(!uuid(entityId)||!validReceiptSelection({reviewStatus})||!exact(value,pageKeys)||value.schema_version!=='RECEIPT_REGISTER_V1'||value.entity_id!==entityId||value.review_status!==reviewStatus||!nonnegative(value.row_count)||!bytes(value.total_size_bytes)||!Array.isArray(value.rows)||value.row_count!==value.rows.length||!falseFlags(value.action_flags))return false;
  const ids=new Set();let total=0n;
  for(const row of value.rows){if(!validReceiptRow(row)||row.review_status!==reviewStatus||ids.has(row.receipt_id))return false;ids.add(row.receipt_id);total+=BigInt(row.size_bytes);}
  return total===BigInt(value.total_size_bytes);
}
