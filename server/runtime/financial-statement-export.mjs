import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[a-f0-9]{64}$/;
const MONEY=/^-?\d{1,16}\.\d{4}$/;
const CURRENCY=/^[A-Z]{3}$/;
const TYPES=new Set(['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
const ROW_FIELDS=Object.freeze(['financial_statement_snapshot_id','version','currency','snapshot_hash','ledger_evidence_hash','prepared_by','approved_by','approved_at','captured_at','statement_type','statement_section','classification_basis','account_code','account_name','opening_debit','opening_credit','period_debit','period_credit','ending_debit','ending_credit','display_balance','journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','row_hash']);
const ROW_KEYS=Object.freeze([...ROW_FIELDS].sort());
const timestamp=value=>value instanceof Date&&!Number.isNaN(value.getTime())?value.toISOString():typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&!Number.isNaN(Date.parse(value));
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.join('|');
const safeText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const safeIds=value=>Array.isArray(value)&&value.length<=100&&new Set(value).size===value.length&&value.every(id=>UUID.test(id||''));

export function validFinancialStatementExportRows(rows){
  if(!Array.isArray(rows)||rows.length<1||rows.length>20000)return false;
  const first=rows[0];
  if(!exact(first,ROW_KEYS)||!UUID.test(first.financial_statement_snapshot_id||'')||!/^[1-9]\d*$/.test(String(first.version))||!CURRENCY.test(first.currency||'')||!SHA256.test(first.snapshot_hash||'')||!SHA256.test(first.ledger_evidence_hash||'')||!safeText(first.prepared_by,300)||!safeText(first.approved_by,300)||first.prepared_by===first.approved_by||!timestamp(first.approved_at)||!timestamp(first.captured_at)||!TYPES.has(first.statement_type)||!safeText(first.statement_section,128)||!safeText(first.classification_basis,200)||!safeText(first.account_code,64)||!safeText(first.account_name,300)||![first.opening_debit,first.opening_credit,first.period_debit,first.period_credit,first.ending_debit,first.ending_credit,first.display_balance].every(value=>MONEY.test(String(value)))||!safeIds(first.journal_entry_ids)||first.journal_entry_ids.length<1||!safeIds(first.journal_line_ids)||first.journal_line_ids.length<1||!safeIds(first.ledger_line_ids)||first.ledger_line_ids.length<1||!safeIds(first.source_document_ids)||!SHA256.test(first.row_hash||''))return false;
  const identity=[first.financial_statement_snapshot_id,String(first.version),first.currency,first.snapshot_hash,first.ledger_evidence_hash];
  const seen=new Set();
  for(const row of rows){
    if(!exact(row,ROW_KEYS)||[row.financial_statement_snapshot_id,String(row.version),row.currency,row.snapshot_hash,row.ledger_evidence_hash].some((value,index)=>value!==identity[index])||!TYPES.has(row.statement_type)||!safeText(row.statement_section,128)||!safeText(row.classification_basis,200)||!safeText(row.account_code,64)||!safeText(row.account_name,300)||![row.opening_debit,row.opening_credit,row.period_debit,row.period_credit,row.ending_debit,row.ending_credit,row.display_balance].every(value=>MONEY.test(String(value)))||!safeIds(row.journal_entry_ids)||!safeIds(row.journal_line_ids)||!safeIds(row.ledger_line_ids)||!safeIds(row.source_document_ids)||!SHA256.test(row.row_hash||'')||!timestamp(row.approved_at)||!timestamp(row.captured_at))return false;
    const key=`${row.statement_type}:${row.statement_section}:${row.account_code}`;if(seen.has(key))return false;seen.add(key);
  }
  return true;
}

const scalar=value=>value instanceof Date?value.toISOString():Array.isArray(value)?JSON.stringify(value):value===null||value===undefined?'':String(value);
const csvCell=value=>{const text=scalar(value);return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;};

export function buildFinancialStatementCsv({rows,entityId,periodId}={}){
  if(!UUID.test(entityId||'')||!UUID.test(periodId||'')||!validFinancialStatementExportRows(rows))return null;
  const lines=[ROW_FIELDS.join(',')];
  for(const row of rows)lines.push(ROW_FIELDS.map(field=>csvCell(row[field])).join(','));
  const content=`${lines.join('\r\n')}\r\n`;
  const contentHash=`sha256:${createHash('sha256').update(content,'utf8').digest('hex')}`;
  const snapshot=rows[0];
  return Object.freeze({schema_version:'FINANCIAL_STATEMENT_EXPORT_V1',format:'CSV',content_type:'text/csv; charset=utf-8',filename:`financial-statement-${entityId}-${periodId}-v${snapshot.version}.csv`,entity_id:entityId,period_id:periodId,financial_statement_snapshot_id:snapshot.financial_statement_snapshot_id,version:String(snapshot.version),snapshot_hash:snapshot.snapshot_hash,ledger_evidence_hash:snapshot.ledger_evidence_hash,row_count:rows.length,content_hash:contentHash,content});
}

export const FINANCIAL_STATEMENT_EXPORT_ROW_FIELDS=ROW_FIELDS;
