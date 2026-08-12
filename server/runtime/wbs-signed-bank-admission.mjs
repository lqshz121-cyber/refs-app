import {canonicalRequestHash} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const REF=/^(object|s3):\/\//;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY=/^-?(?:0|[1-9]\d{0,15})\.\d{4}$/;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max;
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const exact=(value,keys,code)=>{const allowed=new Set(keys);if(Object.keys(value).some(key=>!allowed.has(key)))fail(code,'The signed admission contains an unexpected field.');};

export class WbsSignedBankAdmissionError extends Error{
  constructor(code,message){super(message);this.name='WbsSignedBankAdmissionError';this.code=code;}
}

function fail(code,message){throw new WbsSignedBankAdmissionError(code,message);}

export function validateWbsSignedBankAdmission(admission){
  if(!object(admission)||admission.schema_version!=='WBS_SIGNED_BANK_ADMISSION_V1'||admission.environment!=='PRODUCTION'||admission.source_system!=='WBS'||admission.admission_status!=='ADMITTED')fail('WBS_BANK_ADMISSION_INVALID','A production ADMITTED WBS bank admission manifest is required.');
  exact(admission,['schema_version','environment','source_system','admission_status','snapshot_id','package_hash','source_entity_id','statement','transactions','detached_signature','admission_hash'],'WBS_BANK_ADMISSION_INVALID');
  if(!UUID.test(admission.snapshot_id||'')||!HASH.test(admission.package_hash||'')||!text(admission.source_entity_id,128))fail('WBS_BANK_ADMISSION_INVALID','The signed snapshot identity is incomplete.');
  const statement=admission.statement;
  if(!object(statement)||!text(statement.statement_id,128)||!text(statement.bank_account_ref,128)||!/^[A-Z]{3}$/.test(statement.currency||'')||!DATE.test(statement.statement_start_date||'')||!DATE.test(statement.statement_end_date||'')||statement.statement_start_date>statement.statement_end_date||!MONEY.test(statement.opening_balance||'')||!MONEY.test(statement.ending_balance||'')||!HASH.test(statement.payload_hash||'')||!REF.test(statement.payload_ref||''))fail('WBS_BANK_STATEMENT_INVALID','The signed bank statement header is incomplete or invalid.');
  exact(statement,['statement_id','bank_account_ref','statement_start_date','statement_end_date','currency','opening_balance','ending_balance','payload_hash','payload_ref'],'WBS_BANK_STATEMENT_INVALID');
  if(!Array.isArray(admission.transactions)||admission.transactions.length<1||admission.transactions.length>1000)fail('WBS_BANK_TRANSACTION_INVALID','The signed admission must contain between 1 and 1000 bank transactions.');
  const seen=new Set();
  const transactions=admission.transactions.map(item=>{
    if(!object(item)||!text(item.source_record_id,128)||!text(item.source_version,128)||!text(item.external_bank_line_id,128)||!HASH.test(item.payload_hash||'')||!REF.test(item.payload_ref||'')||!DATE.test(item.transaction_date||'')||item.transaction_date<statement.statement_start_date||item.transaction_date>statement.statement_end_date||item.currency!==statement.currency||item.bank_account_ref!==statement.bank_account_ref||!MONEY.test(item.amount||'')||Number(item.amount)===0)fail('WBS_BANK_TRANSACTION_INVALID','A bank transaction is invalid or outside the signed statement scope.');
    exact(item,['source_record_id','source_version','external_bank_line_id','payload_hash','payload_ref','transaction_date','currency','bank_account_ref','amount'],'WBS_BANK_TRANSACTION_INVALID');
    if(seen.has(item.external_bank_line_id)||seen.has(`record:${item.source_record_id}`))fail('WBS_BANK_TRANSACTION_DUPLICATE','The signed admission contains duplicate transaction identities.');
    seen.add(item.external_bank_line_id);seen.add(`record:${item.source_record_id}`);
    return Object.freeze({...item});
  });
  const signature=admission.detached_signature;
  if(!object(signature)||!text(signature.key_id,128)||signature.algorithm!=='Ed25519'||!text(signature.value,4096))fail('WBS_BANK_ADMISSION_SIGNATURE_REQUIRED','The admission requires an Ed25519 detached signature.');
  exact(signature,['key_id','algorithm','value'],'WBS_BANK_ADMISSION_SIGNATURE_REQUIRED');
  const computed=canonicalRequestHash(without(admission,'admission_hash','detached_signature'));
  if(admission.admission_hash!==computed)fail('WBS_BANK_ADMISSION_HASH_MISMATCH','The admission hash does not match the signed manifest.');
  return Object.freeze({...admission,statement:Object.freeze({...statement}),transactions:Object.freeze(transactions),detached_signature:Object.freeze({...signature})});
}
