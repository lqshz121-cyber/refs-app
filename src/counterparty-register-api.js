import {accountingApiConfig,authoritativeBearerHeaders} from './accounting-api.js';
import {validCounterpartyRegisterSelection,validCounterpartyRegisterPage} from './counterparty-register-contract.js';
export async function readCounterpartyRegister({config,kind,status='ACTIVE',query='',afterRef=null,limit=25,fetcher=globalThis.fetch,signal}={}){
  const fail=message=>({ok:false,message});const selection={kind,status,query,afterRef,limit};
  if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||!validCounterpartyRegisterSelection(selection))return fail('Choose a company and valid search filters.');
  try{
    const headers=await authoritativeBearerHeaders(config);if(!headers)return fail('Sign in to view this company’s contacts.');
    const params=new URLSearchParams({kind,status,query,limit:String(limit)});if(afterRef!==null)params.set('afterRef',afterRef);
    const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/counterparties?${params}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...headers},signal});
    if(!response.ok)return fail(response.status===403?'You do not have access to these contacts for this company.':'Contacts could not be loaded. Please retry.');
    const body=await response.json();if(body?.ok!==true||!validCounterpartyRegisterPage(body.data,{entityId:config.entityId,...selection}))return fail('The contact list did not match your current company or filters. Please retry.');
    return {ok:true,data:body.data};
  }catch{return fail('Contacts could not be loaded. Check your connection and retry.');}
}
