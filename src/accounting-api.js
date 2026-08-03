const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const accountingApiConfig=(environment=globalThis)=>{
  const source=environment?.__REFS_ACCOUNTING_API__;
  if(!source||typeof source!=='object'||!UUID.test(source.entityId||''))return null;
  let baseUrl;try{baseUrl=new URL(source.baseUrl);}catch{return null;}
  if(baseUrl.protocol!=='https:'||baseUrl.username||baseUrl.password)return null;
  return {baseUrl:baseUrl.toString().replace(/\/$/,''),entityId:source.entityId};
};

const documentRow=(row,kind)=>({
  ...(kind==='AP_BILL'?{bill_id:row.business_document_id,bill_no:row.document_number,invoice_no:row.document_number,vendor_id:row.counterparty_ref,vendor_name:row.counterparty_name,bill_date:row.accounting_date}:{inv_id:row.business_document_id,inv_no:row.document_number,customer_id:row.counterparty_ref,customer_name:row.counterparty_name,inv_date:row.accounting_date}),
  due_date:row.due_date,amount:Number(row.gross_amount),open_balance:Number(row.open_balance),currency:row.currency,status:row.status,je_number:row.posted_journal_entry_id||null,revision:row.version,
});

export async function refreshAuthoritativeDocuments({config,fetcher=globalThis.fetch}={}){
  if(!config||typeof fetcher!=='function')return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'No authoritative accounting API is configured.'};
  const read=async path=>{const response=await fetcher(`${config.baseUrl}/api/v1/entities/${config.entityId}${path}`,{method:'GET',credentials:'include',cache:'no-store',headers:{accept:'application/json'}});if(!response.ok)return null;const body=await response.json();return body?.ok===true&&Array.isArray(body.data)?body.data:null;};
  try{const [bills,invoices]=await Promise.all([read('/ap/bills'),read('/ar/invoices')]);if(!bills||!invoices)return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting refresh failed.'};return {ok:true,ap:{bills:bills.map(row=>documentRow(row,'AP_BILL')),dupBlocked:0},ar:{invoices:invoices.map(row=>documentRow(row,'AR_INVOICE'))}};}catch{return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Authoritative accounting refresh failed.'};}
}
