import {createHash} from 'node:crypto';
import {canonicalRequestHash} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const COMPANY_CODE=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const CURRENCY=/^[A-Z]{3}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const freeze=value=>Object.freeze(value);
const text=(value,max=256)=>{if(value==null||String(value).trim()==='')return null;const out=String(value).trim();if(out.length>max||CONTROL.test(out))return null;return out;};
const strictDate=value=>{const raw=text(value,32);if(!raw||!/^\d{4}-\d{2}-\d{2}(?:[ T].*)?$/.test(raw))return null;const date=raw.slice(0,10),[y,m,d]=date.split('-').map(Number),parsed=new Date(Date.UTC(y,m-1,d));return parsed.getUTCFullYear()===y&&parsed.getUTCMonth()===m-1&&parsed.getUTCDate()===d?date:null;};
const strictUtcTimestamp=value=>{const raw=text(value,32);if(!raw||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw))return null;const parsed=new Date(raw);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString()===raw?raw:null;};
const money=value=>{const raw=typeof value==='number'&&Number.isFinite(value)?String(value):text(value,64);if(!raw||! /^-?(?:0|[1-9]\d{0,15})(?:\.\d+)?$/.test(raw))return null;const [whole,fraction='']=raw.split('.');if(fraction.length>4&&!/^0+$/.test(fraction.slice(4)))return null;return `${whole}.${fraction.slice(0,4).padEnd(4,'0')}`;};
const units=value=>{const normalized=money(value);return normalized===null?null:BigInt(normalized.replace('.',''));};
const fromUnits=value=>`${value<0n?'-':''}${String(value<0n?-value:value).padStart(5,'0').slice(0,-4)}.${String(value<0n?-value:value).padStart(5,'0').slice(-4)}`;
const optional=(row,...names)=>{for(const name of names){const out=text(row?.[name]);if(out!==null)return out;}return null;};
const lineHash=line=>canonicalRequestHash(line);
export const orderedLineHashStreamHash=lineHashes=>{const hash=createHash('sha256');for(const value of lineHashes)hash.update(`${value}\n`,'utf8');return `sha256:${hash.digest('hex')}`;};

export class WbsH1AccountingControlError extends Error{constructor(code,message){super(message);this.name='WbsH1AccountingControlError';this.code=code;}}
const fail=(code,message)=>{throw new WbsH1AccountingControlError(code,message);};

export function normalizeWbsH1AccountingControlRow(row,{tenantId,entityId,companyCode,currency,sourceVersion,rowOrdinal}={}){
  const sourceId=Number(row?.id),sourceCompany=text(row?.com_code??row?.company_code,64),postingDate=strictDate(row?.posting_date),setDate=strictDate(row?.set_date);
  const debit=money(row?.debtor??(String(row?.accounting_type||'').toUpperCase()==='DEBIT'?row?.accounting_value:null));
  const credit=money(row?.lender??(String(row?.accounting_type||'').toUpperCase()==='CREDIT'?row?.accounting_value:null));
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!COMPANY_CODE.test(companyCode||'')||!CURRENCY.test(currency||'')||!sourceVersion||!SHA.test(sourceVersion)||!Number.isSafeInteger(sourceId)||sourceId<1||sourceCompany!==companyCode||!Number.isSafeInteger(rowOrdinal)||rowOrdinal<1||debit===null||credit===null||(units(debit)!==0n&&units(credit)!==0n))fail('WBS_H1_ACCOUNTING_CONTROL_ROW_INVALID','WBS accounting control rows require exact scope, stable identity, and at most one signed MONEY4 debit/credit side.');
  const account=optional(row,'account'),payee=optional(row,'payee_no','payee'),project=optional(row,'pj_code','project_code','project'),cost=optional(row,'cost_code'),unit=optional(row,'unit_guid','unit_code','unit');
  const date=postingDate??setDate,periodCode=date?.slice(0,7)??null,inH1=periodCode!==null&&periodCode>='2026-01'&&periodCode<='2026-06';
  const gaps=[];if(!postingDate)gaps.push('MISSING_POSTING_DATE');if(!account)gaps.push('MISSING_ACCOUNT');if(!project)gaps.push('MISSING_PROJECT');if(!cost)gaps.push('MISSING_COST_CODE');if(!payee)gaps.push('MISSING_PAYEE');if(units(debit)===0n&&units(credit)===0n)gaps.push('ZERO_AMOUNT');
  const completenessStatus=!inH1?'OUTSIDE_H1':gaps.length===0?'COMPLETE':gaps.length===1?gaps[0]:'MULTIPLE_GAPS';
  const cbId=optional(row,'cb_id');
  const facts={tenant_id:tenantId,entity_id:entityId,company_code:companyCode,currency,source_version:sourceVersion,wbs_accounting_info_id:sourceId,row_ordinal:rowOrdinal,journal_group_id:cbId??optional(row,'journal_group_id','journal_no','business_guid'),line_no:Number.isSafeInteger(Number(row?.sort??row?.line_no))?Number(row?.sort??row?.line_no):null,period_code:inH1?periodCode:null,set_date:setDate,posting_date:postingDate,account_code:account,debit_amount:debit,credit_amount:credit,member_ref:payee,project_ref:project,property_ref:optional(row,'property_ref','property'),cost_code:cost,unit_ref:unit,business_guid:optional(row,'business_guid'),sys_id:optional(row,'sys_id'),bill_no:optional(row,'bill_no'),cb_id:cbId,come_from:optional(row,'come_from')??'UNKNOWN',source:optional(row,'source')??'UNKNOWN',review_status:optional(row,'review')??'UNKNOWN',closed_status:optional(row,'closed')??'UNKNOWN',completeness_status:completenessStatus,gap_codes:gaps,excluded_from_h1:!inH1};
  return freeze({...facts,line_hash:lineHash(facts)});
}

