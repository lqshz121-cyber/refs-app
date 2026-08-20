const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const TREATMENTS=Object.freeze({
  EXPENSE:Object.freeze({debit:'expense_account_code',credit:'accounts_payable_account_code',report:Object.freeze({balance_sheet:['ACCOUNTS_PAYABLE'],income_statement:['OPERATING_EXPENSE'],cash_flow:[]})}),
  PREPAID_AMORTIZATION:Object.freeze({debit:'prepaid_asset_account_code',credit:'accounts_payable_account_code',report:Object.freeze({balance_sheet:['PREPAID_ASSET','ACCOUNTS_PAYABLE'],income_statement:[],cash_flow:[]})}),
  ACCRUAL_REVIEW:Object.freeze({debit:'expense_account_code',credit:'accrued_liability_account_code',report:Object.freeze({balance_sheet:['ACCRUED_LIABILITY'],income_statement:['OPERATING_EXPENSE'],cash_flow:[]})}),
  CAPITALIZATION_REVIEW:Object.freeze({debit:'cwip_account_code',credit:'accounts_payable_account_code',report:Object.freeze({balance_sheet:['CWIP','ACCOUNTS_PAYABLE'],income_statement:[],cash_flow:[]})})
});

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const freeze=value=>Object.freeze(value);
const error=(code,message)=>Object.assign(new Error(message),{code});

const SETTINGS_KEYS=['account_mappings','accounting_period_id','currency','entity_id','schema_version','snapshot_hash','snapshot_id','status','version'];
const ACCOUNT_KEYS=['accounts_payable_account_code','accrued_liability_account_code','cwip_account_code','expense_account_code','prepaid_asset_account_code'];
const SOURCE_KEYS=['accounting_period_id','amount','currency','entity_id','project_ref','property_ref','source_document_id','source_document_line_id','source_line_hash','source_payload_hash','vendor_ref'];

function validSettings(settings,{entityId,accountingPeriodId}){
  return exact(settings,SETTINGS_KEYS)&&settings.schema_version==='AI_ACCOUNTING_SETTINGS_SNAPSHOT_V1'&&settings.status==='APPROVED'&&
    UUID.test(settings.snapshot_id||'')&&Number.isSafeInteger(settings.version)&&settings.version>0&&SHA.test(settings.snapshot_hash||'')&&
    settings.entity_id===entityId&&settings.accounting_period_id===accountingPeriodId&&/^[A-Z]{3}$/.test(settings.currency||'')&&
    exact(settings.account_mappings,ACCOUNT_KEYS)&&ACCOUNT_KEYS.every(key=>text(settings.account_mappings[key],64));
}

function validSource(source,{entityId,accountingPeriodId}){
  return exact(source,SOURCE_KEYS)&&source.entity_id===entityId&&source.accounting_period_id===accountingPeriodId&&
    UUID.test(source.source_document_id||'')&&UUID.test(source.source_document_line_id||'')&&SHA.test(source.source_payload_hash||'')&&SHA.test(source.source_line_hash||'')&&
    /^[A-Z]{3}$/.test(source.currency||'')&&MONEY.test(source.amount||'')&&source.amount!=='0.0000'&&text(source.vendor_ref,200)&&
    (source.project_ref===null||text(source.project_ref,128))&&(source.property_ref===null||text(source.property_ref,128));
}

function validClassification(value,source){
  return value?.schema_version==='AI_INVOICE_ACCOUNTING_CLASSIFICATION_V2'&&value.source_document_id===source.source_document_id&&
    value.source_document_line_id===source.source_document_line_id&&value.source_payload_hash===source.source_payload_hash&&value.source_line_hash===source.source_line_hash&&
    ['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW','BLOCKED'].includes(value.classification)&&
    text(value.rule_id,128)&&text(value.reason,2000)&&typeof value.confidence==='number'&&value.confidence>=0&&value.confidence<=1&&
    Array.isArray(value.required_human_fields)&&exact(value.action_flags,Object.keys(ACTIONS))&&Object.keys(ACTIONS).every(key=>value.action_flags[key]===false);
}

const line=(lineNumber,side,accountCode,amount,source)=>freeze({line_number:lineNumber,side,account_code:accountCode,amount,currency:source.currency,project_ref:source.project_ref,property_ref:source.property_ref,source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_line_hash:source.source_line_hash});

