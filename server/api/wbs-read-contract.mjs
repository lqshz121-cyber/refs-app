const CONTROL=/[\u0000-\u001f\u007f]/;

export class WbsReadContractError extends Error{
  constructor(status,code,message){super(message);this.name='WbsReadContractError';this.status=status;this.code=code;}
}

const fail=(status,code,message)=>{throw new WbsReadContractError(status,code,message);};

const canonicalText=(value,name,{max=256}={})=>{
  if(typeof value!=='string'||value.length===0||value!==value.trim()||value.length>max||CONTROL.test(value))fail(400,'INVALID_QUERY_PARAMETER',`${name} must be a canonical trimmed printable value`);
  return value;
};

// The HTTP API accepts a deliberately narrow selection.  The projection is
// receipt-backed and read-only; a browser cannot expand this into a company
// dump, nor provide a request-controlled accounting action.
export function parseWbsAutoRecReviewSelection(searchParams){
  const permitted=new Set(['companyKey','sourceRecordId']);
  for(const key of searchParams.keys())if(!permitted.has(key))fail(400,'UNEXPECTED_QUERY_PARAMETER',`Unexpected query parameter: ${key}`);
  if(searchParams.getAll('companyKey').length!==1)fail(400,'WBS_COMPANY_KEY_REQUIRED','companyKey must be provided exactly once');
  const companyKey=canonicalText(searchParams.get('companyKey'),'companyKey',{max:128});
  const ids=searchParams.getAll('sourceRecordId');
  if(!ids.length)fail(400,'WBS_SOURCE_RECORD_ID_REQUIRED','At least one sourceRecordId is required');
  if(ids.length>50)fail(400,'WBS_SOURCE_RECORD_ID_LIMIT','At most 50 sourceRecordId values may be read together');
  const sourceRecordIds=ids.map(value=>canonicalText(value,'sourceRecordId',{max:512}));
  if(new Set(sourceRecordIds).size!==sourceRecordIds.length)fail(400,'WBS_SOURCE_RECORD_ID_DUPLICATE','sourceRecordId values must be unique');
  return Object.freeze({companyKey,sourceRecordIds:Object.freeze([...sourceRecordIds].sort())});
}

const exact=(params,key)=>{const values=params.getAll(key);if(values.length!==1)fail(400,'WBS_CONTROL_SCOPE_REQUIRED',`${key} must be provided exactly once`);return canonicalText(values[0],key,{max:128});};
const date=(params,key)=>{const value=exact(params,key),parsed=new Date(`${value}T00:00:00.000Z`);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)fail(400,'INVALID_QUERY_PARAMETER',`${key} must be an ISO calendar date`);return value;};

export function parseWbsControlReconciliationSelection(searchParams){
  const sourceType=exact(searchParams,'sourceType');
  const allowed=sourceType==='COST_GENERAL_LEDGER'
    ?['sourceType','companyKey','period','currency']
    :sourceType==='PROPERTY_COMPARISON'
      ?['sourceType','companyKey','propertyRef','periodStart','periodEnd','currency','bankAccountRef']
      :null;
  if(!allowed)fail(400,'WBS_CONTROL_SOURCE_TYPE_INVALID','sourceType must be COST_GENERAL_LEDGER or PROPERTY_COMPARISON');
  for(const key of searchParams.keys())if(!allowed.includes(key))fail(400,'UNEXPECTED_QUERY_PARAMETER',`Unexpected query parameter: ${key}`);
  const scope={company_key:exact(searchParams,'companyKey'),currency:exact(searchParams,'currency')};
  if(!/^[A-Z]{3}$/.test(scope.currency))fail(400,'INVALID_QUERY_PARAMETER','currency must be an ISO uppercase currency code');
  if(sourceType==='COST_GENERAL_LEDGER'){
    scope.period=exact(searchParams,'period');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(scope.period))fail(400,'INVALID_QUERY_PARAMETER','period must be YYYY-MM');
  }else{
    scope.property_ref=exact(searchParams,'propertyRef');scope.period_start=date(searchParams,'periodStart');scope.period_end=date(searchParams,'periodEnd');scope.bank_account_ref=exact(searchParams,'bankAccountRef');
    if(scope.period_start>scope.period_end)fail(400,'INVALID_QUERY_PARAMETER','periodStart must not be later than periodEnd');
  }
  return Object.freeze({sourceType,scope:Object.freeze(scope)});
}

export function assertWbsReadOnlyResult(result){
  if(!result||typeof result!=='object'||result.can_dispatch!==false||result.can_create_draft!==false||result.can_post!==false)fail(503,'WBS_READ_RESULT_INVALID','WBS read service did not return a fail-closed read-only result');
  return result;
}

export function assertWbsControlReadOnlyResult(result){
  if(!result||typeof result!=='object'||result.can_create_transaction!==false||result.can_allocate!==false||result.can_create_draft!==false||result.can_post!==false)fail(503,'WBS_CONTROL_READ_RESULT_INVALID','WBS control read service did not return a fail-closed evidence-only result');
  return result;
}
