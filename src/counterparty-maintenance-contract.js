const text=(v,max,min=1)=>typeof v==='string'&&v===v.trim()&&[...v].length>=min&&[...v].length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function validCounterpartyProposal(v){
 return exact(v,['kind','memberRef','changeType','displayName','active','reason'])
  &&['VENDOR','CUSTOMER'].includes(v.kind)&&text(v.memberRef,128)
  &&['CREATE','UPDATE'].includes(v.changeType)&&text(v.displayName,256)&&typeof v.active==='boolean'
  &&(v.changeType!=='CREATE'||v.active)&&text(v.reason,2000,8);
}
export const validCounterpartyReview=v=>exact(v,['decision','reason'])&&['APPROVE','REJECT'].includes(v.decision)&&text(v.reason,2000,8);
export function validCounterpartyChangeReceipt(v,{entityId,kind,memberRef,changeId,decision}={}){
 const reviewed=decision!==undefined;
 const keys=['counterparty_change_id','entity_id','member_ref','kind','status','revision','idempotent',...(reviewed?['member_revision']:[])];
 return exact(v,keys)&&uuid(v.counterparty_change_id)&&v.entity_id===entityId&&text(v.member_ref,128)
  &&['VENDOR','CUSTOMER'].includes(v.kind)&&(kind===undefined||v.kind===kind)&&(memberRef===undefined||v.member_ref===memberRef)
  &&(changeId===undefined||v.counterparty_change_id===changeId)&&typeof v.idempotent==='boolean'
  &&v.revision===(reviewed?1:0)&&v.status===(reviewed?(decision==='APPROVE'?'APPROVED':'REJECTED'):'PENDING')
  &&(!reviewed||(decision==='REJECT'?v.member_revision===null:Number.isSafeInteger(v.member_revision)&&v.member_revision>=0));
}
