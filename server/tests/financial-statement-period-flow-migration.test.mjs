import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='458_financial_statement_period_flow_lineage.sql';
const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
const legacy=await readFile(new URL('../db/migrations/062_financial_statement_read.sql',import.meta.url),'utf8');

test('period-flow migration preserves registered checksums and exactly restores the legacy function',()=>{
  const entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  for(const [direction,sql] of [['up',up],['down',down]])assert.equal(createHash('sha256').update(sql).digest('hex'),entry[direction]);
  const start=legacy.indexOf('CREATE FUNCTION refs_get_financial_statements(');
  const end=legacy.indexOf('\nREVOKE ALL ON FUNCTION',start);
  assert.equal(down.replace(/\r\n/g,'\n').trim(),'BEGIN;\n\n'+legacy.slice(start,end).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace(/\r\n/g,'\n')+'\nCOMMIT;');
  assert.doesNotMatch(up,/DROP FUNCTION|ALTER TABLE|UPDATE |INSERT INTO|DELETE FROM/i);
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'GL.REPORT.VIEW'\)/);
});

test('period-flow migration distinguishes all four trace sets without changing monetary expressions',()=>{
  for(const id of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.ok(up.includes("CASE WHEN r.statement_type IN ('INCOME_STATEMENT','CASH_FLOW') THEN r.period_"+id+' ELSE r.'+id+' END'));
  assert.equal((up.match(/FILTER \(WHERE l\.journal_date BETWEEN p\.starts_on AND p\.ends_on\),'\{\}'::uuid\[\]\)/g)||[]).length,3);
  assert.match(up,/s\.journal_entry_id=ANY\(a\.period_journal_entry_ids\)/);
  assert.match(up,/WHEN 'INCOME_STATEMENT' THEN CASE WHEN r.account_class='REVENUE' THEN r.period_credit-r.period_debit ELSE r.period_debit-r.period_credit END/);
  assert.match(up,/WHEN 'TRIAL_BALANCE' THEN r.ending_debit-r.ending_credit/);
});
