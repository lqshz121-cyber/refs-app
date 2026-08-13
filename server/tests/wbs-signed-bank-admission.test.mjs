import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';
import {validateWbsSignedBankAdmission} from '../runtime/wbs-signed-bank-admission.mjs';

const ids={tenantId:'10000000-0000-4000-8000-000000000001',entityId:'20000000-0000-4000-8000-000000000002',snapshotId:'30000000-0000-4000-8000-000000000003'};
const hash=char=>`sha256:${char.repeat(64)}`;
function fixture(overrides={}){
  const value={schema_version:'WBS_SIGNED_BANK_ADMISSION_V1',environment:'PRODUCTION',source_system:'WBS',admission_status:'ADMITTED',snapshot_id:ids.snapshotId,package_hash:hash('a'),source_entity_id:'ENTITY-1',statement:{statement_id:'STMT-2026-07',bank_account_ref:'BANK-1',statement_start_date:'2026-07-01',statement_end_date:'2026-07-31',currency:'USD',opening_balance:'100.0000',ending_balance:'125.0000',payload_hash:hash('b'),payload_ref:'object://wbs-bank-statements/STMT-2026-07'},transactions:[{source_record_id:'BANK-TXN-1',source_version:`snapshot:${ids.snapshotId}:0123456789abcdef`,external_bank_line_id:'EXT-1',payload_hash:hash('c'),payload_ref:`object://wbs-snapshot/${ids.snapshotId}/BGDATA.bank_transaction/BANK-TXN-1`,transaction_date:'2026-07-15',currency:'USD',bank_account_ref:'BANK-1',amount:'25.0000'}],detached_signature:{key_id:'wbs-prod-2026',algorithm:'Ed25519',value:'signed-value'},...overrides};
  value.admission_hash=canonicalRequestHash(Object.fromEntries(Object.entries(value).filter(([key])=>!['admission_hash','detached_signature'].includes(key))));
  return value;
}

test('signed bank admission freezes a production statement and exact transaction scope',()=>{
  const value=validateWbsSignedBankAdmission(fixture());
  assert.equal(value.admission_status,'ADMITTED');
  assert.equal(value.statement.bank_account_ref,'BANK-1');
  assert.equal(value.transactions.length,1);
  assert.ok(Object.isFrozen(value.transactions));
});

test('unsigned pilot, tampered, cross-account, and zero-value observations cannot be admitted',()=>{
  for(const invalid of [
    fixture({environment:'UNSIGNED_PILOT'}),
    {...fixture(),admission_hash:hash('f')},
    fixture({transactions:[{...fixture().transactions[0],bank_account_ref:'BANK-2'}]}),
    fixture({transactions:[{...fixture().transactions[0],amount:'0.0000'}]})
  ])assert.throws(()=>validateWbsSignedBankAdmission(invalid));
  assert.throws(()=>validateWbsSignedBankAdmission(fixture({actorId:'forged'})),error=>error.code==='WBS_BANK_ADMISSION_INVALID');
  assert.throws(()=>validateWbsSignedBankAdmission(fixture({transactions:[{...fixture().transactions[0],unexpected:'raw'}]})),error=>error.code==='WBS_BANK_TRANSACTION_INVALID');
});

test('signed bank admission evaluates the four-decimal amount as fixed point',()=>{
  const tiny=fixture({transactions:[{...fixture().transactions[0],amount:'0.0001'}]});
  assert.equal(validateWbsSignedBankAdmission(tiny).transactions[0].amount,'0.0001');
  const negativeZero=fixture({transactions:[{...fixture().transactions[0],amount:'-0.0000'}]});
  assert.throws(()=>validateWbsSignedBankAdmission(negativeZero),error=>error.code==='WBS_BANK_TRANSACTION_INVALID');
});

test('kernel verifies detached signature before any database session or persistence',async()=>{
  let sessions=0;
  const kernel=new PostgresAccountingKernel({}, {sessionProvider:async()=>{sessions++;throw new Error('must not reach DB');},wbsSignedBankAdmissionVerifier:async()=>false});
  await assert.rejects(kernel.admitWbsSignedBankStatement({tenantId:ids.tenantId,entityId:ids.entityId,admission:fixture(),idempotencyKey:'signed-bank-admission-0001'}),error=>error.code==='WBS_BANK_ADMISSION_SIGNATURE_INVALID');
  assert.equal(sessions,0);
});
