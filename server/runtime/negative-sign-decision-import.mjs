// R09: import and validate an Owner-filled negative-amount sign decision sheet
// (templates/negative-amount-sign-decision.template.json, schema REFS_NEGATIVE_SIGN_DECISION_V1).
//
// What this module decides, and what it refuses to decide:
//   - It never picks a meaning. There is no default classification: an entry without a valid
//     sign-off is an EXCEPTION, never a decision.
//   - It never produces a Draft or a Posted journal. Its output is a list of accepted decisions
//     plus, per decision, the set of downstream actions the rules table permits; the commands
//     that create Drafts consult `allowedActions` and refuse anything not listed.
//   - Control totals are part of validity: a sheet whose row_count / absolute_total sums do not
//     match the population it claims to cover is rejected as a whole (a missing group is not
//     "76 minus a few", it is an incomplete decision).
//   - It carries no real payload. Identity is `stable_id_hash` (sha256:...), and the validator
//     rejects free-text fields that look like an invoice number, vendor name or description.
//
// Pure: no I/O, no database. The importer that persists accepted decisions lives elsewhere and
// must only ever persist what `validateDecisionSheet` returned under `accepted`.

export const DECISION_SCHEMA='REFS_NEGATIVE_SIGN_DECISION_V1';
export const UNDECIDED='UNDECIDED';

// The closed set of meanings, each with its ledger consequence, prerequisite and the downstream
// actions it permits. `requires` names the evidence the entry must carry; `allows` is the ONLY
// thing a Draft-creating command may check. Nothing here ever includes POST.
export const DECISION_OPTIONS=Object.freeze({
  PAYMENT_OR_SETTLEMENT:Object.freeze({
    debit:'291001',credit:'CASH',
    requires:['matched_payable_ref','bank_member_ref'],
    allows:['CREATE_AP_PAYMENT_DRAFT'],
    forbids:['DIRECT_OPEN_BALANCE_CHANGE'],
  }),
  REVERSAL_OF_PRIOR_ACCRUAL:Object.freeze({
    debit:'MIRROR',credit:'MIRROR',
    requires:['original_journal_ref'],
    allows:['CREATE_REVERSAL_DRAFT'],
    forbids:[],
  }),
  CREDIT_NOTE_FROM_VENDOR:Object.freeze({
    debit:'291001',credit:'EXPENSE_OR_CREDIT',
    requires:['vendor_member_ref','credit_evidence_ref'],
    allows:['CREATE_AP_VENDOR_CREDIT_DRAFT'],
    forbids:['CREATE_AP_PAYMENT_DRAFT'],
  }),
  NEGATIVE_PAYABLE_ACCRUAL:Object.freeze({
    debit:'EXPENSE',credit:'291001',
    requires:['owner_written_confirmation_ref'],
    allows:['CREATE_NEGATIVE_PAYABLE_DRAFT'],
    forbids:[],
  }),
  SOURCE_DATA_ERROR:Object.freeze({
    debit:null,credit:null,
    requires:['wbs_correction_ref'],
    allows:['ROUTE_TO_EXCEPTION_QUEUE'],
    forbids:['CREATE_ANY_DRAFT','FLIP_SIGN'],
  }),
  [UNDECIDED]:Object.freeze({
    debit:null,credit:null,
    requires:[],
    allows:['READ_ONLY','ROUTE_TO_EXCEPTION_QUEUE'],
    forbids:['CREATE_ANY_DRAFT','POST','APPROVE_MAPPING'],
  }),
});

const DRAFT_ACTIONS=new Set(['CREATE_AP_PAYMENT_DRAFT','CREATE_REVERSAL_DRAFT','CREATE_AP_VENDOR_CREDIT_DRAFT','CREATE_NEGATIVE_PAYABLE_DRAFT']);

