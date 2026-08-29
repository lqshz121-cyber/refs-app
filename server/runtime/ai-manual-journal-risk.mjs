import {safeAiEvidenceTree} from './ai-secret-safety.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POLICY_KEYS=['large_manual_journal_threshold','policy_version','round_amount_increment','schema_version','setting_snapshot_hash','setting_snapshot_id'];
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;
const validDate=value=>{if(typeof value!=='string'||!DATE.test(value))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;};
const validLine=line=>line&&typeof line==='object'&&!Array.isArray(line)&&safeAiEvidenceTree(line,{maxArrayLength:20})&&UUID.test(line.journal_entry_line_id||'')&&text(line.account_code,64)&&MONEY4.test(line.debit_amount||'')&&MONEY4.test(line.credit_amount||'')&&((line.debit_amount==='0.0000')!==(line.credit_amount==='0.0000'));
const validJournal=row=>row&&typeof row==='object'&&!Array.isArray(row)&&safeAiEvidenceTree(row,{maxArrayLength:500})&&UUID.test(row.journal_entry_id||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.journal_number,128)&&row.journal_type==='MANUAL'&&['DRAFT','PENDING_APPROVAL','APPROVED','POSTED'].includes(row.status)&&validDate(row.journal_date)&&/^[A-Z]{3}$/.test(row.currency||'')&&Number.isSafeInteger(row.attachment_count)&&row.attachment_count>=0&&row.attachment_count<=100&&Array.isArray(row.source_document_ids)&&row.source_document_ids.length<=100&&row.source_document_ids.every(id=>UUID.test(id||''))&&Array.isArray(row.source_payload_hashes)&&row.source_payload_hashes.length===row.source_document_ids.length&&row.source_payload_hashes.every(hash=>SHA256.test(hash||''))&&Array.isArray(row.lines)&&row.lines.length>=2&&row.lines.length<=500&&row.lines.every(validLine)&&new Set(row.lines.map(line=>line.journal_entry_line_id)).size===row.lines.length;
const validPolicy=policy=>exact(policy,POLICY_KEYS)&&safeAiEvidenceTree(policy,{maxArrayLength:20})&&policy.schema_version==='AI_MANUAL_JOURNAL_RISK_POLICY_V1'&&UUID.test(policy.setting_snapshot_id||'')&&SHA256.test(policy.setting_snapshot_hash||'')&&Number.isSafeInteger(policy.policy_version)&&policy.policy_version>=1&&MONEY4.test(policy.large_manual_journal_threshold||'')&&units(policy.large_manual_journal_threshold)>0n&&MONEY4.test(policy.round_amount_increment||'')&&units(policy.round_amount_increment)>0n;

export function detectManualJournalRisks(journals,{policy,entityId,currentAccountingPeriodId}={}){
  if(!Array.isArray(journals)||journals.length>500||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Manual Journal risk analysis requires one entity, one period, and at most 500 journals.'),{code:'AI_MANUAL_JOURNAL_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Manual Journal risk analysis requires approved policy evidence.'),{code:'AI_MANUAL_JOURNAL_POLICY_REQUIRED'});
  if(journals.some(row=>!validJournal(row)))throw Object.assign(new Error('Manual Journal risk analysis accepts only complete authoritative journal evidence.'),{code:'AI_MANUAL_JOURNAL_SOURCE_INVALID'});
  const findings=[];const seenJournalIds=new Set();
  for(const journal of journals){
    if(journal.entity_id!==entityId||journal.accounting_period_id!==currentAccountingPeriodId)throw Object.assign(new Error('Manual Journal evidence is outside the authorized entity and period.'),{code:'AI_MANUAL_JOURNAL_SCOPE_MISMATCH'});
    if(seenJournalIds.has(journal.journal_entry_id))throw Object.assign(new Error('Manual Journal evidence contains a duplicate journal.'),{code:'AI_MANUAL_JOURNAL_SOURCE_DUPLICATE'});seenJournalIds.add(journal.journal_entry_id);
    const debit=journal.lines.reduce((sum,line)=>sum+units(line.debit_amount),0n),credit=journal.lines.reduce((sum,line)=>sum+units(line.credit_amount),0n);
    if(debit!==credit)throw Object.assign(new Error('Manual Journal risk analysis rejects an unbalanced source journal.'),{code:'AI_MANUAL_JOURNAL_UNBALANCED'});
    if(debit<units(policy.large_manual_journal_threshold))continue;
    const noSupport=journal.attachment_count===0;
    const increment=units(policy.round_amount_increment),allRound=journal.lines.every(line=>{const amount=units(line.debit_amount==='0.0000'?line.credit_amount:line.debit_amount);return amount%increment===0n;});
    if(!noSupport&&!allRound)continue;
    const ruleIds=[];if(noSupport)ruleIds.push('MANUAL_JE_LARGE_NO_ATTACHMENT');if(allRound)ruleIds.push('MANUAL_JE_ROUND_AMOUNT_PATTERN');
    findings.push(Object.freeze({schema_version:'AI_MANUAL_JOURNAL_RISK_FINDING_V1',finding_type:'MANUAL_JOURNAL_RISK',risk_level:noSupport?'HIGH':'MEDIUM',rule_ids:Object.freeze(ruleIds),journal_entry_id:journal.journal_entry_id,journal_number:journal.journal_number,entity_id:journal.entity_id,accounting_period_id:journal.accounting_period_id,journal_date:journal.journal_date,currency:journal.currency,total_debits:money(debit),total_credits:money(credit),attachment_count:journal.attachment_count,source_document_ids:Object.freeze([...journal.source_document_ids]),source_payload_hashes:Object.freeze([...journal.source_payload_hashes]),line_ids:Object.freeze(journal.lines.map(line=>line.journal_entry_line_id)),reason:noSupport?'A large manual Journal Entry has no verified-clean retained attachment; source-document lineage alone is not supporting attachment evidence.':'A large manual Journal Entry is composed entirely of amounts aligned to the approved round-amount increment.',suggested_action:'Require an independent Controller to inspect the complete journal, supporting source documents, account mapping, member trace, business purpose, and approval history before any further workflow action.',confidence:noSupport?0.99:0.86,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_APPROVAL_OR_PERIOD_CLOSE',required_human_fields:Object.freeze(['business_purpose','source_support','account_mapping','member_trace','preparer_approver_separation','resolution_reason']),policy_evidence:Object.freeze({...policy}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_MANUAL_JOURNAL_RISK_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_journal_count:journals.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
