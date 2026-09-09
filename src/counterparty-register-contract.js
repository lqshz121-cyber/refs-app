const text=(v,max,empty=false)=>typeof v==='string'&&v===v.trim()&&v.length<=max&&(empty||v.length>0)&&!/[\u0000-\u001f\u007f]/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const compare=(a,b)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;};
export const validCounterpartyRegisterSelection=({kind,status='ACTIVE',query='',afterRef=null,limit=50})=>
  ['VENDOR','CUSTOMER'].includes(kind)&&['ACTIVE','INACTIVE','ALL'].includes(status)&&text(query,128,true)
  &&(afterRef===null||text(afterRef,128))&&Number.isInteger(limit)&&limit>=1&&limit<=100;
export function validCounterpartyRegisterPage(v,{entityId,kind,status='ACTIVE',query='',afterRef=null,limit=50}){
  if(!validCounterpartyRegisterSelection({kind,status,query,afterRef,limit})||!exact(v,['schema_version','entity_id','kind','status','query','after_ref','limit','rows','next_ref'])
    ||v.schema_version!=='COUNTERPARTY_REGISTER_V1'||v.entity_id!==entityId||v.kind!==kind||v.status!==status||v.query!==query||v.after_ref!==afterRef||v.limit!==limit||!Array.isArray(v.rows)||v.rows.length>limit)return false;
  let previous=afterRef;
  for(const row of v.rows){
    if(!exact(row,['member_ref','member_type','display_name','active'])||!text(row.member_ref,128)||!text(row.display_name,Infinity)||row.member_type!==kind||typeof row.active!=='boolean'
      ||status!=='ALL'&&row.active!==(status==='ACTIVE')||previous!==null&&compare(previous,row.member_ref)>=0)return false;
    previous=row.member_ref;
  }
  return v.next_ref===null||v.rows.length===limit&&v.next_ref===previous;
}
