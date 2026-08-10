import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('bank and reconciliation reads require exact scope and expose no mutation authority',async()=>{
  const up=await readFile(new URL('../db/migrations/060_bank_reconciliation_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/060_bank_reconciliation_read.sql',import.meta.url),'utf8');
  for(const token of ["'BANK.VIEW'",'refs_assert_scope','b.tenant_id=p_tenant','b.entity_id=p_entity','b.bank_account_ref=p_bank_account_ref','r.tenant_id=p_tenant','r.entity_id=p_entity','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  for(const token of ['p_limit IS NULL','p_bank_account_ref<>btrim','previous.status=\'RECONCILED\'','reconciliation_live_read_scope_idx','reconciliation_reconciled_cutoff_idx','bank_source_read_scope_idx'])assert.match(up,new RegExp(token));
  assert.match(up,/r\.status IN \('DRAFT','IN_REVIEW','REOPENED'\)/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO bank_source|UPDATE bank_source|DELETE FROM bank_source|INSERT INTO bank_match|UPDATE bank_match|DELETE FROM bank_match|INSERT INTO reconciliation|UPDATE reconciliation|DELETE FROM reconciliation|refs_post_journal)\b/i);
  assert.match(down,/DROP FUNCTION refs_list_bank_transactions/);
  assert.match(down,/DROP FUNCTION refs_get_reconciliation_summary/);
  assert.doesNotMatch(down,/DELETE FROM permission_catalog/i);
  assert.match(down,/UPDATE permission_catalog[\s\S]*active=false[\s\S]*effective_to=COALESCE/i);
  for(const index of ['reconciliation_live_read_scope_idx','reconciliation_reconciled_cutoff_idx','bank_source_read_scope_idx'])assert.match(down,new RegExp(`DROP INDEX ${index}`));

  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  assert.deepEqual(await kernel.listBankTransactions({tenantId:'tenant',entityId:'entity',bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:25}),[]);
  assert.deepEqual(await kernel.getReconciliationSummary({tenantId:'tenant',entityId:'entity',bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'}),[]);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[0].args,['tenant','entity','BANK-1','2026-07-01','2026-07-31',25]);
  assert.deepEqual(calls[1].args,['tenant','entity','BANK-1','2026-07-31']);
  assert.ok(calls.every(call=>/^SELECT \* FROM refs_(?:list_bank_transactions|get_reconciliation_summary)/.test(call.sql)));
});

test('Bank Match candidates are a high-risk scoped read of exact POSTED cash evidence only',async()=>{
  const up=await readFile(new URL('../db/migrations/065_bank_match_candidate_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/065_bank_match_candidate_read.sql',import.meta.url),'utf8');
  for(const token of ["'BANK.MATCH.CREATE'",'refs_assert_scope','po.status=\'POSTED\'','po.currency=bank_row.currency','bank_row.amount=-po.amount','bank_row.amount=po.amount','active_match.status=\'ACTIVE\'','AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL','FOR SHARE','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.match(up,/abs\(bank_row\.transaction_date-po\.accounting_date\)<=31/);
  const executable=up.replace(/--.*$/gm,'');
  assert.doesNotMatch(executable,/\b(?:INSERT INTO|UPDATE |DELETE FROM|refs_create_bank_payment_match|refs_unmatch_bank_payment|refs_post_journal)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_list_bank_match_candidates/);
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);
  kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  assert.deepEqual(await kernel.listBankMatchCandidates({tenantId:'tenant',entityId:'entity',bankSourceId:'bank-source'}),[]);
  assert.deepEqual(calls[0].args,['tenant','entity','bank-source']);
  assert.match(calls[0].sql,/^SELECT \* FROM refs_list_bank_match_candidates/);
});
