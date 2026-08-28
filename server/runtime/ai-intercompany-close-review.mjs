const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^-?(?:0|[1-9]\d*)\.\d{4}$/;
const PERIOD=/^\d{4}-(?:0[1-9]|1[0-2])$/;
const DATE=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const STATUSES=new Set(['MAPPED_INTERCOMPANY_PAIR','BLOCKED_MAPPING_AMBIGUOUS','BLOCKED_MAPPING_RULE_INVALID','BLOCKED_COUNTERPARTY_MAPPING_REQUIRED','BLOCKED_COUNTERPARTY_MAPPING_AMBIGUOUS','BLOCKED_COUNTERPARTY_MAPPING_MISMATCH','BLOCKED_CURRENT_POSTED_EVIDENCE_REQUIRED','BLOCKED_COUNTERPARTY_POSTED_EVIDENCE_REQUIRED']);
const ROW_KEYS='account_code|account_name|classification_basis|counterparty_account_code|counterparty_account_name|counterparty_closing_balance|counterparty_journal_entry_ids|counterparty_journal_line_ids|counterparty_ledger_line_ids|counterparty_mapping_snapshot_hash|counterparty_mapping_snapshot_id|counterparty_mapping_version|counterparty_period_id|counterparty_source_document_ids|current_closing_balance|difference_amount|in_balance|journal_entry_ids|journal_line_ids|ledger_line_ids|mapping_snapshot_hash|mapping_snapshot_id|mapping_status|mapping_version|period_code|period_end|period_id|period_start|source_document_ids';
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const calendarDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const idArray=(value,{allowEmpty=false}={})=>Array.isArray(value)&&(allowEmpty||value.length>0)&&value.length<=500&&value.every(item=>UUID.test(item||''))&&new Set(value).size===value.length;
const snapshot=(id,version,hash)=>UUID.test(id||'')&&/^[1-9]\d*$/.test(String(version??''))&&SHA.test(hash||'');
const nullSnapshot=(id,version,hash)=>id===null&&version===null&&hash===null;

const validRow=row=>{
  if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join('|')!==ROW_KEYS)return false;
  if(!UUID.test(row.period_id||'')||!UUID.test(row.counterparty_period_id||'')||row.period_id===row.counterparty_period_id||!PERIOD.test(row.period_code||'')||!calendarDate(row.period_start)||!calendarDate(row.period_end)||row.period_start>row.period_end||row.period_start.slice(0,7)!==row.period_code||row.period_end.slice(0,7)!==row.period_code)return false;
  if(!text(row.account_code,64)||!text(row.account_name,200)||!text(row.counterparty_account_code,64)||!text(row.counterparty_account_name,200)||!text(row.classification_basis,200)||!STATUSES.has(row.mapping_status))return false;
  const mapped=row.mapping_status==='MAPPED_INTERCOMPANY_PAIR';
  const currentSnapshot=snapshot(row.mapping_snapshot_id,row.mapping_version,row.mapping_snapshot_hash);
  const counterpartySnapshot=snapshot(row.counterparty_mapping_snapshot_id,row.counterparty_mapping_version,row.counterparty_mapping_snapshot_hash);
  const arrays=['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','counterparty_journal_entry_ids','counterparty_journal_line_ids','counterparty_ledger_line_ids','counterparty_source_document_ids'];
  if(mapped)return currentSnapshot&&counterpartySnapshot&&[row.current_closing_balance,row.counterparty_closing_balance,row.difference_amount].every(value=>MONEY.test(value||''))&&typeof row.in_balance==='boolean'&&arrays.every(field=>idArray(row[field]));
  return (currentSnapshot||nullSnapshot(row.mapping_snapshot_id,row.mapping_version,row.mapping_snapshot_hash))&&(counterpartySnapshot||nullSnapshot(row.counterparty_mapping_snapshot_id,row.counterparty_mapping_version,row.counterparty_mapping_snapshot_hash))&&row.current_closing_balance===null&&row.counterparty_closing_balance===null&&row.difference_amount===null&&row.in_balance===false&&arrays.every(field=>idArray(row[field],{allowEmpty:true}));
};

