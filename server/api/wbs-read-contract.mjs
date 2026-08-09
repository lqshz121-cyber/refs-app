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

export function assertWbsReadOnlyResult(result){
  if(!result||typeof result!=='object'||result.can_dispatch!==false||result.can_create_draft!==false||result.can_post!==false)fail(503,'WBS_READ_RESULT_INVALID','WBS read service did not return a fail-closed read-only result');
  return result;
}
