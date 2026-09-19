// N08: the sales-receipt clearance branch is orphaned at chain head.
//
// Chain of custody for refs_set_reconciliation_clearance:
//   385  renames the then-current body to _385 and adds a thin wrapper that calls it.
//   400  CREATE OR REPLACE on the _385 *body*, teaching it EXACT_POSTED_SALES_RECEIPT
//        alongside EXACT_POSTED_PAYMENT. At this point clearance accepts both.
//   403  CREATE OR REPLACE on the *wrapper* with a fully inlined body that accepts
//        EXACT_POSTED_PAYMENT only. The wrapper stops delegating, so 400's sales-receipt
//        branch becomes unreachable.
//   418  renames 403's body to _418 and re-wraps it. The orphan survives.
//
// Meanwhile the sign-off validator installed by 400 still accepts
// EXACT_POSTED_SALES_RECEIPT evidence, and sign-off requires total_items = cleared_items.
// So a bank line matched by 321 to a sales receipt can be matched and would satisfy
// sign-off's evidence rule, but can never be cleared -- which means that reconciliation
// can never be signed off at all.
//
// This file pins the inconsistency rather than asserting the system is correct. It is a
// gap pin in the style of ap-lifecycle R03-5: if someone repairs the orphan (or removes
// the sales-receipt match path), these assertions fail and force a deliberate update.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const sql=name=>readFileSync(new URL(`../db/migrations/${name}`,import.meta.url),'utf8');
const M321='321_sales_receipt_bank_match.sql';
const M400='400_sales_receipt_reconciliation_evidence.sql';
const M403='403_reconciliation_clearance_lock_fix.sql';
const M418='418_reconciliation_actor_binding_regression_fix.sql';

test('N08-1: 321 creates sales-receipt bank matches that 400 taught clearance and sign-off to accept',()=>{
  const m321=sql(M321),m400=sql(M400);
  assert.match(m321,/EXACT_POSTED_SALES_RECEIPT/,'321 must still mint EXACT_POSTED_SALES_RECEIPT matches');
  assert.match(m321,/CREATE\s+(OR REPLACE\s+)?FUNCTION\s+refs_create_sales_receipt_bank_match/,'321 must still define the sales-receipt matcher');

  // 400 taught BOTH surfaces about sales receipts.
  const clearanceBody=m400.slice(m400.indexOf('refs_set_reconciliation_clearance_385'),m400.indexOf('refs_transition_reconciliation_adjustment_aware_385'));
  assert.match(clearanceBody,/EXACT_POSTED_SALES_RECEIPT/,'400 clearance body must accept sales-receipt evidence');
  const signoffBody=m400.slice(m400.indexOf('refs_transition_reconciliation_adjustment_aware_385'));
  assert.match(signoffBody,/EXACT_POSTED_SALES_RECEIPT/,'400 sign-off validator must accept sales-receipt evidence');
});

test('N08-2: 403 replaced the clearance wrapper with an inlined EXACT_POSTED_PAYMENT-only body, orphaning 400 clearance branch',()=>{
  const m403=sql(M403);
  assert.match(m403,/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+refs_set_reconciliation_clearance\s*\(/,'403 must replace the clearance entry point');
  assert.doesNotMatch(m403,/refs_set_reconciliation_clearance_385/,'403 no longer delegates to the 400 body -- this is what orphans it');
  assert.equal((m403.match(/EXACT_POSTED_SALES_RECEIPT/g)||[]).length,0,
    'GAP PIN: 403 inlined clearance accepts no sales-receipt evidence. If this now matches, the orphan was repaired -- update this pin deliberately.');
  assert.match(m403,/m\.candidate_rule_code='EXACT_POSTED_PAYMENT'/,'403 clearance admits EXACT_POSTED_PAYMENT only');
  assert.match(m403,/Only exact actively matched bank evidence can be cleared/,'403 refusal message is the observable symptom');
});

test('N08-3: 418 re-wraps the 403 body, so the head clearance path still cannot clear a sales receipt',()=>{
  const m418=sql(M418);
  assert.match(m418,/RENAME TO refs_set_reconciliation_clearance_418/,'418 renames the 403 body');
  assert.match(m418,/RETURN refs_set_reconciliation_clearance_418\(/,'418 wrapper delegates to the 403 body, not to _385');
  assert.doesNotMatch(m418,/refs_set_reconciliation_clearance_385/,'418 does not restore the 400 body');
  assert.equal((m418.match(/EXACT_POSTED_SALES_RECEIPT/g)||[]).length,0,'418 adds no sales-receipt clearance support');
});

test('N08-4: no migration after 403 restores sales-receipt clearance, and sign-off still demands every item be cleared',()=>{
  // Only 321 and 400 mention the rule code anywhere in the chain.
  const dir=new URL('../db/migrations/',import.meta.url);
  const mentioning=readdirSync(dir).filter(f=>f.endsWith('.sql')&&sql(f).includes('EXACT_POSTED_SALES_RECEIPT')).sort();
  assert.deepEqual(mentioning,[M321,M400],
    `GAP PIN: exactly two migrations mention EXACT_POSTED_SALES_RECEIPT (the matcher and the orphaned 400 body). Found: ${mentioning.join(', ')}`);

  // Sign-off cannot complete while any scoped bank item is uncleared, so an uncleanable
  // sales-receipt line blocks the whole reconciliation, not just that row.
  assert.match(sql(M400),/total_items<>cleared_items/,'sign-off must still require every item cleared');
});