const blockedReason={
  BLOCKED_MAPPING_AMBIGUOUS:'The current entity does not have exactly one approved intercompany account mapping.',
  BLOCKED_MAPPING_RULE_INVALID:'The current entity intercompany mapping is incomplete or invalid.',
  BLOCKED_COUNTERPARTY_MAPPING_REQUIRED:'The counterparty entity has no reciprocal approved mapping.',
  BLOCKED_COUNTERPARTY_MAPPING_AMBIGUOUS:'The counterparty entity has multiple equally eligible mappings.',
  BLOCKED_COUNTERPARTY_MAPPING_MISMATCH:'The two entity mappings are not exact reciprocals.',
  BLOCKED_CURRENT_POSTED_EVIDENCE_REQUIRED:'The current entity has no posted ledger evidence for the mapped account.',
  BLOCKED_COUNTERPARTY_POSTED_EVIDENCE_REQUIRED:'The counterparty entity has no posted ledger evidence for the reciprocal account.'
};

export function detectIntercompanyCloseReviews(rows,{entityId,counterpartyEntityId,limit=100}={}){
  if(!Array.isArray(rows)||rows.length>5000||!UUID.test(entityId||'')||!UUID.test(counterpartyEntityId||'')||entityId===counterpartyEntityId||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Intercompany close review requires two distinct entities and bounded authoritative evidence.'),{code:'AI_INTERCOMPANY_SCOPE_INVALID'});
  if(rows.some(row=>!validRow(row))||new Set(rows.map(row=>`${row.period_id}|${row.counterparty_period_id}|${row.account_code}`)).size!==rows.length)throw Object.assign(new Error('Intercompany close review accepts only complete, unique authoritative reconciliation rows.'),{code:'AI_INTERCOMPANY_EVIDENCE_INVALID'});
  const findings=[];
  for(const row of rows){
    if(row.mapping_status==='MAPPED_INTERCOMPANY_PAIR'&&row.in_balance)continue;
    const blocked=row.mapping_status!=='MAPPED_INTERCOMPANY_PAIR';
    findings.push(Object.freeze({schema_version:'AI_INTERCOMPANY_CLOSE_REVIEW_V1',finding_type:blocked?'INTERCOMPANY_EVIDENCE_BLOCKED':'INTERCOMPANY_BALANCE_MISMATCH',risk_level:'HIGH',rule_id:blocked?'AI_INTERCOMPANY_EVIDENCE_COMPLETENESS_V1':'AI_INTERCOMPANY_BALANCE_TIE_OUT_V1',entity_id:entityId,counterparty_entity_id:counterpartyEntityId,period_id:row.period_id,counterparty_period_id:row.counterparty_period_id,period_code:row.period_code,account_code:row.account_code,account_name:row.account_name,counterparty_account_code:row.counterparty_account_code,counterparty_account_name:row.counterparty_account_name,mapping_status:row.mapping_status,current_closing_balance:row.current_closing_balance,counterparty_closing_balance:row.counterparty_closing_balance,difference_amount:row.difference_amount,mapping_snapshot_id:row.mapping_snapshot_id,mapping_snapshot_hash:row.mapping_snapshot_hash,counterparty_mapping_snapshot_id:row.counterparty_mapping_snapshot_id,counterparty_mapping_snapshot_hash:row.counterparty_mapping_snapshot_hash,journal_entry_ids:Object.freeze([...row.journal_entry_ids]),ledger_line_ids:Object.freeze([...row.ledger_line_ids]),source_document_ids:Object.freeze([...row.source_document_ids]),counterparty_journal_entry_ids:Object.freeze([...row.counterparty_journal_entry_ids]),counterparty_ledger_line_ids:Object.freeze([...row.counterparty_ledger_line_ids]),counterparty_source_document_ids:Object.freeze([...row.counterparty_source_document_ids]),reason:blocked?blockedReason[row.mapping_status]:`The reciprocal posted balances ${row.current_closing_balance} and ${row.counterparty_closing_balance} do not eliminate; the exact difference is ${row.difference_amount}.`,suggested_action:blocked?'Complete and approve the reciprocal mapping or posted-source evidence before close; do not infer the missing side.':'Trace both entities to their posted Journal, ledger, and source documents; resolve timing, entity, account, currency, duplication, or cutoff differences through human review.',confidence:1,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',required_human_fields:Object.freeze(['reciprocal_mapping_review','source_completeness','cutoff_assessment','difference_explanation','elimination_or_adjustment_decision']),action_flags:ACTIONS}));
  }
  if(findings.length>limit)throw Object.assign(new Error('Intercompany close-review finding population exceeds the requested complete response bound.'),{code:'AI_INTERCOMPANY_FINDING_POPULATION_INCOMPLETE'});
  return Object.freeze({schema_version:'AI_INTERCOMPANY_CLOSE_REVIEW_BATCH_V1',entity_id:entityId,counterparty_entity_id:counterpartyEntityId,scanned_pair_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
