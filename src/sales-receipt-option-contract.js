const compare=(a,b)=>{const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;};
const text=(v,max,empty=false)=>typeof v==='string'&&v===v.trim()&&v.length<=max&&(empty||v.length>0)&&!/[\u0000-\u001f\u007f]/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const validSalesReceiptOptionSelection=({optionKind,query='',afterRef=null,limit=50})=>['CUSTOMER','BANK','CASH_ACCOUNT','CATEGORY_ACCOUNT'].includes(optionKind)&&text(query,128,true)&&(afterRef===null||text(afterRef,128))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validSalesReceiptOptions(v,{entityId,optionKind,query='',afterRef=null,limit=50}){
 if(!validSalesReceiptOptionSelection({optionKind,query,afterRef,limit})||!exact(v,['schema_version','entity_id','option_kind','query','after_ref','limit','rows','next_ref'])||v.schema_version!=='SALES_RECEIPT_OPTIONS_V1'||v.entity_id!==entityId||v.option_kind!==optionKind||v.query!==query||v.after_ref!==afterRef||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
 let previous=afterRef;const kinds=optionKind==='CUSTOMER'?['CUSTOMER','AFFILIATE']:[optionKind];
 for(const row of v.rows){if(!exact(row,['ref','label','kind'])||!text(row.ref,optionKind.endsWith('_ACCOUNT')?64:128)||!text(row.label,Infinity)||!kinds.includes(row.kind)||previous!==null&&compare(previous,row.ref)>=0)return false;previous=row.ref;}
 return v.next_ref===null||v.rows.length===limit&&v.next_ref===previous;
}
