const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(?:0|[1-9]\d*)\.\d{4}$/;
const ACCOUNT=/^[A-Za-z0-9._:-]{1,64}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const units=value=>BigInt(value.replace('.',''));
const money=value=>{const negative=value<0n,absolute=negative?-value:value,digits=absolute.toString().padStart(5,'0');return `${negative?'-':''}${digits.slice(0,-4)}.${digits.slice(-4)}`;};
const ids=value=>Array.isArray(value)&&value.length<=500&&value.every(id=>UUID.test(id||''))&&new Set(value).size===value.length;
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128;

function valid(row,periodId){
  return row&&row.source_classification==='SECURITY_DEPOSIT'&&row.mapping_status==='APPROVED_EXACT'&&
    UUID.test(row.period_id||'')&&row.period_id===periodId&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&
    HASH.test(row.source_payload_hash||'')&&HASH.test(row.source_line_hash||'')&&HASH.test(row.mapping_snapshot_hash||'')&&UUID.test(row.mapping_snapshot_id||'')&&
    [row.property_ref,row.unit_ref,row.lease_ref,row.tenant_ref].every(text)&&/^[A-Z]{3}$/.test(row.currency||'')&&
    [row.deposit_amount,row.posted_revenue_amount,row.posted_liability_amount].every(value=>MONEY.test(value||''))&&units(row.deposit_amount)>0n&&
    ACCOUNT.test(row.revenue_account_code||'')&&ACCOUNT.test(row.security_deposit_liability_account_code||'')&&row.revenue_account_code!==row.security_deposit_liability_account_code&&
    ids(row.journal_entry_ids)&&ids(row.journal_line_ids)&&ids(row.ledger_line_ids)&&row.lineage_status==='SOURCE_LINE_BOUND_POSTED';
}

export function detectSecurityDepositLiabilityReviews(rows,{entityId,accountingPeriodId,limit=500}={}){
  if(!Array.isArray(rows)||rows.length>5000||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500||rows.some(row=>!valid(row,accountingPeriodId)))throw Object.assign(new Error('Security-deposit review requires exact retained source, approved mapping, and source-line-bound Posted evidence.'),{code:'AI_SECURITY_DEPOSIT_EVIDENCE_INVALID'});
  const seen=new Set(),findings=[];
  for(const row of rows){
    const key=row.source_document_line_id;if(seen.has(key))throw Object.assign(new Error('Security-deposit source line is duplicated.'),{code:'AI_SECURITY_DEPOSIT_SOURCE_DUPLICATE'});seen.add(key);
    const expected=units(row.deposit_amount),revenue=units(row.posted_revenue_amount),liability=units(row.posted_liability_amount);
    if(revenue===0n&&liability===expected)continue;
    const liabilityVariance=expected-liability;
    findings.push(Object.freeze({
      schema_version:'AI_SECURITY_DEPOSIT_LIABILITY_REVIEW_V1',finding_type:'SECURITY_DEPOSIT_REVENUE_MISCLASSIFICATION',risk_level:'HIGH',rule_id:'AI_SECURITY_DEPOSIT_LIABILITY_V1',
      entity_id:entityId,accounting_period_id:accountingPeriodId,...row,
      liability_variance:money(liabilityVariance),
      reason:`Refundable tenant deposit ${row.deposit_amount} for lease ${row.lease_ref} has source-bound Posted revenue/liability of ${row.posted_revenue_amount}/${row.posted_liability_amount}.`,
      suggested_action:'Verify refundability and any legally supported forfeiture; if still refundable, prepare a separately reviewed reclassification from revenue to the mapped security-deposit liability.',
      suggested_journal_entry:revenue>0n?Object.freeze({status:'SUGGESTED_ONLY',debit_account_code:row.revenue_account_code,credit_account_code:row.security_deposit_liability_account_code,amount:row.posted_revenue_amount,memo:`Reclass refundable security deposit for lease ${row.lease_ref}`,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,debits_equal_credits:true}):null,
      required_human_fields:Object.freeze(['refundability_review','lease_terms_review','forfeiture_evidence_if_any','posted_line_review','controller_approval']),action_flags:ACTIONS
    }));
    if(findings.length===limit)break;
  }
  return Object.freeze({schema_version:'AI_SECURITY_DEPOSIT_LIABILITY_REVIEW_BATCH_V1',scanned_deposit_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
