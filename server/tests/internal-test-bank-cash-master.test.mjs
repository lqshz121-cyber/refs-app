import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const upPath=new URL('../db/migrations/419_internal_test_bank_cash_master.sql',import.meta.url);
const downPath=new URL('../db/migrations/down/419_internal_test_bank_cash_master.sql',import.meta.url);
const digest=text=>createHash('sha256').update(text.replace(/\r\n/g,'\n')).digest('hex');

test('internal-test bank/cash master migration is manifest-bound and remains test-only',async()=>{
  const [up,down]=await Promise.all([readFile(upPath,'utf8'),readFile(downPath,'utf8')]);
  const entry=MIGRATION_MANIFEST.find(row=>row.name==='419_internal_test_bank_cash_master.sql');
  assert.ok(entry);
  assert.equal(entry.up,digest(up));
  assert.equal(entry.down,digest(down));
  for(const token of ['refs_ensure_internal_test_bank_cash_master','INTERNAL_TEST_BANK','111990','INTERNAL TEST ONLY Bank Cash','CASH.TRANSFER.CONFIGURE','INTERNAL_TEST_BANK_CASH_MASTER_READY','pg_advisory_xact_lock'])assert.match(up,new RegExp(token.replaceAll('.','\\.')));
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'CASH\.TRANSFER\.CONFIGURE'\)/);
  assert.doesNotMatch(up,/\b(?:raw_event|source_document|wbs_)\b/i);
  assert.match(down,/Cannot roll back internal test bank\/cash master while a controlled mapping references it/);
  assert.match(down,/Cannot roll back internal test bank\/cash master while journal evidence references it/);
});

test('kernel invokes only the fixed database bootstrap command',async()=>{
  const calls=[];
  const kernel=new PostgresAccountingKernel({}, {sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
  kernel.inSession=async work=>work({query:async(text,args)=>{calls.push({text,args});return {rowCount:1,rows:[{result:{bank_member_ref:'INTERNAL_TEST_BANK',cash_account_code:'111990'}}]};}});
  const result=await kernel.ensureInternalTestBankCashMaster({tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',idempotencyKey:'internal-test-bank-cash-master-v1'});
  assert.equal(result.cash_account_code,'111990');
  assert.equal(calls.length,1);
  assert.match(calls[0].text,/refs_ensure_internal_test_bank_cash_master/);
  assert.deepEqual(calls[0].args,['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','internal-test-bank-cash-master-v1']);
});
