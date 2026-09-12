import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY=/^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const CURRENCY=/^[A-Z]{3}$/;
const JOURNAL_TYPES=new Set(['MANUAL','AUTO','REVERSAL','RECLASS']);
const ROW_FIELDS=Object.freeze(['journal_entry_id','journal_number','journal_type','status','journal_date','currency','description','revision','created_at','posted_at','line_no','journal_line_id','account_code','debit_amount','credit_amount','member_ref','line_description','dimensions','source_document_ids']);
const ROW_KEYS=Object.freeze([...ROW_FIELDS].sort());
const calendar=(year,month,day)=>{const probe=new Date(Date.UTC(year,month-1,day));return probe.getUTCFullYear()===year&&probe.getUTCMonth()===month-1&&probe.getUTCDate()===day;};
const date=value=>{if(typeof value!=='string'||!/^(\d{4})-(\d{2})-(\d{2})$/.test(value))return false;const [,year,month,day]=value.match(/^(\d{4})-(\d{2})-(\d{2})$/);return calendar(Number(year),Number(month),Number(day));};
const timestamp=value=>{if(value instanceof Date)return !Number.isNaN(value.getTime());if(typeof value!=='string'||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.test(value))return false;const match=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/),[,year,month,day,hour,minute,second]=match;return calendar(Number(year),Number(month),Number(day))&&Number(hour)<24&&Number(minute)<60&&Number(second)<60&&!Number.isNaN(Date.parse(value));};
const text=(value,max)=>value===null||value===undefined||typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.join('|');
const ids=value=>Array.isArray(value)&&value.length<=100&&new Set(value).size===value.length&&value.every(id=>UUID.test(id||''));
const amount=value=>typeof value==='string'&&MONEY.test(value);
const decimal=value=>BigInt(value.replace('.',''));

export function validJournalUploadRows(rows){
  if(!Array.isArray(rows)||rows.length<2||rows.length>10000)return false;
  const totals=new Map();
  for(const row of rows){
    if(!exact(row,ROW_KEYS)||!UUID.test(row.journal_entry_id||'')||typeof row.journal_number!=='string'||row.journal_number.length<1||row.journal_number.length>128||/[\u0000-\u001f\u007f]/.test(row.journal_number)||!JOURNAL_TYPES.has(row.journal_type)||row.status!=='APPROVED'||!date(row.journal_date)||!CURRENCY.test(row.currency||'')||!text(row.description,2000)||!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<0||!timestamp(row.created_at)||row.posted_at!==null&&!timestamp(row.posted_at)||!Number.isSafeInteger(row.line_no)||row.line_no<1||!UUID.test(row.journal_line_id||'')||!/^[A-Za-z0-9._-]{1,64}$/.test(row.account_code||'')||!amount(row.debit_amount)||!amount(row.credit_amount)||(row.debit_amount==='0.0000')===(row.credit_amount==='0.0000')||!text(row.member_ref,200)||!text(row.line_description,2000)||!row.dimensions||typeof row.dimensions!=='object'||Array.isArray(row.dimensions)||!ids(row.source_document_ids))return false;
    const key=row.journal_entry_id+':'+row.line_no;
    const total=totals.get(row.journal_entry_id)||{currency:row.currency,lines:new Set(),debit:0n,credit:0n};
    if(total.currency!==row.currency||total.lines.has(key))return false;
    total.lines.add(key);total.debit+=decimal(row.debit_amount);total.credit+=decimal(row.credit_amount);totals.set(row.journal_entry_id,total);
  }
  return [...totals.values()].every(total=>total.lines.size>=2&&total.debit===total.credit);
}

const scalar=value=>value===null||value===undefined?'':Array.isArray(value)?value.join(';'):typeof value==='object'?JSON.stringify(value):String(value);
const csvCell=value=>{const text=scalar(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};

export function buildJournalUploadCsv({rows,entityId,periodId}={}){
  if(!UUID.test(entityId||'')||!UUID.test(periodId||'')||!validJournalUploadRows(rows))return null;
  const fields=['JournalNumber','JournalDate','JournalType','AccountCode','Currency','Debit','Credit','Description','MemberRef','SourceDocumentIds'];
  const lines=[fields.join(',')];
  for(const row of rows)lines.push([row.journal_number,row.journal_date,row.journal_type,row.account_code,row.currency,row.debit_amount,row.credit_amount,row.line_description??row.description??'',row.member_ref??'',row.source_document_ids.join(';')].map(csvCell).join(','));
  const content=`${lines.join('\r\n')}\r\n`;
  const contentHash=`sha256:${createHash('sha256').update(content,'utf8').digest('hex')}`;
  const journalIds=[...new Set(rows.map(row=>row.journal_entry_id))];
  return Object.freeze({schema_version:'JOURNAL_UPLOAD_EXPORT_V1',format:'CSV',content_type:'text/csv; charset=utf-8',filename:`journal-upload-${entityId}-${periodId}.csv`,entity_id:entityId,period_id:periodId,journal_entry_ids:Object.freeze(journalIds),row_count:rows.length,content_hash:contentHash,content});
}

export const JOURNAL_UPLOAD_EXPORT_ROW_FIELDS=ROW_FIELDS;
