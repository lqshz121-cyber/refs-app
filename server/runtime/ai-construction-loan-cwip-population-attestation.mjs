import {createHash} from 'node:crypto';
import {detectConstructionLoanDrawCwipReviews} from './ai-construction-loan-draw-cwip-review.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^-?(?:0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURRENCY=/^[A-Z]{3}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const TOP=['accounting_period_id','applicable','counts','currency','cwip_rows','entity_id','loan_rows','non_target_rows','period_code','period_end','period_start','population_hash','population_watermark','schema_version','status','tenant_id','unclassified_rows'];
const COUNTS=['ambiguous_count','current_activity_line_count','cwip_row_count','eligible_count','invalid_lineage_count','loan_row_count','mapped_count','missing_count','non_target_count','population_count','unclassified_count','zero_activity_count'];
const COMMON=['account_code','account_name','activity_status','classification','classification_basis','closing_balance','currency','current_activity_line_count','journal_entry_ids','journal_line_ids','ledger_line_ids','lineage_complete','mapping_snapshot_hash','mapping_snapshot_id','mapping_status','mapping_version','opening_balance','opposite_classification','opposite_mapping_snapshot_hash','opposite_mapping_snapshot_id','opposite_mapping_version','period_code','period_end','period_id','period_start','posting_batch_ids','source_document_ids'];
const LOAN=[...COMMON,'period_draws','period_repayments'].sort();
const CWIP=[...COMMON,'period_credit','period_debit'].sort();
const UNCLASSIFIED=['account_code','account_name','activity_status','currency','current_activity_line_count','journal_entry_ids','journal_line_ids','ledger_line_ids','lineage_complete','mapping_status','period_code','period_end','period_id','period_start','posting_batch_ids','source_document_ids'];
const NON_TARGET=['account_code','account_name','activity_status','currency','current_activity_line_count','cwip_classification','cwip_mapping_snapshot_hash','cwip_mapping_snapshot_id','cwip_mapping_version','journal_entry_ids','journal_line_ids','ledger_line_ids','lineage_complete','loan_classification','loan_mapping_snapshot_hash','loan_mapping_snapshot_id','loan_mapping_version','mapping_status','period_code','period_end','period_id','period_start','posting_batch_ids','source_document_ids'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===keys.slice().sort().join('|');
const ids=value=>Array.isArray(value)&&value.length<=500&&value.every(item=>UUID.test(item||''))&&new Set(value).size===value.length;
const pgKeyOrder=(left,right)=>Buffer.byteLength(left)-Buffer.byteLength(right)||Buffer.compare(Buffer.from(left),Buffer.from(right));
const pgJson=value=>{if(value===null)return 'null';if(typeof value==='string')return JSON.stringify(value);if(typeof value==='boolean'||typeof value==='number')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(pgJson).join(', ')}]`;return `{${Object.keys(value).sort(pgKeyOrder).map(key=>`${JSON.stringify(key)}: ${pgJson(value[key])}`).join(', ')}}`;};
export const constructionLoanCwipPopulationHash=value=>`sha256:${createHash('sha256').update(pgJson(value),'utf8').digest('hex')}`;
const fail=(message,code='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID')=>{throw Object.assign(new Error(message),{code});};
const strictDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const activityEvidence=value=>{
  if(!Number.isSafeInteger(value.current_activity_line_count)||value.current_activity_line_count<0||value.activity_status!==(value.current_activity_line_count===0?'ZERO_CURRENT_PERIOD_ACTIVITY':'CURRENT_PERIOD_ACTIVITY'))return false;
  const sizes=[value.journal_entry_ids.length,value.journal_line_ids.length,value.ledger_line_ids.length,value.posting_batch_ids.length,value.source_document_ids.length];
  return value.current_activity_line_count>0?sizes.every(Boolean):(sizes.every(size=>size===0)||sizes.every(Boolean));
};

function row(value,kind,scope){
  const keys=kind==='LOAN'?LOAN:CWIP;
  if(!exact(value,keys)||value.period_id!==scope.periodId||value.period_code!==scope.periodCode||value.period_start!==scope.periodStart||value.period_end!==scope.periodEnd||value.currency!==scope.currency||typeof value.account_code!=='string'||!value.account_code.trim()||typeof value.account_name!=='string'||typeof value.lineage_complete!=='boolean'||!ids(value.journal_entry_ids)||!ids(value.journal_line_ids)||!ids(value.ledger_line_ids)||!ids(value.posting_batch_ids)||!ids(value.source_document_ids)||!activityEvidence(value))fail(`Construction-loan/CWIP ${kind.toLowerCase()} attestation row is invalid.`);
  const mapped=kind==='LOAN'?value.mapping_status==='MAPPED_CONSTRUCTION_LOAN_ACCOUNT':value.mapping_status==='MAPPED_CWIP_ACCOUNT';
  if(mapped){
    const basis=kind==='LOAN'?'APPROVED_CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_EXACT':'APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT';
    const money=kind==='LOAN'?['opening_balance','period_draws','period_repayments','closing_balance']:['opening_balance','period_debit','period_credit','closing_balance'];
    const classification=kind==='LOAN'?'CONSTRUCTION_LOAN':'CWIP',opposite=kind==='LOAN'?'NOT_CWIP':'NOT_CONSTRUCTION_LOAN';
    if(value.classification!==classification||value.opposite_classification!==opposite||value.classification_basis!==basis||!UUID.test(value.mapping_snapshot_id||'')||typeof value.mapping_version!=='string'||!SHA.test(value.mapping_snapshot_hash||'')||!UUID.test(value.opposite_mapping_snapshot_id||'')||typeof value.opposite_mapping_version!=='string'||!SHA.test(value.opposite_mapping_snapshot_hash||'')||money.some(key=>!MONEY.test(value[key]||'')))fail(`Mapped ${kind.toLowerCase()} attestation row is not authoritative.`);
    const [opening,increase,decrease,closing]=money.map(key=>BigInt(value[key].replace('.','')));
    if(increase<0n||decrease<0n||opening+increase-decrease!==closing)fail(`Mapped ${kind.toLowerCase()} attestation rollforward is invalid.`);
    if(value.current_activity_line_count===0&&(increase!==0n||decrease!==0n||(value.ledger_line_ids.length===0&&opening!==0n)))fail(`Mapped ${kind.toLowerCase()} zero-activity attestation contains unsupported balances.`);
  }
  return mapped;
}

function nonTargetRow(value,scope){
  if(!exact(value,NON_TARGET)||value.period_id!==scope.periodId||value.period_code!==scope.periodCode||value.period_start!==scope.periodStart||value.period_end!==scope.periodEnd||value.currency!==scope.currency||value.mapping_status!=='EXPLICIT_NON_LOAN_CWIP_TARGET'||value.loan_classification!=='NOT_CONSTRUCTION_LOAN'||value.cwip_classification!=='NOT_CWIP'||typeof value.account_code!=='string'||!value.account_code.trim()||typeof value.account_name!=='string'||typeof value.lineage_complete!=='boolean'||!UUID.test(value.loan_mapping_snapshot_id||'')||typeof value.loan_mapping_version!=='string'||!SHA.test(value.loan_mapping_snapshot_hash||'')||!UUID.test(value.cwip_mapping_snapshot_id||'')||typeof value.cwip_mapping_version!=='string'||!SHA.test(value.cwip_mapping_snapshot_hash||'')||!ids(value.journal_entry_ids)||!ids(value.journal_line_ids)||!ids(value.ledger_line_ids)||!ids(value.posting_batch_ids)||!ids(value.source_document_ids)||!activityEvidence(value))fail('Explicit non-target construction-loan/CWIP population row is invalid.');
}

function unclassifiedRow(value,scope){
  if(!exact(value,UNCLASSIFIED)||value.period_id!==scope.periodId||value.period_code!==scope.periodCode||value.period_start!==scope.periodStart||value.period_end!==scope.periodEnd||value.currency!==scope.currency||!['BLOCKED_MAPPING_REQUIRED','BLOCKED_MAPPING_AMBIGUOUS'].includes(value.mapping_status)||typeof value.account_code!=='string'||!value.account_code.trim()||typeof value.account_name!=='string'||typeof value.lineage_complete!=='boolean'||!ids(value.journal_entry_ids)||!ids(value.journal_line_ids)||!ids(value.ledger_line_ids)||!ids(value.posting_batch_ids)||!ids(value.source_document_ids)||!activityEvidence(value))fail('Unclassified construction-loan/CWIP population row is invalid.');
}

export function validateConstructionLoanCwipPopulationAttestation(value,{tenantId,entityId,accountingPeriodId}={}){
  if(!exact(value,TOP)||value.schema_version!=='AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1'||value.tenant_id!==tenantId||value.entity_id!==entityId||value.accounting_period_id!==accountingPeriodId||!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!['COMPLETE','INCOMPLETE'].includes(value.status)||typeof value.applicable!=='boolean'||!strictDate(value.period_start)||!strictDate(value.period_end)||value.period_start>value.period_end||value.period_code!==value.period_start.slice(0,7)||!CURRENCY.test(value.currency||'')||!exact(value.counts,COUNTS)||!Array.isArray(value.loan_rows)||!Array.isArray(value.cwip_rows)||!Array.isArray(value.non_target_rows)||!Array.isArray(value.unclassified_rows)||!SHA.test(value.population_hash||'')||!(value.population_watermark===null||TIME.test(value.population_watermark||'')))fail('Construction-loan/CWIP population attestation scope or shape is invalid.');
  for(const key of COUNTS)if(!Number.isSafeInteger(value.counts[key])||value.counts[key]<0)fail('Construction-loan/CWIP population attestation counts are invalid.');
  const scope={periodId:accountingPeriodId,periodCode:value.period_code,periodStart:value.period_start,periodEnd:value.period_end,currency:value.currency};
  const loanMapped=value.loan_rows.map(item=>row(item,'LOAN',scope));
  const cwipMapped=value.cwip_rows.map(item=>row(item,'CWIP',scope));
  value.non_target_rows.forEach(item=>nonTargetRow(item,scope));
  value.unclassified_rows.forEach(item=>unclassifiedRow(item,scope));
  const accountOrder=rows=>rows.every((item,index)=>index===0||rows[index-1].account_code<item.account_code);
  if(!accountOrder(value.loan_rows)||!accountOrder(value.cwip_rows)||!accountOrder(value.non_target_rows)||!accountOrder(value.unclassified_rows))fail('Construction-loan/CWIP population attestation rows are duplicated or unordered.');
  const mappedRows=[...value.loan_rows,...value.cwip_rows],eligibleRows=[...mappedRows,...value.unclassified_rows],all=[...eligibleRows,...value.non_target_rows],eligible=eligibleRows.length,mapped=loanMapped.filter(Boolean).length+cwipMapped.filter(Boolean).length;
  if(new Set(all.map(item=>item.account_code)).size!==all.length)fail('Construction-loan/CWIP population account universe is duplicated.');
  const ambiguous=value.unclassified_rows.filter(item=>item.mapping_status==='BLOCKED_MAPPING_AMBIGUOUS').length;
  const invalidLineage=all.filter(item=>!item.lineage_complete).length,currentActivity=eligibleRows.reduce((sum,item)=>sum+item.current_activity_line_count,0),zeroActivity=eligibleRows.filter(item=>item.current_activity_line_count===0).length;
  const applicable=eligible>0;
  let missing=value.unclassified_rows.filter(item=>item.mapping_status==='BLOCKED_MAPPING_REQUIRED').length;
  if(applicable&&!loanMapped.some(Boolean))missing+=1;
  if(applicable&&!cwipMapped.some(Boolean))missing+=1;
  const expected={eligible_count:eligible,mapped_count:mapped,missing_count:missing,ambiguous_count:ambiguous,invalid_lineage_count:invalidLineage,current_activity_line_count:currentActivity,zero_activity_count:zeroActivity,loan_row_count:value.loan_rows.length,cwip_row_count:value.cwip_rows.length,non_target_count:value.non_target_rows.length,unclassified_count:value.unclassified_rows.length,population_count:all.length};
  if(COUNTS.some(key=>value.counts[key]!==expected[key])||value.applicable!==applicable)fail('Construction-loan/CWIP population attestation counts drifted.');
  const complete=(!applicable&&eligible===0&&invalidLineage===0)||(applicable&&missing===0&&ambiguous===0&&invalidLineage===0&&value.loan_rows.length>=1&&value.loan_rows.length<=500&&value.cwip_rows.length>=1&&value.cwip_rows.length<=500);
  if(value.status!==(complete?'COMPLETE':'INCOMPLETE'))fail('Construction-loan/CWIP population completeness drifted.');
  if((currentActivity>0&&value.population_watermark===null)||(currentActivity===0&&value.population_watermark!==null)||(!value.applicable&&value.population_watermark!==null))fail('Construction-loan/CWIP population watermark is invalid.');
  const {population_hash:populationHash,...core}=value;
  if(constructionLoanCwipPopulationHash(core)!==populationHash)fail('Construction-loan/CWIP population hash drifted.');
  return Object.freeze({...value,loan_rows:Object.freeze(value.loan_rows.map(Object.freeze)),cwip_rows:Object.freeze(value.cwip_rows.map(Object.freeze)),non_target_rows:Object.freeze(value.non_target_rows.map(Object.freeze)),unclassified_rows:Object.freeze(value.unclassified_rows.map(Object.freeze)),counts:Object.freeze({...value.counts})});
}

export function analyzeAttestedConstructionLoanDrawCwip(attestation,{tenantId,entityId,accountingPeriodId,policy}={}){
  const value=validateConstructionLoanCwipPopulationAttestation(attestation,{tenantId,entityId,accountingPeriodId});
  if(value.status!=='COMPLETE')fail('Construction-loan draw to CWIP population is incomplete.','AI_LOAN_DRAW_CWIP_POPULATION_INCOMPLETE');
  if(!value.applicable)return Object.freeze({schema_version:'AI_CONSTRUCTION_LOAN_DRAW_CWIP_REVIEW_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_loan_account_count:0,scanned_cwip_account_count:0,finding_count:0,findings:Object.freeze([]),action_flags:ACTIONS});
  return detectConstructionLoanDrawCwipReviews(value.loan_rows,value.cwip_rows,{entityId,accountingPeriodId,policy});
}
