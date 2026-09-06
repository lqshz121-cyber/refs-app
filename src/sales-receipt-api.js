import {accountingApiConfig,authoritativeBearerHeaders} from './accounting-api.js';
import {validSalesReceiptPage,validSalesReceiptDetail,validSalesReceiptSelection} from './sales-receipt-read-contract.js';
const fail=message=>({ok:false,message});
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
async function read(config,path,validate,fetcher){
 if(!accountingApiConfig({__REFS_ACCOUNTING_API__:config})||typeof fetcher!=='function')return fail('Select a company and accounting period.');
 const auth=await authoritativeBearerHeaders(config);if(!auth)return fail('Sign in to read sales receipts.');
 try{
  const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}/ar/sales-receipts${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json',...auth}});
  if(!response.ok)return fail(response.status===403?'Sales receipt access is unavailable for this company.':response.status===404?'The sales receipt or period is no longer available.':'Sales receipts could not be loaded. Refresh and retry.');
  const body=await response.json();if(body?.ok!==true||!validate(body.data))return fail('Sales receipt data could not be confirmed. Refresh and retry.');
  return {ok:true,data:body.data};
 }catch{return fail('Sales receipts could not be loaded. Check the connection and retry.');}
}
export async function readSalesReceiptPage({config,afterId=null,limit=25,fetcher=globalThis.fetch}={}){
 if(!validSalesReceiptSelection({periodId:config?.periodId,afterId,limit}))return fail('Choose a valid sales receipt page.');
 const query=new URLSearchParams({periodId:config.periodId,limit:String(limit)});if(afterId)query.set('afterId',afterId);
 return read(config,'?'+query,value=>validSalesReceiptPage(value,{entityId:config.entityId,periodId:config.periodId,afterId,limit}),fetcher);
}
export async function readSalesReceipt({config,receiptId,fetcher=globalThis.fetch}={}){
 if(!uuid(receiptId))return fail('Choose a saved sales receipt.');
 return read(config,'/'+receiptId,value=>validSalesReceiptDetail(value,{entityId:config.entityId,receiptId}),fetcher);
}
