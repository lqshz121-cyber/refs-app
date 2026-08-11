import {canonicalRequestHash} from './request-hash.mjs';
import {createWbsManifestSignatureVerifier} from './wbs-snapshot-signature.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const STATES=new Set(['NOT_MATCHED','RELEASED','INCURRED']);
const OPERATIONS=new Set(['CANCEL_RELEASE','CANCEL_INCUR','REOPEN']);
const text=(value,max=256)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const instant=value=>text(value,64)&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)&&Number.isFinite(Date.parse(value));
const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const safeName=value=>text(value,128)&&/^[A-Z][A-Z0-9_:-]*$/.test(value);
const uniqueSorted=(items,valid)=>Array.isArray(items)&&items.length>0&&items.every(valid)&&new Set(items).size===items.length&&items.every((item,index)=>index===0||items[index-1]<item);
const freeze=value=>Object.freeze(value);

export class WbsAutoRecTransitionContractError extends Error {
  constructor(code,message){super(message);this.name='WbsAutoRecTransitionContractError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsAutoRecTransitionContractError(code,message);};

function transition(value){
  if(!object(value)||!safeName(value.transition_id)||!OPERATIONS.has(value.operation)||!STATES.has(value.from_state)||!STATES.has(value.to_state)||value.from_state===value.to_state)fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','Each provider transition needs one known operation and two distinct WBS states.');
  if(value.requires_reason!==true||!uniqueSorted(value.required_actor_roles,item=>safeName(item)))fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','Each provider transition needs a reason and explicit sorted actor roles.');
  const sod=value.segregation_of_duties;
  if(!object(sod)||typeof sod.review_required!=='boolean'||typeof sod.requester_reviewer_must_differ!=='boolean'||!uniqueSorted(sod.forbidden_prior_actor_roles,item=>safeName(item)))fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','Each provider transition needs explicit review and separation-of-duties rules.');
  const accounting=value.accounting_guard;
  if(!object(accounting)||typeof accounting.blocks_when_accounting_reviewed!=='boolean'||typeof accounting.blocks_when_accounting_approved!=='boolean'||typeof accounting.blocks_when_accounting_posted!=='boolean')fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','Each provider transition needs explicit accounting-review, approval, and posting guards.');
  return freeze({transition_id:value.transition_id,operation:value.operation,from_state:value.from_state,to_state:value.to_state,requires_reason:true,required_actor_roles:freeze([...value.required_actor_roles]),segregation_of_duties:freeze({...sod,forbidden_prior_actor_roles:freeze([...sod.forbidden_prior_actor_roles])}),accounting_guard:freeze({...accounting})});
}

// This validates a WBS-owned declaration. It never turns a WBS action or a
// displayed status into a REFS command: REFS still uses its own CAS/SoD/JE
// workflow and can consume the contract only as signed external evidence.
export function validateWbsAutoRecTransitionContract(contract){
  if(!object(contract)||contract.schema_version!=='WBS_AUTOREC_TRANSITION_CONTRACT_V1'||contract.source_system!=='WBS'||contract.environment!=='PRODUCTION'||!UUID.test(contract.contract_id||'')||!instant(contract.issued_at)||!instant(contract.valid_from)||!instant(contract.valid_until)||Date.parse(contract.valid_from)>Date.parse(contract.valid_until))fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','WBS AutoRec transition contract identity or validity interval is invalid.');
  if(!object(contract.scope)||!uniqueSorted(contract.scope.company_keys,item=>text(item,128))||!text(contract.scope.dictionary_version,128))fail('WBS_AUTOREC_TRANSITION_CONTRACT_SCOPE_INVALID','A WBS transition contract needs an exact company scope and dictionary version.');
  if(!Array.isArray(contract.transitions)||contract.transitions.length===0)fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','A WBS transition contract needs at least one transition.');
  const transitions=contract.transitions.map(transition),ids=transitions.map(item=>item.transition_id);
  if(new Set(ids).size!==ids.length)fail('WBS_AUTOREC_TRANSITION_CONTRACT_INVALID','WBS transition identifiers must be unique.');
  const signature=contract.detached_signature;
  if(!object(signature)||!text(signature.key_id,128)||signature.algorithm!=='Ed25519'||!text(signature.value,4096))fail('WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_REQUIRED','A production WBS transition contract needs an Ed25519 detached signature.');
  const expected=canonicalRequestHash(without(contract,'contract_hash','detached_signature'));
  if(contract.contract_hash!==expected)fail('WBS_AUTOREC_TRANSITION_CONTRACT_HASH_MISMATCH','WBS transition contract hash does not match its declared content.');
  return freeze({contract_id:contract.contract_id,contract_hash:contract.contract_hash,issued_at:contract.issued_at,valid_from:contract.valid_from,valid_until:contract.valid_until,scope:freeze({company_keys:freeze([...contract.scope.company_keys]),dictionary_version:contract.scope.dictionary_version}),transitions:freeze(transitions),signature:freeze({key_id:signature.key_id,algorithm:signature.algorithm}),transition_authority:'WBS_SIGNED_EXTERNAL_EVIDENCE_ONLY',can_transition_refs:false,can_release:false,can_incur:false,can_reverse:false,can_create_draft:false,can_post:false});
}

export function createWbsAutoRecTransitionContractVerifier({publicKeys}={}){
  const verify=createWbsManifestSignatureVerifier({publicKeys});
  return async contract=>{
    const validated=validateWbsAutoRecTransitionContract(contract);
    const signatureValid=await verify({manifest_hash:contract.contract_hash,detached_signature:contract.detached_signature});
    if(!signatureValid)fail('WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_INVALID','WBS transition contract signature does not match a pinned provider key.');
    return freeze({...validated,signature_verified:true});
  };
}
