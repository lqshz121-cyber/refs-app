import {canonicalRequestHash} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VIEW_POLICY=Object.freeze({
  'BGDATA.payable':Object.freeze({id:'apGuId',kind:'TRANSACTION_CANDIDATE'}),
  'BGDATA.bank_transaction':Object.freeze({id:'cashOrBankBookId',kind:'TRANSACTION_CANDIDATE',scoped:true}),
  'BGDATA.autoc_detail':Object.freeze({id:'pdGuId',kind:'AUTOREC_CANDIDATE'}),
  'BGDATA.autoc_bank':Object.freeze({id:'pbGuId',kind:'CONTROL_SOURCE'}),
  'accounting.accounting_info':Object.freeze({id:'accountingInfoId',kind:'LEDGER_EVIDENCE',scoped:true}),
  'accounting.balance_cell':Object.freeze({id:'controlCellId',kind:'CONTROL_EVIDENCE'}),
  'accounting.income_cell':Object.freeze({id:'controlCellId',kind:'CONTROL_EVIDENCE'})
});

export class WbsSnapshotError extends Error {
  constructor(code,message){super(message);this.name='WbsSnapshotError';this.code=code;}
}

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const iso=value=>text(value,64)&&Number.isFinite(Date.parse(value));
const without=(value,key)=>Object.fromEntries(Object.entries(value).filter(([name])=>name!==key));

function deliveryMetadata(snapshot){
  const delivery=snapshot.delivery;
  const started=Date.parse(delivery?.extract_started_at),completed=Date.parse(delivery?.extract_completed_at),captured=Date.parse(snapshot.captured_at);
  if(!object(delivery)||!['READONLY_VIEW_EXPORT','SIGNED_SNAPSHOT_PACKAGE'].includes(delivery.mode)||!iso(delivery.extract_started_at)||!iso(delivery.extract_completed_at)||delivery.consistency!=='COMPLETE'||!['SNAPSHOT_ISOLATION','REPEATABLE_READ_TRANSACTION'].includes(delivery.read_consistency)||delivery.pagination!=='PRIMARY_KEY_SEEK'||completed<started||captured<started||captured>completed)fail('WBS_SNAPSHOT_DELIVERY_INVALID','Production WBS snapshots require a complete consistent primary-key-paged delivery receipt.');
  return Object.freeze({mode:delivery.mode,extract_started_at:delivery.extract_started_at,extract_completed_at:delivery.extract_completed_at,consistency:delivery.consistency,read_consistency:delivery.read_consistency,pagination:delivery.pagination});
}

function fail(code,message){throw new WbsSnapshotError(code,message);}

export function validateWbsSnapshotPackage(snapshot){
  if(!object(snapshot))fail('WBS_SNAPSHOT_INVALID','WBS snapshot must be an object.');
  if(!['WBS_READONLY_SNAPSHOT_V1','WBS_READONLY_SNAPSHOT_V2'].includes(snapshot.schema_version)||!UUID.test(snapshot.snapshot_id||'')||!iso(snapshot.captured_at)||!['SANDBOX','PRODUCTION'].includes(snapshot.environment)||snapshot.source_system!=='WBS'||!text(snapshot.dictionary_version)||!Array.isArray(snapshot.views)||snapshot.views.length===0)fail('WBS_SNAPSHOT_INVALID','WBS snapshot manifest is incomplete.');
  if(snapshot.environment==='PRODUCTION'&&snapshot.schema_version!=='WBS_READONLY_SNAPSHOT_V2')fail('WBS_SNAPSHOT_DELIVERY_INVALID','Production WBS snapshots require schema version V2.');
  const delivery=snapshot.schema_version==='WBS_READONLY_SNAPSHOT_V2'?deliveryMetadata(snapshot):null;
  const signature=snapshot.detached_signature;
  if(snapshot.environment==='PRODUCTION'&&(!object(signature)||!text(signature.key_id,128)||signature.algorithm!=='Ed25519'||!text(signature.value,4096)))fail('WBS_SNAPSHOT_SIGNATURE_REQUIRED','Production WBS snapshots require an Ed25519 detached signature.');
  if(snapshot.package_hash!==canonicalRequestHash(without(without(snapshot,'package_hash'),'detached_signature')))fail('WBS_SNAPSHOT_HASH_MISMATCH','WBS snapshot package hash does not match its manifest.');
  const names=new Set(),receipts=[],strictDelivery=snapshot.schema_version==='WBS_READONLY_SNAPSHOT_V2';let companyKey=null;
  for(const view of snapshot.views){
    if(!object(view)||!text(view.name,96)||!VIEW_POLICY[view.name]||names.has(view.name)||!text(view.company_key,128)||!Array.isArray(view.rows)||view.rows.length===0||view.content_hash!==canonicalRequestHash(view.rows))fail('WBS_SNAPSHOT_VIEW_INVALID','WBS snapshot view is incomplete, unsupported, duplicated, or tampered.');
    if(companyKey!==null&&companyKey!==view.company_key)fail('WBS_SNAPSHOT_ENTITY_MIXED','A snapshot import must contain one exact WBS company scope.');
    companyKey=view.company_key;
    names.add(view.name);const policy=VIEW_POLICY[view.name];
    if(strictDelivery&&(!Number.isSafeInteger(view.row_count)||view.row_count!==view.rows.length||view.first_primary_key!==view.rows[0]?.[policy.id]||view.last_primary_key!==view.rows.at(-1)?.[policy.id]))fail('WBS_SNAPSHOT_DELIVERY_INVALID','Production WBS snapshot view receipt is incomplete.');
    const seen=new Set();
    for(const row of view.rows){
      if(!object(row)||!text(row[policy.id],128)||seen.has(row[policy.id]))fail('WBS_SNAPSHOT_ROW_INVALID','WBS snapshot row lacks a unique stable source key.');
      if(['apGuId','pdGuId','pbGuId'].includes(policy.id)&&!UUID.test(row[policy.id]))fail('WBS_SNAPSHOT_ROW_INVALID','WBS GuId source key is invalid.');
      if(policy.scoped&&(!text(row.bank_account_ref||row.account_book_ref||row.ledger_ref,128)))fail('WBS_SNAPSHOT_ROW_INVALID','WBS bank or ledger evidence lacks its required account scope.');
      seen.add(row[policy.id]);
      const rowHash=canonicalRequestHash(row);
      receipts.push(Object.freeze({snapshot_id:snapshot.snapshot_id,captured_at:snapshot.captured_at,environment:snapshot.environment,source_system:'WBS',source_module:view.name,source_entity_id:view.company_key,source_record_id:row[policy.id],source_version:`snapshot:${snapshot.snapshot_id}:${rowHash.slice(7,23)}`,payload_hash:rowHash,payload_ref:`object://wbs-snapshot/${snapshot.snapshot_id}/${encodeURIComponent(view.name)}/${encodeURIComponent(row[policy.id])}`,ingestion_kind:policy.kind}));
    }
  }
  return Object.freeze({snapshot_id:snapshot.snapshot_id,captured_at:snapshot.captured_at,environment:snapshot.environment,dictionary_version:snapshot.dictionary_version,company_key:companyKey,package_hash:snapshot.package_hash,delivery,receipt_count:receipts.length,receipts:Object.freeze(receipts)});
}
