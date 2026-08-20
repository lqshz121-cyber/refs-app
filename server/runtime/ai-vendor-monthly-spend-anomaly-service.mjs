import {detectVendorMonthlySpendAnomalies} from './ai-vendor-monthly-spend-anomaly.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POPULATION_KEYS=['action_flags','admission_proofs','approved_policy','current_accounting_period_id','history_period_count','population_complete','population_line_count','rows','schema_version','selected_period_ids','selected_periods'].sort();
const ROW_KEYS=['accounting_period_id','amount','cost_category_ref','currency','entity_id','exception_codes','invoice_date','project_ref','property_ref','retained_outcome','signature_verified','source_admission_status','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','vendor_name','vendor_ref'].sort();
const PERIOD_KEYS=['period_code','period_end','period_id','period_start'].sort();
const PROOF_KEYS=['admission_id','control_totals_hash','package_hash','package_raw_hash','request_hash','row_count','snapshot_id'].sort();
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const calendarDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const invalid=()=>Object.assign(new Error('Vendor monthly-spend population is incomplete or unsafe.'),{code:'AI_VENDOR_MONTHLY_SPEND_POPULATION_INVALID'});
const falseActions=value=>exactKeys(value,Object.keys(ACTIONS).sort())&&Object.entries(ACTIONS).every(([key,expected])=>value[key]===expected);

export function createAiVendorMonthlySpendAnomalyService({populationReader}={}){
  if(typeof populationReader!=='function')throw new TypeError('Vendor monthly-spend service requires one authoritative complete-population reader.');
  return Object.freeze({async analyze({tenantId,entityId,currentAccountingPeriodId}={}){
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Vendor monthly-spend service scope is invalid.'),{code:'AI_VENDOR_MONTHLY_SPEND_SCOPE_INVALID'});
    const population=await populationReader({tenantId,entityId,currentAccountingPeriodId});
    if(!exactKeys(population,POPULATION_KEYS)||population.schema_version!=='AI_VENDOR_MONTHLY_SPEND_SOURCE_POPULATION_V1'||population.current_accounting_period_id!==currentAccountingPeriodId||population.population_complete!==true||!falseActions(population.action_flags)||!Number.isSafeInteger(population.population_line_count)||population.population_line_count<0||population.population_line_count>2000||!Number.isSafeInteger(population.history_period_count)||population.history_period_count<3||population.history_period_count>24||!Array.isArray(population.selected_period_ids)||population.selected_period_ids.length!==population.history_period_count+1||new Set(population.selected_period_ids).size!==population.selected_period_ids.length||!population.selected_period_ids.includes(currentAccountingPeriodId)||population.selected_period_ids.some(value=>!UUID.test(value||''))||!Array.isArray(population.selected_periods)||population.selected_periods.length!==population.selected_period_ids.length||new Set(population.selected_periods.map(period=>period.period_id)).size!==population.selected_periods.length||population.selected_periods.some(period=>!exactKeys(period,PERIOD_KEYS)||!population.selected_period_ids.includes(period.period_id)||typeof period.period_code!=='string'||period.period_code.length<1||period.period_code.length>32||!calendarDate(period.period_start)||!calendarDate(period.period_end)||period.period_start>period.period_end)||!Array.isArray(population.admission_proofs)||population.admission_proofs.some(proof=>!exactKeys(proof,PROOF_KEYS)||!UUID.test(proof.admission_id||'')||!UUID.test(proof.snapshot_id||'')||![proof.request_hash,proof.package_hash,proof.package_raw_hash,proof.control_totals_hash].every(value=>SHA.test(value||''))||!Number.isSafeInteger(proof.row_count)||proof.row_count<1)||!Array.isArray(population.rows)||population.rows.length!==population.population_line_count||population.rows.some(row=>!exactKeys(row,ROW_KEYS)||row.entity_id!==entityId||!population.selected_period_ids.includes(row.accounting_period_id)||!['STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED'].includes(row.retained_outcome)||!Array.isArray(row.exception_codes)))throw invalid();
    const rows=[],validationRows=[];let excludedIncompleteLineCount=0;
    for(const row of population.rows){
      const {retained_outcome:_outcome,exception_codes:_exceptions,...analysisRow}=row;
      validationRows.push(row.invoice_date===null?{...analysisRow,invoice_date:'2000-01-01'}:analysisRow);
      if(row.invoice_date===null){excludedIncompleteLineCount++;continue;}
      rows.push(analysisRow);
    }
    detectVendorMonthlySpendAnomalies(validationRows,{policy:population.approved_policy,currentAccountingPeriodId});
    const result=detectVendorMonthlySpendAnomalies(rows,{policy:population.approved_policy,currentAccountingPeriodId});
    return Object.freeze({...result,excluded_incomplete_line_count:excludedIncompleteLineCount});
  }});
}
