import {accountingApiConfig,authoritativeBearerHeaders,createAuthoritativeAdjustment,refreshAuthoritativeChartOfAccounts,refreshAuthoritativeScope,refreshCurrentActorAccess} from './accounting-api.js';
import {uploadVerifiedAttachment,validateAttachmentFile} from './attachment-api.js';

const fail=(code,message)=>({ok:false,code,message});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max,empty=false)=>typeof value==='string'&&value===value.trim()&&value.length<=max&&(empty||value.length>0)&&!/[\u0000-\u001f\u007f]/.test(value);
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const compare=(left,right)=>{const a=new TextEncoder().encode(left),b=new TextEncoder().encode(right);for(let index=0;index<Math.min(a.length,b.length);index++)if(a[index]!==b[index])return a[index]-b[index];return a.length-b.length;};
const hash=async(value,cryptoApi)=>Array.from(new Uint8Array(await cryptoApi.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value)),byte=>byte.toString(16).padStart(2,'0')).join('');
const normalizeConfig=config=>accountingApiConfig({__REFS_ACCOUNTING_API__:config});
const kinds=Object.freeze({AP_VENDOR_CREDIT:{partyKind:'VENDOR',view:'AP.VIEW',create:'AP.VENDOR_CREDIT.CREATE',control:'291001'},AR_CREDIT_MEMO:{partyKind:'CUSTOMER',view:'AR.VIEW',create:'AR.CREDIT_MEMO.CREATE',control:'120200'}});

export const nativeCreditAdjustmentAccess=(config,kind,access)=>!!kinds[kind]&&access?.entity_id===config?.entityId&&text(access?.actor_id,200)&&access?.session_refresh_required===false
  &&Array.isArray(access.permissions)&&[kinds[kind].view,kinds[kind].create,'ATTACHMENT.CREATE'].every(permission=>access.permissions.includes(permission));

export async function readCreditAdjustmentCounterparties({config,kind,query='',afterRef=null,limit=50,fetcher=globalThis.fetch}={}){
  const contract=kinds[kind];
  if(!normalizeConfig(config)||!contract||!text(query,128,true)||afterRef!==null&&!text(afterRef,128)||!Number.isInteger(limit)||limit<1||limit>100||typeof fetcher!=='function')return fail('CREDIT_COUNTERPARTY_SEARCH_INVALID','Choose a valid company and counterparty search.');
  const authorization=await authoritativeBearerHeaders(config);if(!authorization)return fail('AUTHENTICATION_REQUIRED','Sign in to search company counterparties.');
  const params=new URLSearchParams({kind:contract.partyKind,status:'ACTIVE',query,limit:String(limit)});if(afterRef!==null)params.set('afterRef',afterRef);
  try{
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/counterparties?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...authorization}});
    if(!response.ok)return fail(response.status===403?'CREDIT_COUNTERPARTY_ACCESS_REQUIRED':response.status===404?'CREDIT_COUNTERPARTY_SERVICE_NOT_INTEGRATED':'CREDIT_COUNTERPARTY_SEARCH_UNAVAILABLE',response.status===403?'Counterparty view access is required for this company.':response.status===404?'Counterparty service is not integrated with this release. Credit entry remains unavailable.':'Counterparty search is unavailable. Retry the search.');
    const body=await response.json(),page=body?.data,fields=['schema_version','entity_id','kind','status','query','after_ref','limit','rows','next_ref'];
    if(body?.ok!==true||!exact(page,fields)||page.schema_version!=='COUNTERPARTY_REGISTER_V1'||page.entity_id!==config.entityId||page.kind!==contract.partyKind||page.status!=='ACTIVE'||page.query!==query||page.after_ref!==afterRef||page.limit!==limit||!Array.isArray(page.rows)||page.rows.length>limit)throw Error('page');
    let previous=afterRef;
    for(const row of page.rows){if(!exact(row,['member_ref','member_type','display_name','active'])||!text(row.member_ref,128)||!text(row.display_name,10000)||row.member_type!==contract.partyKind||row.active!==true||previous!==null&&compare(previous,row.member_ref)>=0)throw Error('row');previous=row.member_ref;}
    if(page.next_ref!==null&&(page.rows.length!==limit||page.next_ref!==previous))throw Error('cursor');
    return {ok:true,data:page};
  }catch{return fail('CREDIT_COUNTERPARTY_SEARCH_UNCONFIRMED','Counterparty results could not be confirmed. Retry the search.');}
}