const SHA256_ID=/^sha256:[0-9a-f]{64}$/;
const PERIOD=/^\d{4}-(0[1-9]|1[0-2])$/;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;
const AMOUNT=/^\d+\.\d{4}$/;
const ACCOUNT=/^[0-9]{6}$/;
const ACTOR=/^[A-Za-z0-9._@|:-]{3,128}$/;
// Free text that looks like payload rather than a reference: invoice-ish numbers, "Inc"/"LLC",
// long lowercase prose. Deliberately blunt; the rule is "references, not payload".
const PAYLOAD_SMELL=/(\binv(oice)?[\s#:-]*\d{3,})|(\b(inc|llc|ltd|corp|co)\b\.?)|([a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,}\s+[a-z]{4,})/i;

export const decimalSum=values=>{
  // Exact decimal sum on 4-dp strings without floating point: work in integer ten-thousandths.
  let cents=0n;
  for(const v of values){const [i,f='0000']=String(v).split('.');cents+=BigInt(i)*10000n+BigInt(f.padEnd(4,'0').slice(0,4));}
  const s=cents.toString().padStart(5,'0');
  return `${s.slice(0,-4)}.${s.slice(-4)}`;
};

export function allowedActions(decidedMeaning){
  const option=DECISION_OPTIONS[decidedMeaning];
  return option?[...option.allows]:[...DECISION_OPTIONS[UNDECIDED].allows];
}

// The one function Draft-creating code is allowed to call. It is deliberately negative-by-default:
// unknown meaning, unknown action, or a forbidden action all return false; POST is never allowed.
export function decisionPermits(decidedMeaning,action){
  if(action==='POST')return false;
  const option=DECISION_OPTIONS[decidedMeaning];
  if(!option)return false;
  if(option.forbids.includes(action))return false;
  if(option.forbids.includes('CREATE_ANY_DRAFT')&&DRAFT_ACTIONS.has(action))return false;
  return option.allows.includes(action);
}

function validateEntry(entry,index){
  const problems=[];
  const at=field=>`entries[${index}].${field}`;
  const str=(field,re,label)=>{
    const v=entry[field];
    if(typeof v!=='string'||!re.test(v))problems.push(`${at(field)}: ${label}`);
    return typeof v==='string'?v:null;
  };
  str('source_category',/^[A-Z][A-Z0-9_]{2,63}$/,'must be an UPPER_SNAKE category code');
  str('stable_id_hash',SHA256_ID,'must be sha256:<64 hex> -- a hash of the identity, never the identity');
  str('company_code',/^[A-Z0-9_-]{1,32}$/,'must be a company code (no name)');
  str('period_code',PERIOD,'must be YYYY-MM');
  str('currency',/^[A-Z]{3}$/,'must be ISO 4217');
  if(!Number.isInteger(entry.row_count)||entry.row_count<1)problems.push(`${at('row_count')}: must be a positive integer`);
  if(entry.amount_sign!=='NEGATIVE')problems.push(`${at('amount_sign')}: this sheet only covers NEGATIVE rows`);
  const total=str('absolute_total',AMOUNT,'must be a positive 4-decimal string (aggregate only)');
  if(total!==null&&/^0+\.0000$/.test(total))problems.push(`${at('absolute_total')}: must be positive`);
  const risk=str('risk',/^(CRITICAL|HIGH)$/,'a negative amount is never below HIGH (X03 rule)');
  if(total!==null&&risk==='HIGH'&&BigInt(total.split('.')[0])>=1000000n)problems.push(`${at('risk')}: |amount| >= 1,000,000 must be CRITICAL`);
  const candidate=entry.candidate_meaning;
  if(!(candidate in DECISION_OPTIONS))problems.push(`${at('candidate_meaning')}: must be one of ${Object.keys(DECISION_OPTIONS).join(', ')}`);
  const preparedBy=str('prepared_by',ACTOR,'actor id required');
  str('prepared_at',ISO_DATE,'ISO 8601 required');
  const approver=str('approver',ACTOR,'approver actor id required');
  if(preparedBy&&approver&&preparedBy===approver)problems.push(`${at('approver')}: must differ from prepared_by (four eyes)`);
  const decided=entry.decided_meaning;
  if(!(decided in DECISION_OPTIONS))problems.push(`${at('decided_meaning')}: must be one of ${Object.keys(DECISION_OPTIONS).join(', ')}`);
  for(const field of ['candidate_rationale','evidence_ref','decision_reason','exception']){
    const v=entry[field];
    if(typeof v==='string'&&PAYLOAD_SMELL.test(v))problems.push(`${at(field)}: looks like transaction payload (invoice number, vendor name or prose); use a reference`);
  }
  if(decided===UNDECIDED){
    if(entry.decided_at!=null)problems.push(`${at('decided_at')}: must be null while decided_meaning is UNDECIDED`);
  }else{
    str('decided_at',ISO_DATE,'required once decided');
    const reason=entry.decision_reason;
    if(typeof reason!=='string'||reason.trim().length<8||reason.length>2000)problems.push(`${at('decision_reason')}: 8-2000 characters required once decided`);
    const option=DECISION_OPTIONS[decided];
    if(option){
      const evidence=entry.decision_evidence&&typeof entry.decision_evidence==='object'?entry.decision_evidence:{};
      for(const key of option.requires){
        if(typeof evidence[key]!=='string'||evidence[key].trim().length<3)problems.push(`${at(`decision_evidence.${key}`)}: ${decided} requires it`);
      }
      // Ledger-effect consistency: where the option fixes an account, the sheet must agree.
      if(option.debit&&ACCOUNT.test(option.debit)&&entry.debit_effect!==option.debit)problems.push(`${at('debit_effect')}: ${decided} debits ${option.debit}`);
      if(option.credit&&ACCOUNT.test(option.credit)&&entry.credit_effect!==option.credit)problems.push(`${at('credit_effect')}: ${decided} credits ${option.credit}`);
      if(option.debit===null&&(entry.debit_effect||entry.credit_effect))problems.push(`${at('debit_effect')}: ${decided} has no ledger effect; leave debit/credit empty`);
    }
  }
  return problems;
}

// validateDecisionSheet(doc, {expectedRowCount, expectedAbsoluteTotal}) ->
//   {ok, sheetProblems:[...], accepted:[...], exceptions:[...], controlTotals:{...}}
// `accepted` holds only entries with a complete, valid sign-off (decided_meaning != UNDECIDED and
// every rule satisfied). Everything else -- undecided, invalid, or on an invalid sheet -- is an
// exception with its reasons. There is no third bucket and no default.
export function validateDecisionSheet(doc,{expectedRowCount=null,expectedAbsoluteTotal=null}={}){
  const sheetProblems=[];
  if(!doc||typeof doc!=='object')return {ok:false,sheetProblems:['sheet must be an object'],accepted:[],exceptions:[],controlTotals:null};
  if(doc.schema_version!==DECISION_SCHEMA)sheetProblems.push(`schema_version must be ${DECISION_SCHEMA}`);
  const entries=Array.isArray(doc.entries)?doc.entries:[];
  if(!entries.length)sheetProblems.push('entries must be a non-empty array');
  const templateRows=entries.filter(e=>typeof e?.$comment==='string'&&/TEMPLATE ROW/.test(e.$comment));
  if(templateRows.length)sheetProblems.push(`${templateRows.length} template placeholder row(s) still present`);

  const accepted=[],exceptions=[];
  const seen=new Map();
  entries.forEach((entry,index)=>{
    const problems=validateEntry(entry??{},index);
    const id=entry?.stable_id_hash;
    if(typeof id==='string'){
      if(seen.has(id))problems.push(`entries[${index}].stable_id_hash: duplicates entries[${seen.get(id)}]`);
      else seen.set(id,index);
    }
    const decided=entry?.decided_meaning;
    if(problems.length){exceptions.push({index,stable_id_hash:id??null,reason:'INVALID',problems});return;}
    if(decided===UNDECIDED){exceptions.push({index,stable_id_hash:id,reason:'UNDECIDED',problems:['no decision recorded; cannot be drafted or posted']});return;}
    accepted.push({
      index,stable_id_hash:id,source_category:entry.source_category,company_code:entry.company_code,period_code:entry.period_code,
      currency:entry.currency,row_count:entry.row_count,absolute_total:entry.absolute_total,risk:entry.risk,
      decided_meaning:decided,decided_at:entry.decided_at,approver:entry.approver,prepared_by:entry.prepared_by,
      decision_reason:entry.decision_reason,decision_evidence:{...entry.decision_evidence},
      allowed_actions:allowedActions(decided),
    });
  });

  // Control totals over the WHOLE sheet, valid or not: a group that was left out cannot be seen
  // from the inside, only by the totals failing to add up.
  const rowCount=entries.reduce((n,e)=>n+(Number.isInteger(e?.row_count)?e.row_count:0),0);
  const absoluteTotal=decimalSum(entries.map(e=>e?.absolute_total).filter(v=>typeof v==='string'&&AMOUNT.test(v)));
  const controlTotals={row_count:rowCount,absolute_total:absoluteTotal,
    expected_row_count:expectedRowCount,expected_absolute_total:expectedAbsoluteTotal,
    row_count_matches:expectedRowCount===null?null:rowCount===expectedRowCount,
    absolute_total_matches:expectedAbsoluteTotal===null?null:absoluteTotal===expectedAbsoluteTotal};
  if(controlTotals.row_count_matches===false)sheetProblems.push(`control total: row_count sums to ${rowCount}, expected ${expectedRowCount}`);
  if(controlTotals.absolute_total_matches===false)sheetProblems.push(`control total: absolute_total sums to ${absoluteTotal}, expected ${expectedAbsoluteTotal}`);

  const ok=sheetProblems.length===0;
  // An invalid sheet accepts nothing: every entry becomes an exception, including the ones that
  // were individually fine, because the population they were decided against is not trustworthy.
  if(!ok){
    for(const a of accepted)exceptions.push({index:a.index,stable_id_hash:a.stable_id_hash,reason:'SHEET_INVALID',problems:[...sheetProblems]});
    accepted.length=0;
    exceptions.sort((x,y)=>x.index-y.index);
  }
  return {ok,sheetProblems,accepted,exceptions,controlTotals};
}
