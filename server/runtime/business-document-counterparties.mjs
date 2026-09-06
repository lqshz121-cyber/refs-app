const keys=['schema_version','entity_id','document_kind','query','after_ref','limit','rows','next_ref'];
const text=(value,max,empty=false)=>typeof value==='string'&&value===value.trim()&&value.length<=(max??Infinity)&&(empty||value.length>0)&&!/[\u0000-\u001f\u007f]/.test(value);
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
const compare=(left,right)=>Buffer.compare(Buffer.from(left,'utf8'),Buffer.from(right,'utf8'));

export const validBusinessDocumentCounterpartySelection=({documentKind,query='',afterRef=null,limit=50})=>
  ['AP_BILL','AR_INVOICE'].includes(documentKind)&&text(query,128,true)
  &&(afterRef===null||text(afterRef,128))&&Number.isInteger(limit)&&limit>=1&&limit<=100;

export function validBusinessDocumentCounterpartyPage(value,{entityId,documentKind,query='',afterRef=null,limit=50}){
  if(!validBusinessDocumentCounterpartySelection({documentKind,query,afterRef,limit})||!exact(value,keys)
    ||value.schema_version!=='BUSINESS_DOCUMENT_COUNTERPARTIES_V1'||value.entity_id!==entityId
    ||value.document_kind!==documentKind||value.query!==query||value.after_ref!==afterRef||value.limit!==limit
    ||!Array.isArray(value.rows)||value.rows.length>limit)return false;
  let previous=afterRef;
  for(const row of value.rows){
    if(!exact(row,['member_ref','member_type','display_name'])||!text(row.member_ref,128)||!text(row.display_name)
      ||!(documentKind==='AP_BILL'?['VENDOR']:['CUSTOMER','AFFILIATE']).includes(row.member_type)
      ||previous!==null&&compare(previous,row.member_ref)>=0)return false;
    previous=row.member_ref;
  }
  return value.next_ref===null||value.rows.length===limit&&value.next_ref===previous;
}