export function validateCreditAdjustmentDraft({config,kind,draft,counterparty,attachmentId,scope,accounts=[]}={}){
  const contract=kinds[kind];
  if(!contract||!scope||scope.entity_id!==config?.entityId||scope.period_id!==config?.periodId||scope.period_status!=='OPEN'||!validDate(scope.period_start)||!validDate(scope.period_end))return fail('PERIOD_NOT_OPEN','Select an open accounting period.');
  if(!draft||!text(draft.number,128))return fail('CREDIT_NUMBER_REQUIRED','Enter a credit reference number.');
  if(!counterparty||!text(counterparty.member_ref,128)||!text(counterparty.display_name,255)||counterparty.member_type!==contract.partyKind||counterparty.active!==true)return fail('CREDIT_COUNTERPARTY_REQUIRED','Choose an active counterparty from the company register.');
  if(!validDate(draft.date)||draft.date<scope.period_start||draft.date>scope.period_end)return fail('CREDIT_DATE_INVALID','Enter a credit date within the selected period.');
  if(typeof draft.amount!=='string'||!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/.test(draft.amount)||!/[1-9]/.test(draft.amount))return fail('AMOUNT_INVALID','Enter a positive amount with up to four decimal places.');
  const category=accounts.find(row=>row.account_code===draft.offsetAccountCode&&row.active===true&&row.requires_member===false&&row.period_id===config.periodId&&(!row.entity_id||row.entity_id===config.entityId));
  if(!category||category.account_code===contract.control)return fail('ACCOUNT_REQUIRED','Choose an active non-control category account that does not require a member.');
  if(!text(draft.reason,2000)||draft.reason.length<8)return fail('CREDIT_REASON_REQUIRED','Enter a reason from 8 to 2,000 characters.');
  if(!UUID.test(attachmentId||''))return fail('ATTACHMENT_REQUIRED','Upload and verify a supporting document first.');
  return {ok:true,adjustment:{number:draft.number,date:draft.date,counterpartyRef:counterparty.member_ref,counterpartyName:counterparty.display_name,amount:draft.amount,lines:[{line_no:1,account_code:category.account_code,amount:draft.amount,description:draft.reason}],reason:draft.reason,attachmentIds:[attachmentId]}};
}

async function currentEntryContext(config,kind,fetcher,expectedActorId){
  const [access,scope,accounts]=await Promise.all([refreshCurrentActorAccess({config,fetcher}),refreshAuthoritativeScope({config,fetcher}),refreshAuthoritativeChartOfAccounts({config,fetcher})]);
  if(!access.ok)return access;if(!scope.ok)return scope;if(!accounts.ok)return accounts;
  if(!nativeCreditAdjustmentAccess(config,kind,access.row))return fail('CREDIT_ENTRY_ACCESS_REQUIRED','Credit creation, counterparty view, and support upload access are required.');
  if(expectedActorId&&access.row.actor_id!==expectedActorId)return fail('CREDIT_ENTRY_IDENTITY_CHANGED','Your sign-in changed. Return to the adjustment list and check saved drafts before starting again.');
  if(scope.row.period_status!=='OPEN')return fail('PERIOD_NOT_OPEN','The selected accounting period is no longer open.');
  return {ok:true,access:access.row,scope:scope.row,accounts:accounts.rows};
}

export async function uploadCreditAdjustmentSupport({config,kind,file,expectedActorId,uploadAttempt=0,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  const metadata=validateAttachmentFile(file);if(!normalizeConfig(config)||!kinds[kind]||!metadata||!cryptoApi?.subtle||!Number.isSafeInteger(uploadAttempt)||uploadAttempt<0||uploadAttempt>100)return fail('ATTACHMENT_UPLOAD_INVALID','Choose a supported file and company.');
  const context=await currentEntryContext(config,kind,fetcher,expectedActorId);if(!context.ok)return context;
  try{const bytes=await file.arrayBuffer();if(bytes.byteLength!==metadata.sizeBytes)return fail('ATTACHMENT_SIZE_MISMATCH','The selected file changed. Select it again.');const contentHash=await hash(bytes,cryptoApi),identity=JSON.stringify(['CREDIT_ADJUSTMENT_SUPPORT_V1',config.entityId,kind,context.access.actor_id,metadata,contentHash,...(uploadAttempt?[uploadAttempt]:[])]);return await uploadVerifiedAttachment({config,file,idempotencyKey:`credit-support-${await hash(identity,cryptoApi)}`,fetcher,cryptoApi});}
  catch{return fail('ATTACHMENT_UPLOAD_UNCONFIRMED','The supporting document could not be confirmed. Retry the same file.');}
}

export async function createCreditAdjustmentDraft({config,kind,draft,counterparty,attachmentId,expectedActorId,fetcher=globalThis.fetch,cryptoApi=globalThis.crypto}={}){
  if(!normalizeConfig(config)||!kinds[kind]||!cryptoApi?.subtle)return fail('CREDIT_ENTRY_INVALID','Credit adjustment entry is not configured.');
  const context=await currentEntryContext(config,kind,fetcher,expectedActorId);if(!context.ok)return context;
  const validated=validateCreditAdjustmentDraft({config,kind,draft,counterparty,attachmentId,scope:context.scope,accounts:context.accounts});if(!validated.ok)return validated;
  let attempted=false,responseStatus=null;
  try{const identity=JSON.stringify(['CREDIT_ADJUSTMENT_V1',config.entityId,config.periodId,kind,context.access.actor_id,validated.adjustment]),idempotencyKey=`credit-adjustment-${await hash(identity,cryptoApi)}`;attempted=true;const result=await createAuthoritativeAdjustment({config,kind,adjustment:validated.adjustment,idempotencyKey,fetcher:async(...request)=>{const response=await fetcher(...request);responseStatus=response.status;return response;}});return {...result,attempted:true,unconfirmed:!result.ok&&!(Number.isInteger(responseStatus)&&responseStatus>=400&&responseStatus<500)};}
  catch{return {...fail('CREDIT_CREATE_UNCONFIRMED','Creation could not be confirmed. Retry the same credit before changing its details.'),attempted,unconfirmed:attempted};}
}
