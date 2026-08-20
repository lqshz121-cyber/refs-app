const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const freeze=value=>Object.freeze(value);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const units=value=>{const [whole,fraction]=value.split('.');return BigInt(whole)*10000n+BigInt(fraction);};
const sum=(rows,side)=>rows.filter(row=>row.side===side).reduce((total,row)=>total+units(row.amount),0n);

const POSTED_KEYS=['accounting_period_id','approved_by','entity_id','journal_entry_id','journal_number','ledger_line_ids','lines','posted_by','prepared_by','reviewed_by','source_document_ids','status'];
const LINE_KEYS=['account_code','amount','currency','journal_line_id','ledger_line_id','project_ref','property_ref','side','source_document_id','source_document_line_id','source_line_hash'];
const REPORT_KEYS=['accounting_period_id','entity_id','journal_entry_ids','ledger_line_ids','report_effects','report_snapshot_hash','report_snapshot_id','source_document_ids','status'];

const validPosted=(journal,packet)=>exact(journal,POSTED_KEYS)&&journal.status==='POSTED'&&UUID.test(journal.journal_entry_id||'')&&typeof journal.journal_number==='string'&&journal.journal_number.length>0&&journal.entity_id===packet.entity_id&&journal.accounting_period_id===packet.accounting_period_id&&
  [journal.prepared_by,journal.reviewed_by,journal.approved_by,journal.posted_by].every(value=>typeof value==='string'&&value.length>0)&&new Set([journal.prepared_by,journal.reviewed_by,journal.approved_by,journal.posted_by]).size===4&&
  Array.isArray(journal.lines)&&journal.lines.length>=2&&journal.lines.length<=500&&journal.lines.every(line=>exact(line,LINE_KEYS)&&UUID.test(line.journal_line_id||'')&&UUID.test(line.ledger_line_id||'')&&['DEBIT','CREDIT'].includes(line.side)&&MONEY.test(line.amount||'')&&/^[A-Z]{3}$/.test(line.currency||'')&&UUID.test(line.source_document_id||'')&&UUID.test(line.source_document_line_id||'')&&SHA.test(line.source_line_hash||'')&&(line.project_ref===null||typeof line.project_ref==='string')&&(line.property_ref===null||typeof line.property_ref==='string'))&&
  sum(journal.lines,'DEBIT')===sum(journal.lines,'CREDIT')&&Array.isArray(journal.ledger_line_ids)&&journal.ledger_line_ids.length===journal.lines.length&&Array.isArray(journal.source_document_ids);

const validReport=(report,packet,journal)=>exact(report,REPORT_KEYS)&&report.status==='POSTED_LEDGER_ONLY'&&UUID.test(report.report_snapshot_id||'')&&SHA.test(report.report_snapshot_hash||'')&&report.entity_id===packet.entity_id&&report.accounting_period_id===packet.accounting_period_id&&Array.isArray(report.journal_entry_ids)&&report.journal_entry_ids.includes(journal.journal_entry_id)&&Array.isArray(report.ledger_line_ids)&&journal.ledger_line_ids.every(id=>report.ledger_line_ids.includes(id))&&Array.isArray(report.source_document_ids)&&report.source_document_ids.includes(packet.source_trace.source_document_id)&&exact(report.report_effects,['balance_sheet','cash_flow','income_statement'])&&['balance_sheet','cash_flow','income_statement'].every(key=>Array.isArray(report.report_effects[key]));

export function reviewAiAccountingPostedOutcome({packet,postedJournal,reportSnapshot}){
  if(packet?.schema_version!=='AI_ACCOUNTING_DECISION_PACKET_V1'||packet.status!=='READY_FOR_HUMAN_REVIEW'||packet.proposed_journal?.status!=='SUGGESTED_ONLY'||packet.proposed_journal?.balanced!==true||packet.action_flags?.can_post!==false)fail('AI_ACCOUNTING_OUTCOME_PACKET_INVALID','A closed suggested-only accounting decision packet is required.');
  if(!validPosted(postedJournal,packet))fail('AI_ACCOUNTING_OUTCOME_POSTED_JOURNAL_INVALID','Exact balanced Posted Journal, lineage, and four-person separation are required.');
  if(!validReport(reportSnapshot,packet,postedJournal))fail('AI_ACCOUNTING_OUTCOME_REPORT_INVALID','A Posted-ledger-only report snapshot with exact Journal, ledger, and source lineage is required.');
  const proposed=packet.proposed_journal.lines,actual=postedJournal.lines;
  const expectedKeys=proposed.map(line=>`${line.side}|${line.account_code}|${line.amount}|${line.currency}|${line.project_ref??''}|${line.property_ref??''}|${line.source_document_line_id}|${line.source_line_hash}`).sort();
  const actualKeys=actual.map(line=>`${line.side}|${line.account_code}|${line.amount}|${line.currency}|${line.project_ref??''}|${line.property_ref??''}|${line.source_document_line_id}|${line.source_line_hash}`).sort();
  const journalConsistent=expectedKeys.join('\n')===actualKeys.join('\n');
  const expectedReport=['balance_sheet','income_statement','cash_flow'].every(key=>packet.report_impact[key].every(role=>reportSnapshot.report_effects[key].includes(role)));
  const consistent=journalConsistent&&expectedReport;
  return freeze({schema_version:'AI_ACCOUNTING_POSTED_OUTCOME_REVIEW_V1',status:consistent?'CONSISTENT':'MISMATCH',risk_level:consistent?'LOW':'HIGH',entity_id:packet.entity_id,accounting_period_id:packet.accounting_period_id,source_document_id:packet.source_trace.source_document_id,source_document_line_id:packet.source_trace.source_document_line_id,source_payload_hash:packet.source_trace.source_payload_hash,source_line_hash:packet.source_trace.source_line_hash,settings_snapshot_id:packet.settings_trace.snapshot_id,settings_snapshot_hash:packet.settings_trace.snapshot_hash,journal_entry_id:postedJournal.journal_entry_id,journal_number:postedJournal.journal_number,report_snapshot_id:reportSnapshot.report_snapshot_id,report_snapshot_hash:reportSnapshot.report_snapshot_hash,journal_consistent:journalConsistent,report_consistent:expectedReport,reason:consistent?'The independently approved Posted Journal and Posted-ledger report snapshot preserve the exact AI decision, settings, and source lineage.':'The independently approved Posted Journal or Posted-ledger report snapshot differs from the retained AI decision packet.',required_human_fields:freeze(consistent?[]:['journal_variance_explanation','report_variance_explanation','controller_resolution']),action_flags:ACTIONS});
}
