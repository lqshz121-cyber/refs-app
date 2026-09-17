// O05: internal-test workflow readiness.
//
// The internal-test static site is anonymous; every POST is routed by
// internal-test-identity-router to one pre-provisioned test actor, while every
// GET runs as the reader.  The reader holds no workflow permission, so the UI's
// capability read (`journal-workflow/capabilities`) answers "nothing" and the
// browser renders Read-only even though the commands would succeed.
//
// This read answers the question the tester actually has: for each business
// workflow, are the routed actors granted what the command needs, and does the
// entity carry the master data the command needs?  It checks grants by issuing
// each actor's own session and asking the database (`refs_entity_has_permission`)
// — no new SQL privilege, no grant table exposure — and it never widens any
// grant: a missing prerequisite is reported, not fixed.  Actor identifiers are
// not echoed; roles are.
const ROLE_KEYS=Object.freeze(['reader','maker','expenseMaker','paymentMaker','receiptMaker','salesReceiptMaker','reversalMaker','adjustmentMaker','refundMaker','allocator','submitter','reviewer','approver','poster','reconciliationStarter','clearer','unmatcher','reopener','periodCloser','periodReopener','cashTransferReconciler','recurringRunner','voidMaker']);
const OPTIONAL_ROLE_KEYS=new Set(['voidMaker']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Required roles → permissions, and master data, per workflow the internal-test UI exposes.
export const INTERNAL_TEST_WORKFLOWS=Object.freeze({
  JOURNAL_ENTRY:Object.freeze({roles:Object.freeze({maker:['GL.JE.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']}),master:Object.freeze(['OPEN_PERIOD'])}),
  AP_BILL:Object.freeze({roles:Object.freeze({maker:['AP.BILL.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']}),master:Object.freeze(['OPEN_PERIOD','VENDOR'])}),
  AP_PAYMENT:Object.freeze({roles:Object.freeze({paymentMaker:['AP.PAYMENT.CREATE']}),master:Object.freeze(['OPEN_PERIOD','VENDOR','BANK'])}),
  AP_PAYMENT_REVERSAL:Object.freeze({roles:Object.freeze({reversalMaker:['AP.PAYMENT.REVERSE']}),master:Object.freeze(['OPEN_PERIOD'])}),
  AP_BILL_VOID:Object.freeze({roles:Object.freeze({voidMaker:['AP.BILL.VOID.CREATE']}),master:Object.freeze(['OPEN_PERIOD'])}),
  AR_INVOICE:Object.freeze({roles:Object.freeze({maker:['AR.INVOICE.CREATE'],submitter:['GL.JE.SUBMIT'],reviewer:['GL.JE.REVIEW'],approver:['GL.JE.APPROVE'],poster:['GL.JE.POST']}),master:Object.freeze(['OPEN_PERIOD','CUSTOMER'])}),
  AR_RECEIPT:Object.freeze({roles:Object.freeze({receiptMaker:['AR.RECEIPT.CREATE']}),master:Object.freeze(['OPEN_PERIOD','CUSTOMER','BANK'])}),
  AR_RECEIPT_REVERSAL:Object.freeze({roles:Object.freeze({reversalMaker:['AR.RECEIPT.REVERSE']}),master:Object.freeze(['OPEN_PERIOD'])}),
  BANK_RECONCILE:Object.freeze({roles:Object.freeze({reconciliationStarter:['BANK.RECONCILIATION.START'],reviewer:['BANK.RECONCILIATION.REVIEW'],approver:['BANK.RECONCILIATION.SIGN_OFF'],clearer:['BANK.RECONCILIATION.CLEAR'],reopener:['BANK.RECONCILIATION.REOPEN']}),master:Object.freeze(['OPEN_PERIOD','BANK'])})
});
export const INTERNAL_TEST_MASTER_DATA_KEYS=Object.freeze(['OPEN_PERIOD','BANK','VENDOR','CUSTOMER']);

export class InternalTestWorkflowReadinessError extends Error{constructor(code,message){super(message);this.name='InternalTestWorkflowReadinessError';this.code=code;}}
const fail=(code,message)=>{throw new InternalTestWorkflowReadinessError(code,message);};

export function createInternalTestWorkflowReadinessService({tenantId,actors,kernelForActor}={}){
  if(!UUID.test(tenantId||''))fail('INTERNAL_TEST_READINESS_CONFIG_INVALID','Internal-test tenant is invalid.');
  if(!actors||typeof actors!=='object'||ROLE_KEYS.some(role=>OPTIONAL_ROLE_KEYS.has(role)?!(actors[role]===null||actors[role]===undefined||(typeof actors[role]==='string'&&actors[role].trim())):(typeof actors[role]!=='string'||!actors[role].trim())))fail('INTERNAL_TEST_READINESS_CONFIG_INVALID','Internal-test actors are incomplete.');
  if(typeof kernelForActor!=='function')fail('INTERNAL_TEST_READINESS_CONFIG_INVALID','Internal-test kernel factory is unavailable.');
  const permissionsByRole=new Map();
  for(const [workflow,spec] of Object.entries(INTERNAL_TEST_WORKFLOWS))for(const [role,perms] of Object.entries(spec.roles)){if(!ROLE_KEYS.includes(role))fail('INTERNAL_TEST_READINESS_CONFIG_INVALID',`${workflow} names an unknown role ${role}`);const set=permissionsByRole.get(role)||new Set();for(const p of perms)set.add(p);permissionsByRole.set(role,set);}
  return Object.freeze({
    async read({entityId}={}){
      if(!UUID.test(entityId||''))fail('INTERNAL_TEST_READINESS_SCOPE_INVALID','entityId must be a UUID.');
      const roles={};
      for(const [role,set] of permissionsByRole){
        if(!actors[role]){roles[role]=Object.freeze({permissions:Object.fromEntries([...set].sort().map(p=>[p,false])),ready:false,missing:[...set].sort(),actor_configured:false});continue;}
        const kernel=kernelForActor(actors[role].trim());
        if(!kernel||typeof kernel.readEntityPermissionFlags!=='function')fail('INTERNAL_TEST_READINESS_CONFIG_INVALID','Actor kernel cannot read permission flags.');
        let flags;
        try{flags=await kernel.readEntityPermissionFlags({tenantId,entityId,permissions:[...set].sort()});}
        catch(error){if(error?.code==='42501'){flags=Object.fromEntries([...set].map(p=>[p,false]));}else throw error;}
        const permissions=Object.fromEntries([...set].sort().map(p=>[p,flags[p]===true]));
        roles[role]=Object.freeze({permissions,ready:Object.values(permissions).every(Boolean),missing:Object.keys(permissions).filter(p=>!permissions[p])});
      }
      const reader=kernelForActor(actors.reader.trim());
      if(!reader||typeof reader.readInternalTestMasterDataReadiness!=='function')fail('INTERNAL_TEST_READINESS_CONFIG_INVALID','Reader kernel cannot read master data readiness.');
      const master=await reader.readInternalTestMasterDataReadiness({tenantId,entityId});
      const masterData=Object.fromEntries(INTERNAL_TEST_MASTER_DATA_KEYS.map(key=>[key,master?.[key]===true]));
      const workflows={};
      for(const [workflow,spec] of Object.entries(INTERNAL_TEST_WORKFLOWS)){
        const blocking=[];
        for(const [role,perms] of Object.entries(spec.roles))for(const p of perms)if(!roles[role]?.permissions[p])blocking.push({kind:'GRANT',role,permission:p});
        for(const key of spec.master)if(!masterData[key])blocking.push({kind:'MASTER_DATA',key});
        workflows[workflow]=Object.freeze({ready:blocking.length===0,blocking:Object.freeze(blocking)});
      }
      return Object.freeze({schema_version:'INTERNAL_TEST_WORKFLOW_READINESS_V1',entity_id:entityId,profile:'FULL_WORKFLOW',test_only:true,roles:Object.freeze(roles),master_data:Object.freeze(masterData),workflows:Object.freeze(workflows),grants_widened:false,can_grant:false});
    }
  });
}

export function assertInternalTestWorkflowReadiness(value,{entityId}={}){
  const keys=['schema_version','entity_id','profile','test_only','roles','master_data','workflows','grants_widened','can_grant'];
  if(!value||typeof value!=='object'||Object.keys(value).sort().join('|')!==[...keys].sort().join('|')||value.schema_version!=='INTERNAL_TEST_WORKFLOW_READINESS_V1'||value.entity_id!==entityId||value.profile!=='FULL_WORKFLOW'||value.test_only!==true||value.grants_widened!==false||value.can_grant!==false)throw new Error('INTERNAL_TEST_WORKFLOW_READINESS_INVALID');
  for(const workflow of Object.keys(INTERNAL_TEST_WORKFLOWS))if(!value.workflows[workflow]||typeof value.workflows[workflow].ready!=='boolean'||!Array.isArray(value.workflows[workflow].blocking))throw new Error('INTERNAL_TEST_WORKFLOW_READINESS_INVALID');
  for(const key of INTERNAL_TEST_MASTER_DATA_KEYS)if(typeof value.master_data[key]!=='boolean')throw new Error('INTERNAL_TEST_WORKFLOW_READINESS_INVALID');
  const text=JSON.stringify(value);if(/actor_id|actorId/.test(text))throw new Error('INTERNAL_TEST_WORKFLOW_READINESS_INVALID');
  return value;
}
