import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createWbsAutoRecTransitionContractVerifier,validateWbsAutoRecTransitionContract,WbsAutoRecTransitionContractError} from '../runtime/wbs-autorec-transition-contract.mjs';

const without=(value,...keys)=>Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));
const make=()=>({schema_version:'WBS_AUTOREC_TRANSITION_CONTRACT_V1',source_system:'WBS',environment:'PRODUCTION',contract_id:'11111111-1111-4111-8111-111111111111',issued_at:'2026-08-11T00:00:00Z',valid_from:'2026-08-11T00:00:00Z',valid_until:'2027-08-11T00:00:00Z',scope:{company_keys:['COMPANY-A'],dictionary_version:'WBS-DICT-2026-08'},transitions:[{transition_id:'CANCEL_RELEASE_V1',operation:'CANCEL_RELEASE',from_state:'RELEASED',to_state:'NOT_MATCHED',requires_reason:true,required_actor_roles:['AUTOREC_CONTROLLER'],segregation_of_duties:{review_required:true,requester_reviewer_must_differ:true,forbidden_prior_actor_roles:['INCURRENCE_APPROVER']},accounting_guard:{blocks_when_accounting_reviewed:true,blocks_when_accounting_approved:true,blocks_when_accounting_posted:true}}]});
const signed=pair=>{const value=make();value.contract_hash=canonicalRequestHash(without(value,'contract_hash','detached_signature'));value.detached_signature={key_id:'wbs-transition-2026-08',algorithm:'Ed25519',value:sign(null,Buffer.from(value.contract_hash),pair.privateKey).toString('base64')};return value;};

test('a signed WBS cancellation contract is exact external evidence and never grants REFS commands',async()=>{
  const pair=generateKeyPairSync('ed25519'),contract=signed(pair),verify=createWbsAutoRecTransitionContractVerifier({publicKeys:{'wbs-transition-2026-08':pair.publicKey.export({type:'spki',format:'pem'})}});
  const result=await verify(contract);
  assert.equal(result.signature_verified,true);assert.equal(result.transitions[0].accounting_guard.blocks_when_accounting_posted,true);assert.equal(result.can_transition_refs,false);assert.equal(result.can_post,false);
});

test('transition contracts reject tampered hashes, unpinned signatures, and incomplete SoD/accounting controls',async()=>{
  const pair=generateKeyPairSync('ed25519'),contract=signed(pair),verify=createWbsAutoRecTransitionContractVerifier({publicKeys:{'wbs-transition-2026-08':pair.publicKey.export({type:'spki',format:'pem'})}});
  const tampered=structuredClone(contract);tampered.transitions[0].to_state='INCURRED';assert.throws(()=>validateWbsAutoRecTransitionContract(tampered),error=>error instanceof WbsAutoRecTransitionContractError&&error.code==='WBS_AUTOREC_TRANSITION_CONTRACT_HASH_MISMATCH');
  const unsigned=structuredClone(contract);delete unsigned.transitions[0].accounting_guard.blocks_when_accounting_posted;unsigned.contract_hash=canonicalRequestHash(without(unsigned,'contract_hash','detached_signature'));assert.throws(()=>validateWbsAutoRecTransitionContract(unsigned),error=>error instanceof WbsAutoRecTransitionContractError&&error.code==='WBS_AUTOREC_TRANSITION_CONTRACT_INVALID');
  const unknown=structuredClone(contract);unknown.detached_signature.key_id='unknown';await assert.rejects(()=>verify(unknown),error=>error instanceof WbsAutoRecTransitionContractError&&error.code==='WBS_AUTOREC_TRANSITION_CONTRACT_SIGNATURE_INVALID');
});
