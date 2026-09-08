import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Synthetic read-volume data only. The separate 061 scenario proves real
// command/approval/Post behavior. Every occurrence here still has a distinct
// journal, balanced lines and distinct immutable ledger trace with FKs enabled.
export async function seedPaymentCandidateVolume(pool,ids){
  const client=await pool.connect(),billId=randomUUID(),batchId=randomUUID();
  try{
    assert.equal((await client.query('SELECT current_database() name')).rows[0].name,'refs_kernel_gate_test');
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='600000'");
    await client.query(`INSERT INTO business_document(business_document_id,tenant_id,entity_id,document_kind,document_number,counterparty_ref,counterparty_name,currency,accounting_date,gross_amount,open_balance,status,created_by)
      VALUES($1,$2,$3,'AP_BILL','PERF-CANDIDATE-BILL','VENDOR-1','Synthetic volume vendor','USD','2026-07-16',4000040,0,'PAID','fixture')`,[billId,ids.tenantId,ids.entityId]);
    await client.query(`INSERT INTO posting_batch(posting_batch_id,tenant_id,entity_id,period_id,idempotency_key,request_hash,posted_by)
      VALUES($1,$2,$3,$4,'candidate-volume-batch','sha256:'||repeat('a',64),'fixture-poster')`,[batchId,ids.tenantId,ids.entityId,ids.periodId]);
    await client.query(`CREATE TEMP TABLE payment_candidate_volume ON COMMIT DROP AS SELECT n,
      ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid occurrence_id,
      gen_random_uuid() journal_id,gen_random_uuid() cash_line_id,gen_random_uuid() control_line_id
      FROM generate_series(1,100001) n`);
    // Only this generated database and transaction are affected. Restore the
    // exact immutable-line trigger before committing; rollback restores DDL.
    await client.query('ALTER TABLE journal_line DISABLE TRIGGER journal_line_posted_immutable');
    for(let first=1;first<=100001;first+=2000){
      const args=[ids.tenantId,ids.entityId,ids.periodId,first,Math.min(first+1999,100001)];
      await client.query(`INSERT INTO journal_entry(journal_entry_id,tenant_id,entity_id,period_id,journal_number,journal_type,status,journal_date,currency,created_by,reviewed_by,approved_by,posted_by,posted_at,revision)
        SELECT journal_id,$1,$2,$3,'PERF-CANDIDATE-'||n,'MANUAL','POSTED','2026-07-16','USD','fixture-maker','fixture-reviewer','fixture-approver','fixture-poster',now(),4
        FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5`,args);
      await client.query(`INSERT INTO journal_line(journal_line_id,tenant_id,entity_id,period_id,journal_entry_id,line_no,account_code,debit_amount,credit_amount,member_ref)
        SELECT cash_line_id,$1::uuid,$2::uuid,$3::uuid,journal_id,1,'111000',0,40,'BANK-1' FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5
        UNION ALL SELECT control_line_id,$1::uuid,$2::uuid,$3::uuid,journal_id,2,'291001',40,0,'VENDOR-1' FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5`,args);
      await client.query(`INSERT INTO ledger_line(tenant_id,entity_id,period_id,posting_batch_id,journal_entry_id,journal_line_id,account_code,member_ref,currency,debit_amount,credit_amount,posted_at)
        SELECT $1::uuid,$2::uuid,$3::uuid,$6::uuid,journal_id,cash_line_id,'111000','BANK-1','USD',0,40,now() FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5
        UNION ALL SELECT $1::uuid,$2::uuid,$3::uuid,$6::uuid,journal_id,control_line_id,'291001','VENDOR-1','USD',40,0,now() FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5`,[...args,batchId]);
      await client.query(`INSERT INTO payment_occurrence(payment_occurrence_id,tenant_id,entity_id,period_id,business_document_id,occurrence_kind,amount,currency,accounting_date,status,posted_journal_entry_id,idempotency_key,request_hash,created_by,version)
        SELECT occurrence_id,$1,$2,$3,$6,'AP_PAYMENT',40,'USD','2026-07-16','POSTED',journal_id,'perf-candidate-'||n,'sha256:'||repeat('b',64),'fixture',1
        FROM payment_candidate_volume WHERE n BETWEEN $4 AND $5`,[...args,billId]);
    }
    await client.query('ALTER TABLE journal_line ENABLE TRIGGER journal_line_posted_immutable');
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  for(const table of ['payment_occurrence','journal_entry','journal_line','ledger_line'])await pool.query(`ANALYZE ${table}`);
  return {billId,batchId};
}