export function buildWbsH1AccountingControlPopulation({tenantId,entityId,companyCode,currency,sourceVersion,snapshotTokenHash,providerContentHash,sourceManifest,capturedAt,rows}={}){
  const capturedAtUtc=strictUtcTimestamp(capturedAt);
  const manifestKeys=['bytes','company_code','date_from','date_to','domain','file_name','generated_at','period','rows','schema_version','sha256'];
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!COMPANY_CODE.test(companyCode||'')||!CURRENCY.test(currency||'')||!SHA.test(sourceVersion||'')||!SHA.test(snapshotTokenHash||'')||!SHA.test(providerContentHash||'')||!capturedAtUtc||!sourceManifest||JSON.stringify(Object.keys(sourceManifest).sort())!==JSON.stringify(manifestKeys)||sourceManifest.schema_version!=='WBS_H1_2026_LOCAL_SNAPSHOT_V1'||sourceManifest.domain!=='accounting_info'||sourceManifest.company_code!==companyCode||sourceManifest.period!=='2026-H1'||sourceManifest.date_from!=='2026-01-01'||sourceManifest.date_to!=='2026-06-30'||sourceManifest.generated_at!==capturedAtUtc||sourceManifest.sha256!==providerContentHash.slice(7)||sourceManifest.rows!==rows?.length||!Number.isSafeInteger(sourceManifest.bytes)||sourceManifest.bytes<1||typeof sourceManifest.file_name!=='string'||!/^accounting_info__[A-Z0-9][A-Z0-9_:-]{0,63}__2026-H1\.ndjson$/.test(sourceManifest.file_name)||!Array.isArray(rows)||rows.length<1)fail('WBS_H1_ACCOUNTING_CONTROL_POPULATION_INVALID','A complete immutable manifest-bound WBS accounting snapshot is required.');
  const ordered=[...rows].sort((a,b)=>Number(a.id)-Number(b.id));if(new Set(ordered.map(row=>row.id)).size!==ordered.length)fail('WBS_H1_ACCOUNTING_CONTROL_DUPLICATE','WBS accounting source identities must be unique.');
  const lines=ordered.map((row,index)=>normalizeWbsH1AccountingControlRow(row,{tenantId,entityId,companyCode,currency,sourceVersion,rowOrdinal:index+1}));
  const included=lines.filter(line=>!line.excluded_from_h1),debit=included.reduce((sum,line)=>sum+units(line.debit_amount),0n),credit=included.reduce((sum,line)=>sum+units(line.credit_amount),0n);
  if(debit!==credit)fail('WBS_H1_ACCOUNTING_CONTROL_UNBALANCED','The complete WBS H1 accounting population must balance before retention.');
  const populationHash=orderedLineHashStreamHash(lines.map(line=>line.line_hash));
  const groups=new Map();for(const line of included){const key=`${line.period_code}\0${line.currency}\0${line.come_from}`;const group=groups.get(key)??{period_code:line.period_code,currency:line.currency,module_code:line.come_from,row_count:0,debit:0n,credit:0n,line_hashes:[]};group.row_count++;group.debit+=units(line.debit_amount);group.credit+=units(line.credit_amount);group.line_hashes.push(line.line_hash);groups.set(key,group);}
  const moduleReceipts=[...groups.values()].sort((a,b)=>`${a.period_code}\0${a.currency}\0${a.module_code}`.localeCompare(`${b.period_code}\0${b.currency}\0${b.module_code}`)).map(group=>freeze({period_code:group.period_code,currency:group.currency,module_code:group.module_code,row_count:group.row_count,debit_amount:fromUnits(group.debit),credit_amount:fromUnits(group.credit),balance_status:group.debit===group.credit?'BALANCED':'UNBALANCED',module_hash:orderedLineHashStreamHash(group.line_hashes)}));
  if(moduleReceipts.some(receipt=>receipt.balance_status!=='BALANCED'))fail('WBS_H1_ACCOUNTING_CONTROL_MODULE_UNBALANCED','Every period/currency/module control population must balance.');
  return freeze({schema_version:'WBS_H1_ACCOUNTING_CONTROL_POPULATION_V1',tenant_id:tenantId,entity_id:entityId,company_code:companyCode,currency,source_version:sourceVersion,snapshot_token_hash:snapshotTokenHash,provider_content_hash:providerContentHash,source_manifest:freeze({...sourceManifest}),source_manifest_hash:canonicalRequestHash(sourceManifest),captured_at:capturedAtUtc,expected_row_count:lines.length,included_h1_row_count:included.length,excluded_row_count:lines.length-included.length,expected_debit_amount:fromUnits(debit),expected_credit_amount:fromUnits(credit),population_hash:populationHash,lines:freeze(lines),module_receipts:freeze(moduleReceipts),accounting_authority:'CONTROL_EVIDENCE_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false});
}
