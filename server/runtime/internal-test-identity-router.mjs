// Internal full-test uses one browser entry point but never collapses the
// accounting workflow into one database identity. Each admitted command is
// executed by a pre-provisioned, finite test actor; reads use the reader.
const ACTOR_KEYS=Object.freeze(['reader','maker','expenseMaker','paymentMaker','receiptMaker','salesReceiptMaker','reversalMaker','adjustmentMaker','refundMaker','allocator','submitter','reviewer','approver','poster','reconciliationStarter','clearer','unmatcher','reopener','periodCloser','periodReopener','cashTransferReconciler','recurringRunner']);
const safeActor=value=>typeof value==='string'&&value.trim().length>=3&&value.trim().length<=200&&!/[\u0000-\u001f\u007f]/.test(value);

export class InternalTestIdentityRouteError extends Error{
  constructor(code,message){super(message);this.name='InternalTestIdentityRouteError';this.code=code;}
}

export function internalTestWorkflowActors(environment={}){
  const actors=Object.fromEntries(ACTOR_KEYS.map(key=>[key,String(environment[`REFS_INTERNAL_TEST_${key.replace(/[A-Z]/g,letter=>`_${letter}`).toUpperCase()}_ACTOR_ID`]||'').trim()]));
  if(Object.values(actors).some(value=>!safeActor(value))||new Set(Object.values(actors)).size!==ACTOR_KEYS.length)throw new InternalTestIdentityRouteError('INTERNAL_TEST_ACTOR_CONFIG_INVALID','Internal full-test workflow actors must be present, safe, and distinct');
  return Object.freeze(actors);
}

const actionFromBody=body=>typeof body?.action==='string'?body.action.trim().toUpperCase():'';

const writeActor=(method,pathname,body)=>{
  if(method!=='POST')return null;
  const parts=pathname.split('/').filter(Boolean);
  if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')return null;
  const [,,, ,domain,resource,id,next,after]=parts;
  const action=String(next||'').toUpperCase();
  if(domain==='journal-entries'){
    if(['manual','auto'].includes(resource))return 'maker';
    if(id==='transitions')return action==='SUBMIT'?'submitter':action==='REVIEW'?'reviewer':action==='APPROVE'?'approver':null;
    if(id==='post')return 'poster';
    return null;
  }
  if(domain==='bank'){
    if(resource==='reconciliations'){
      if(parts.length===6||id==='from-admitted-statement')return 'reconciliationStarter';
      if(next==='transitions'){const transition=String(after||'').toUpperCase();return transition==='REVIEW'?'reviewer':transition==='SIGN_OFF'?'approver':transition==='REOPEN'?'reopener':null;}
      if((next==='items'||next==='adjustment-items')&&parts[9]==='clearance')return 'clearer';
      if(next==='adjustment-drafts')return 'maker';
    }
    if(resource==='transactions'){
      if(next==='matches'&&parts[9]==='unmatch')return 'unmatcher';
      if(next==='matches'||next==='sales-receipt-matches')return 'maker';
    }
    return null;
  }
  if(domain==='cash-transfers'){
    if(parts.length===5)return 'maker';
    if(id==='transitions')return action==='SUBMIT'?'submitter':action==='REVIEW'?'reviewer':action==='APPROVE'?'approver':null;
    if(id==='post')return 'poster';
    if(id==='cancel')return 'reversalMaker';
    if(id==='bank-links')return 'cashTransferReconciler';
    if(resource==='bank-account-controls')return parts.length===6?'maker':next==='approve'?'approver':next==='retire'?'reversalMaker':null;
    return null;
  }
  if(domain==='ap'){
    if(resource==='bills'&&parts.length===6)return 'maker';
    if(resource==='bills'&&next==='voids')return 'reversalMaker';
    if(resource==='bills'&&next==='native-payments')return 'paymentMaker';
    if(resource==='expenses'&&parts.length===6)return 'expenseMaker';
    if(resource==='payments'&&next==='reversals')return 'reversalMaker';
    if(resource==='vendor-credits'&&parts.length===6)return 'adjustmentMaker';
    if(resource==='vendor-credits'&&next==='allocations')return 'allocator';
    return null;
  }
  if(domain==='ar'){
    if(resource==='invoices'&&parts.length===6)return 'maker';
    if(resource==='invoices'&&next==='native-receipts')return 'receiptMaker';
    if(resource==='sales-receipts'&&parts.length===6)return 'salesReceiptMaker';
    if(resource==='receipts'&&next==='reversals')return 'reversalMaker';
    if(resource==='credit-memos'&&parts.length===6)return 'adjustmentMaker';
    if(resource==='credit-memos'&&next==='allocations')return 'allocator';
    if(resource==='credit-memos'&&next==='native-refunds')return 'refundMaker';
    return null;
  }
  if(domain==='forecasts'){
    if(parts.length===5)return 'maker';
    if(parts.length===7&&parts[6]==='transitions'){const action=actionFromBody(body);return action==='SUBMIT'?'submitter':action==='APPROVE'?'approver':null;}
    return null;
  }
  if(domain==='recurring-schedules'){
    if(parts.length===5)return 'maker';
    if(parts.length===6&&parts[5]==='run-due')return 'recurringRunner';
    if(parts.length===7&&parts[6]==='transitions'){const action=actionFromBody(body);return action==='SUBMIT'?'submitter':action==='APPROVE'?'approver':(['PAUSE','RESUME'].includes(action)?'reviewer':null);}
    return null;
  }
  if(domain==='report-saved-views'&&(parts.length===5||parts.length===6))return 'maker';
  if(domain==='periods'&&id==='close')return 'periodCloser';
  if(domain==='periods'&&id==='reopen')return 'periodReopener';
  return null;
};

export function routeInternalTestPrincipal({method,url,body,principal,actors}={}){
  if(!principal?.internalTest||!actors)return principal;
  const pathname=new URL(url,'http://refs.local').pathname;
  if(method==='GET'||method==='HEAD')return Object.freeze({...principal,actorId:actors.reader,internalTest:true});
  const actorKey=writeActor(method,pathname,body);
  if(!actorKey)throw new InternalTestIdentityRouteError('INTERNAL_TEST_COMMAND_NOT_ADMITTED','This internal-test command is not admitted to the controlled workflow');
  return Object.freeze({...principal,actorId:actors[actorKey],internalTest:true,internalTestActorRole:actorKey});
}
