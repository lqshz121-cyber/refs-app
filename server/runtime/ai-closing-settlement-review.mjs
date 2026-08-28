const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9]\d{0,17})\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const ALLOWED_KEYS=Object.freeze(['accounting_period_id','amount','closing_date','counterparty_name','currency','description','entity_id','line_code','project_ref','property_ref','settlement_type','side','source_document_id','source_document_line_id','source_line_hash','source_payload_hash']);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max)=>value===null||text(value,max);
const validDate=value=>{if(typeof value!=='string'||!DATE.test(value))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;

const RULES=Object.freeze([
  Object.freeze({treatment:'PURCHASE_PRICE',pattern:/\b(?:purchase\s+price|contract\s+price|sales\s+price)\b/i,accounting:'LAND_BUILDING_OR_INVENTORY_COST',risk_level:'MEDIUM',required:['asset_allocation','property_basis','capitalization_policy']}),
  Object.freeze({treatment:'LOAN_PROCEEDS',pattern:/\b(?:loan\s+proceeds|mortgage\s+proceeds|lender\s+funding)\b/i,accounting:'CASH_OR_DUE_FROM_CLOSING_AND_LOAN_PAYABLE',risk_level:'MEDIUM',required:['loan_reference','loan_payable_account','lender_statement_match']}),
  Object.freeze({treatment:'TITLE_OR_CLOSING_COST',pattern:/\b(?:title|escrow\s+fee|settlement\s+fee|recording\s+fee|transfer\s+tax|closing\s+cost)\b/i,accounting:'CAPITALIZE_OR_EXPENSE_POLICY_REVIEW',risk_level:'MEDIUM',required:['cost_nature','capitalization_policy','asset_or_expense_account']}),
  Object.freeze({treatment:'TAX_OR_OPERATING_PRORATION',pattern:/\b(?:property\s+tax|real\s+estate\s+tax|tax\s+proration|rent\s+proration|utility\s+proration|hoa\s+proration)\b/i,accounting:'PRORATION_RECEIVABLE_PAYABLE_PREPAID_OR_EXPENSE',risk_level:'MEDIUM',required:['proration_period','prepaid_or_accrual_treatment','counterparty']}),
  Object.freeze({treatment:'ESCROW_OR_DEPOSIT',pattern:/\b(?:escrow|deposit|reserve|earnest\s+money)\b/i,accounting:'RESTRICTED_CASH_DEPOSIT_ASSET_OR_LIABILITY',risk_level:'MEDIUM',required:['ownership','restriction_terms','asset_or_liability_account']}),
  Object.freeze({treatment:'CREDIT_OR_CONCESSION',pattern:/\b(?:seller\s+credit|buyer\s+credit|concession|repair\s+credit|closing\s+credit)\b/i,accounting:'PURCHASE_BASIS_OR_PROCEEDS_ADJUSTMENT',risk_level:'HIGH',required:['credit_beneficiary','basis_or_proceeds_allocation','counterparty']}),
  Object.freeze({treatment:'BROKER_OR_PROFESSIONAL_FEE',pattern:/\b(?:broker|commission|legal\s+fee|attorney|survey|appraisal)\b/i,accounting:'CAPITALIZE_OR_EXPENSE_POLICY_REVIEW',risk_level:'MEDIUM',required:['cost_nature','capitalization_policy','asset_or_expense_account']})
]);

function validRow(row){
  return row&&typeof row==='object'&&!Array.isArray(row)&&JSON.stringify(Object.keys(row).sort())===JSON.stringify([...ALLOWED_KEYS].sort())&&
    UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA.test(row.source_payload_hash||'')&&SHA.test(row.source_line_hash||'')&&
    UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&['PURCHASE','SALE'].includes(row.settlement_type)&&validDate(row.closing_date)&&
    text(row.line_code,128)&&text(row.description,1000)&&['DEBIT','CREDIT','INFORMATIONAL'].includes(row.side)&&MONEY.test(row.amount||'')&&row.amount!=='0.0000'&&
    /^[A-Z]{3}$/.test(row.currency||'')&&nullableText(row.property_ref,128)&&nullableText(row.project_ref,128)&&nullableText(row.counterparty_name,200);
}
const blocked=(row,reason,rule='AI_CLOSING_SETTLEMENT_SOURCE_INVALID_V1')=>Object.freeze({
  schema_version:'AI_CLOSING_SETTLEMENT_FINDING_V1',finding_type:'CLOSING_SETTLEMENT_REVIEW',risk_level:'HIGH',rule_id:rule,
  source_document_id:row?.source_document_id??null,source_document_line_id:row?.source_document_line_id??null,source_payload_hash:row?.source_payload_hash??null,source_line_hash:row?.source_line_hash??null,
  entity_id:row?.entity_id??null,accounting_period_id:row?.accounting_period_id??null,treatment:'BLOCKED',accounting_treatment:'UNDETERMINED',amount:row?.amount??null,currency:row?.currency??null,
  reason,suggested_action:'Correct and retain the missing or conflicting closing evidence before preparing any accounting entry.',confidence:1,required_human_fields:Object.freeze(['source_evidence_correction']),action_flags:ACTIONS
});

export function classifyClosingSettlementLine(row){
  if(!validRow(row))return blocked(row,'Closing classification requires an exact retained source identity, entity, period, closing date, currency, amount, side, and line description.');
  if(row.property_ref===null)return blocked(row,'A closing line has no retained property identity and cannot be allocated to real-estate basis, proceeds, proration, escrow, or expense.','AI_CLOSING_PROPERTY_REQUIRED_V1');
  const matches=RULES.filter(rule=>rule.pattern.test(`${row.line_code} ${row.description}`));
  if(matches.length!==1)return blocked(row,matches.length===0?'The closing line does not match a supported deterministic settlement treatment.':'The closing line matches conflicting settlement treatments.','AI_CLOSING_TREATMENT_AMBIGUOUS_OR_UNSUPPORTED_V1');
  const rule=matches[0];
  return Object.freeze({schema_version:'AI_CLOSING_SETTLEMENT_FINDING_V1',finding_type:'CLOSING_SETTLEMENT_REVIEW',risk_level:rule.risk_level,rule_id:`AI_CLOSING_${rule.treatment}_V1`,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,entity_id:row.entity_id,accounting_period_id:row.accounting_period_id,treatment:rule.treatment,accounting_treatment:rule.accounting,amount:row.amount,currency:row.currency,reason:`Retained ${row.settlement_type.toLowerCase()} closing evidence identifies ${rule.treatment.replaceAll('_',' ').toLowerCase()}; account selection and allocation remain subject to Controller review.`,suggested_action:'Reconcile this line to the signed closing statement, property basis or proceeds schedule, cash settlement, and approved accounting policy.',confidence:0.98,required_human_fields:Object.freeze([...rule.required]),action_flags:ACTIONS});
}

export function analyzeClosingSettlement(rows,{entityId,accountingPeriodId,limit=500}={}){
  if(!Array.isArray(rows)||limit<1||limit>500||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||''))throw Object.assign(new Error('Closing settlement review requires one bounded entity and accounting period.'),{code:'AI_CLOSING_SETTLEMENT_SCOPE_INVALID'});
  if(rows.length>=limit)throw Object.assign(new Error('The bounded closing-settlement source read cannot prove population completeness.'),{code:'AI_CLOSING_SETTLEMENT_POPULATION_INCOMPLETE'});
  const classified=rows.map(classifyClosingSettlementLine),groups=new Map();
  for(const row of rows.filter(validRow)){const key=`${row.source_document_id}|${row.currency}`;if(!groups.has(key))groups.set(key,{document:row.source_document_id,currency:row.currency,debit:0n,credit:0n,hashes:[]});const group=groups.get(key);if(row.side==='DEBIT')group.debit+=units(row.amount);if(row.side==='CREDIT')group.credit+=units(row.amount);group.hashes.push(row.source_line_hash);}
  const imbalance=[];
  for(const group of groups.values())if(group.debit!==group.credit)imbalance.push(Object.freeze({schema_version:'AI_CLOSING_SETTLEMENT_FINDING_V1',finding_type:'CLOSING_SETTLEMENT_IMBALANCE',risk_level:'HIGH',rule_id:'AI_CLOSING_STATEMENT_BALANCE_V1',source_document_id:group.document,source_document_line_id:null,source_payload_hash:rows.find(row=>row.source_document_id===group.document)?.source_payload_hash??null,source_line_hash:null,entity_id:entityId,accounting_period_id:accountingPeriodId,treatment:'BLOCKED',accounting_treatment:'UNBALANCED_SETTLEMENT',amount:money(group.debit>group.credit?group.debit-group.credit:group.credit-group.debit),currency:group.currency,reason:`The retained closing statement debits (${money(group.debit)}) do not equal credits (${money(group.credit)}).`,suggested_action:'Reconcile cash to close, loan proceeds, credits, prorations, deposits, fees, and purchase price before preparing any Journal Entry.',confidence:1,required_human_fields:Object.freeze(['closing_statement_reconciliation','cash_to_close','missing_or_misclassified_line']),history_source_line_hashes:Object.freeze([...group.hashes].sort()),action_flags:ACTIONS}));
  const findings=Object.freeze([...classified,...imbalance]);
  return Object.freeze({schema_version:'AI_CLOSING_SETTLEMENT_REVIEW_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings,action_flags:ACTIONS});
}
