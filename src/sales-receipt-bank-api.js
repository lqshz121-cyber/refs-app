import {accountingApiConfig,authoritativeBearerHeaders,refreshCurrentActorAccess} from './accounting-api.js';
import {validSalesReceiptBankCandidates} from './sales-receipt-bank-contract.js';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const fail=message=>({ok:false,message});
const configured=c=>!!accountingApiConfig({__REFS_ACCOUNTING_API__:c});
const reasonValid=v=>typeof v==='string'&&v===v.trim()&&v.length>=8&&v.length<=2000&&!/[\x00-\x1f\x7f]/.test(v);
async function identity(config,fetcher){
 if(!configured(config))return fail('Choose a company before matching.');
 const headers=await authoritativeBearerHeaders(config);if(!headers)return fail('Sign in to match this bank transaction.');
 // Use the same bearer for the access check and subsequent command.
 const pinned={...config,getAccessToken:async()=>headers.authorization.slice(7)};
 const access=await refreshCurrentActorAccess({config:pinned,fetcher});if(!access.ok)return access;
 if(access.row.session_refresh_required||!access.row.permissions.some(p=>p==='BANK.MATCH.CREATE'||p==='*'))return fail('Bank matching access is unavailable for this company.');
 return {ok:true,actorId:access.row.actor_id,headers};
}
export async function readSalesBankAccess({config,fetcher=globalThis.fetch}={}){const result=await identity(config,fetcher);return result.ok?{ok:true,actorId:result.actorId}:result;}
export async function readSalesBankCandidates({config,bankSourceId,afterId=null,limit=25,fetcher=globalThis.fetch}={}){
 if(!configured(config)||!uuid(bankSourceId)||afterId!==null&&!uuid(afterId)||!Number.isInteger(limit)||limit<1||limit>100)return fail('Choose a valid bank transaction and candidate page.');
 const headers=await authoritativeBearerHeaders(config);if(!headers)return fail('Sign in to read matching sales receipts.');
 const query=new URLSearchParams({limit:String(limit)});if(afterId)query.set('afterId',afterId);
 try{
  const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/transactions/${bankSourceId}/sales-receipt-candidates?${query}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...headers}});
  if(!response.ok)return fail(response.status===403?'Bank matching access is unavailable for this company.':'Matching sales receipts could not be loaded. Refresh and retry.');
  const body=await response.json();if(body?.ok!==true||!validSalesReceiptBankCandidates(body.data,{entityId:config.entityId,bankSourceId,afterId,limit}))return fail('The matching receipts could not be verified. Refresh and retry.');
  return {ok:true,data:body.data};
 }catch{return fail('Matching sales receipts could not be loaded. Check the connection and retry.');}
}
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),v=>v.toString(16).padStart(2,'0')).join('');
const keyFor=command=>digest(['SALES_BANK_MATCH_V2',command.baseUrl,command.entityId,command.bankSourceId,command.bankRevision,command.actorId,command.nonce,command.body,command.trace]);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export async function validSalesBankCommand({config,command,bankSourceId=command?.bankSourceId,actorId=command?.actorId}={}){
 try{return !!(configured(config)&&exact(command,['baseUrl','entityId','bankSourceId','bankRevision','actorId','body','trace','nonce','idempotencyKey'])&&command.baseUrl===config.baseUrl&&command.entityId===config.entityId&&command.bankSourceId===bankSourceId&&command.actorId===actorId&&typeof actorId==='string'&&actorId.length>0&&actorId.length<=200&&actorId===actorId.trim()&&!/[\x00-\x1f\x7f]/.test(actorId)&&uuid(command.nonce)&&uuid(bankSourceId)&&exact(command.body,['salesReceiptId','expectedReceiptRevision','reason'])&&uuid(command.body.salesReceiptId)&&reasonValid(command.body.reason)&&Number.isSafeInteger(command.body.expectedReceiptRevision)&&command.body.expectedReceiptRevision>=0&&typeof command.bankRevision==='string'&&/^(0|[1-9]\d*)$/.test(command.bankRevision)&&Number.isSafeInteger(Number(command.bankRevision))&&exact(command.trace,['journal_entry_id','journal_line_id','ledger_line_id'])&&Object.values(command.trace).every(uuid)&&command.idempotencyKey==='sales-bank-'+await keyFor(command));}catch{return false;}
}
export async function prepareSalesBankMatch({config,bank,candidate,bankRevision,reason,expectedActorId,fetcher=globalThis.fetch}={}){
 const normalizedReason=typeof reason==='string'?reason.trim():reason;
 const page={schema_version:'SALES_RECEIPT_BANK_CANDIDATES_V1',entity_id:config?.entityId,bank_source_id:bank?.bank_source_id,bank_revision:bankRevision,after_id:null,limit:1,rows:[candidate],next_id:null};
 if(!configured(config)||!validSalesReceiptBankCandidates(page,{entityId:config.entityId,bankSourceId:bank?.bank_source_id,limit:1})||!Number.isSafeInteger(bank.version)||String(bank.version)!==bankRevision||bank.bank_match_id&&bank.match_status==='ACTIVE'||!reasonValid(normalizedReason)||!Number.isSafeInteger(Number(candidate.receipt_revision))||candidate.bank_member_ref!==bank.bank_account_ref||candidate.currency!==bank.currency||candidate.amount!==bank.amount)return fail('Refresh the bank transaction and select a current matching receipt with a review reason.');
 const access=await identity(config,fetcher);if(!access.ok)return access;if(access.actorId!==expectedActorId)return fail('The signed-in user changed. Reload this matching form.');
 const command={baseUrl:config.baseUrl,entityId:config.entityId,bankSourceId:bank.bank_source_id,bankRevision,actorId:access.actorId,body:Object.freeze({salesReceiptId:candidate.sales_receipt_id,expectedReceiptRevision:Number(candidate.receipt_revision),reason:normalizedReason}),trace:Object.freeze({journal_entry_id:candidate.journal_entry_id,journal_line_id:candidate.journal_line_id,ledger_line_id:candidate.ledger_line_id})};
 command.nonce=crypto.randomUUID();command.idempotencyKey='sales-bank-'+await keyFor(command);return {ok:true,command:Object.freeze(command)};
}
export async function sendSalesBankMatch({config,command,fetcher=globalThis.fetch}={}){
 if(!await validSalesBankCommand({config,command}))return fail('The saved match request does not belong to this company or has changed.');
 const access=await identity(config,fetcher);if(!access.ok)return access;if(access.actorId!==command.actorId)return fail('Restore the original sign-in to confirm this match request.');
 try{
  const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/bank/transactions/${command.bankSourceId}/sales-receipt-matches`,{method:'POST',credentials:'include',cache:'no-store',headers:{accept:'application/json','content-type':'application/json',...access.headers,'idempotency-key':command.idempotencyKey,'if-match':`"${command.bankRevision}"`},body:JSON.stringify(command.body)});
  if(!response.ok)return {...fail(response.status>=500?'The match result is uncertain. Retry the same request.':'The match was not accepted. Refresh the bank record and review the selected receipt.'),attempted:true,unconfirmed:response.status>=500};
  const body=await response.json(),r=body?.data,keys=['bank_match_id','bank_source_id','sales_receipt_id','journal_entry_id','journal_line_id','ledger_line_id','status','revision','idempotent'];
  if(![200,201].includes(response.status)||body?.ok!==true||!r||Object.keys(r).length!==keys.length||!keys.every(k=>Object.hasOwn(r,k))||!uuid(r.bank_match_id)||r.bank_source_id!==command.bankSourceId||r.sales_receipt_id!==command.body.salesReceiptId||!['journal_entry_id','journal_line_id','ledger_line_id'].every(k=>uuid(r[k])&&r[k]===command.trace[k])||r.status!=='ACTIVE'||r.revision!==0||r.idempotent!==(response.status===200))return {...fail('The match result could not be verified. Retry the same request.'),attempted:true,unconfirmed:true};
  return {ok:true,data:r,attempted:true};
 }catch{return {...fail('The match result is uncertain. Retry the same request.'),attempted:true,unconfirmed:true};}
}
