import {randomUUID} from 'node:crypto';

// The existing deployment-approved reader setup runs only when PostgreSQL
// confirms this actor has no active grant. Existing roles are never replaced.
export function createInitialReadSessionFactory({initializeReadAccess,tenantId}={}){
  const pending=new Map();
  return ({principal,issue})=>async()=>{
    try{return await issue();}
    catch(error){
      if(error?.code!=='42501'||error.message!=='Actor has no active DB authorization grant'
        ||principal?.trusted!==true||principal.tenantId!==tenantId||typeof initializeReadAccess!=='function')throw error;
      const key=principal.actorId;
      let initialization=pending.get(key);
      if(!initialization){
        initialization=Promise.resolve().then(()=>initializeReadAccess({actorId:key,idempotencyKey:`initial-reader-${randomUUID()}`}));
        pending.set(key,initialization);
      }
      try{await initialization;}finally{if(pending.get(key)===initialization)pending.delete(key);}
      return issue();
    }
  };
}
