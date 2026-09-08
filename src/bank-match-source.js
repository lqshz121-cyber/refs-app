const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fields=['match_source_kind','payment_occurrence_id','sales_receipt_id','sales_receipt_number','sales_receipt_revision','ledger_line_id'];

export function parseBankMatchSource(row){
  if(!row||typeof row!=='object')return null;
  // Older deployed readers have none of these fields. A partial new envelope
  // must not be mistaken for that older contract.
  if(!fields.some(field=>Object.hasOwn(row,field)))return row.candidate_rule_code==='EXACT_POSTED_SALES_RECEIPT'?null:{};
  if(!fields.every(field=>Object.hasOwn(row,field)))return null;
  const source=Object.fromEntries(fields.map(field=>[field,row[field]]));
  if(row.bank_match_id==null)return fields.every(field=>row[field]===null)?source:null;
  if(!UUID.test(row.bank_match_id||''))return null;
  const kind=row.match_source_kind;
  if(kind==='IMPORTED_SOURCE'){
    if(!UUID.test(row.business_source_document_id||'')||row.payment_occurrence_id!==null||row.sales_receipt_id!==null||row.sales_receipt_number!==null||row.sales_receipt_revision!==null||row.ledger_line_id!==null&&!UUID.test(row.ledger_line_id||'')||row.candidate_rule_code==='EXACT_POSTED_SALES_RECEIPT')return null;
    return source;
  }
  if(!['PAYMENT','SALES_RECEIPT'].includes(kind)||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.journal_line_id||'')||!UUID.test(row.ledger_line_id||''))return null;
  if(Object.hasOwn(row,'candidate_rule_code')&&row.candidate_rule_code!==(kind==='PAYMENT'?'EXACT_POSTED_PAYMENT':'EXACT_POSTED_SALES_RECEIPT'))return null;
  if(kind==='PAYMENT')return UUID.test(row.payment_occurrence_id||'')&&row.sales_receipt_id===null&&row.sales_receipt_number===null&&row.sales_receipt_revision===null?source:null;
  const revision=row.sales_receipt_revision,number=row.sales_receipt_number;
  if(row.payment_occurrence_id!==null||row.business_source_document_id!==null||!UUID.test(row.sales_receipt_id||'')||typeof number!=='string'||number.length<1||number.length>128||/[\x00-\x1f\x7f]/.test(number)||typeof revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(revision)||revision.length>19||BigInt(revision)>9223372036854775807n)return null;
  return source;
}