export function buildAiAccountingDecisionPacket({entityId,accountingPeriodId,source,classification,settings}){
  if(!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||''))throw error('AI_ACCOUNTING_DECISION_SCOPE_INVALID','AI accounting decision requires an entity and accounting period.');
  if(!validSettings(settings,{entityId,accountingPeriodId}))throw error('AI_ACCOUNTING_SETTINGS_INVALID','An exact approved, scope-bound accounting settings snapshot is required.');
  if(!validSource(source,{entityId,accountingPeriodId})||source.currency!==settings.currency)throw error('AI_ACCOUNTING_SOURCE_INVALID','Retained source identity, scope, amount, currency, and lineage are required.');
  if(!validClassification(classification,source))throw error('AI_ACCOUNTING_CLASSIFICATION_INVALID','Classification must be source-bound and grant no accounting authority.');
  const treatment=TREATMENTS[classification.classification]??null;
  const status=treatment?'READY_FOR_HUMAN_REVIEW':'EXCEPTION';
  const proposedLines=treatment?freeze([
    line(1,'DEBIT',settings.account_mappings[treatment.debit],source.amount,source),
    line(2,'CREDIT',settings.account_mappings[treatment.credit],source.amount,source)
  ]):freeze([]);
  return freeze({
    schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status,entity_id:entityId,accounting_period_id:accountingPeriodId,
    source_trace:freeze({source_document_id:source.source_document_id,source_document_line_id:source.source_document_line_id,source_payload_hash:source.source_payload_hash,source_line_hash:source.source_line_hash,vendor_ref:source.vendor_ref}),
    settings_trace:freeze({snapshot_id:settings.snapshot_id,version:settings.version,snapshot_hash:settings.snapshot_hash,status:settings.status}),
    classification:classification.classification,rule_id:classification.rule_id,reason:classification.reason,confidence:classification.confidence,
    risk_level:classification.classification==='BLOCKED'?'HIGH':classification.confidence>=0.95?'LOW':'MEDIUM',required_human_fields:freeze([...classification.required_human_fields]),
    proposed_journal:freeze({status:'SUGGESTED_ONLY',balanced:treatment!==null,lines:proposedLines}),
    report_impact:treatment?treatment.report:freeze({balance_sheet:[],income_statement:[],cash_flow:[]}),
    trace:freeze({source_to_decision:true,settings_to_decision:true,decision_to_draft:false,decision_to_posted_ledger:false,decision_to_report:false}),
    action_flags:ACTIONS
  });
}

export function createAiAccountingDecisionPacketService({classificationService,settingsSnapshotReader,sourceLineReader}={}){
  if(typeof classificationService?.analyze!=='function'||typeof settingsSnapshotReader!=='function'||typeof sourceLineReader!=='function')throw new Error('AI accounting decision service requires classification, settings snapshot, and retained source readers');
  return freeze({async analyze({tenantId,entityId,accountingPeriodId,limit=100}){
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isInteger(limit)||limit<1||limit>500)throw error('AI_ACCOUNTING_DECISION_SCOPE_INVALID','AI accounting decision analysis requires tenant, entity, period, and limit 1-500.');
    const [batch,settings,sources]=await Promise.all([
      classificationService.analyze({tenantId,entityId,accountingPeriodId,limit}),
      settingsSnapshotReader({tenantId,entityId,accountingPeriodId}),
      sourceLineReader({tenantId,entityId,accountingPeriodId,limit})
    ]);
    const rows=Array.isArray(sources)?sources:[],byLine=new Map(rows.map(row=>[row.source_document_line_id,row]));
    if(!Array.isArray(batch?.results)||batch.results.length!==rows.length)throw error('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Classification and retained source populations must match exactly.');
    const packets=batch.results.map(classification=>{
      const source=byLine.get(classification.source_document_line_id);
      if(!source)throw error('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Every classification must resolve to one retained source line.');
      return buildAiAccountingDecisionPacket({entityId,accountingPeriodId,source,classification,settings});
    });
    if(new Set(packets.map(packet=>packet.source_trace.source_document_line_id)).size!==rows.length)throw error('AI_ACCOUNTING_DECISION_POPULATION_MISMATCH','Retained source lines must be consumed exactly once.');
    return freeze({schema_version:'AI_ACCOUNTING_DECISION_PACKET_BATCH_V1',scope:freeze({tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId}),row_count:packets.length,decision_counts:freeze({ready_for_human_review:packets.filter(row=>row.status==='READY_FOR_HUMAN_REVIEW').length,exception:packets.filter(row=>row.status==='EXCEPTION').length}),packets:freeze(packets),action_flags:ACTIONS});
  }});
}
