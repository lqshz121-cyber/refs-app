// Internal full-test uses one browser entry point but never collapses the
// accounting workflow into one database identity.  Each admitted command is
// executed by a pre-provisioned, finite test actor; reads use the reader.
const ACTOR_KEYS=Object.freeze(['reader','maker','submitter','reviewer','approver','poster','reconciliationStarter','clearer','reopener']);
const safeActor=value=>typeof value==='string'&&value.trim().length>=3&&value.trim().length<=200&&!/[\u0000-\u001f\u007f]/.test(value);

export class InternalTestIdentityRouteError extends Error{
  constructor(code,message){super(message);this.name='InternalTestIdentityRouteError';this.code=code;}
}

export function internalTestWorkflowActors(environment={}){
  const actors=Object.fromEntries(ACTOR_KEYS.map(key=>[key,String(environment[`REFS_INTERNAL_TEST_${key.replace(/[A-Z]/g,letter=>`_${letter}`).toUpperCase()}_ACTOR_ID`]||'').trim()]));
  if(Object.values(actors).some(value=>!safeActor(value))||new Set(Object.values(actors)).size!==ACTOR_KEYS.length)throw new InternalTestIdentityRouteError('INTERNAL_TEST_ACTOR_CONFIG_INVALID','Internal full-test workflow actors must be present, safe, and distinct');
  return Object.freeze(actors);
}

const writeActor=(method,pathname)=>{
  if(method!=='POST')return null;
  const parts=pathname.split('/').filter(Boolean);
  if(parts[0]!=='api'||parts[1]!=='v1'||parts[2]!=='entities')return null;
  if(parts[4]==='journal-entries'&&parts[6]==='transitions'){
    const action=String(parts[7]||'').toUpperCase();
    return action==='SUBMIT'?'submitter':action==='REVIEW'?'reviewer':action==='APPROVE'?'approver':null;
  }
  if(parts[4]==='journal-entries'&&parts[6]==='post')return 'poster';
  if(parts[4]==='journal-entries'&&['manual','auto'].includes(parts[5]))return 'maker';
  if(parts[4]==='bank'&&parts[5]==='reconciliations'&&parts.length===6)return 'reconciliationStarter';
  if(parts[4]==='bank'&&parts[5]==='reconciliations'&&parts[7]==='transitions'){
    const action=String(parts[8]||'').toUpperCase();
    return action==='REVIEW'?'reviewer':action==='SIGN_OFF'?'approver':action==='REOPEN'?'reopener':null;
  }
  if(parts[4]==='bank'&&parts[5]==='reconciliations'&&(parts[7]==='items'||parts[7]==='adjustment-items')&&parts[9]==='clearance')return 'clearer';
  if((parts[4]==='ap'&&parts[5]==='bills')||(parts[4]==='ar'&&parts[5]==='invoices'))return 'maker';
  if(parts[4]==='cash-transfers'){
    if(parts.length===5)return 'maker';
    if(parts[6]==='transitions'){
      const action=String(parts[7]||'').toUpperCase();
      return action==='SUBMIT'?'submitter':action==='REVIEW'?'reviewer':action==='APPROVE'?'approver':null;
    }
    if(parts[6]==='post')return 'poster';
    if(parts[6]==='bank-links')return 'maker';
  }
  return null;
};

export function routeInternalTestPrincipal({method,url,principal,actors}={}){
  if(!principal?.internalTest||!actors)return principal;
  const pathname=new URL(url,'http://refs.local').pathname;
  if(method==='GET'||method==='HEAD')return Object.freeze({...principal,actorId:actors.reader,internalTest:true});
  const actorKey=writeActor(method,pathname);
  if(!actorKey)throw new InternalTestIdentityRouteError('INTERNAL_TEST_COMMAND_NOT_ADMITTED','This internal-test command is not admitted to the controlled workflow');
  return Object.freeze({...principal,actorId:actors[actorKey],internalTest:true,internalTestActorRole:actorKey});
}
