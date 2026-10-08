import test from 'node:test';
import assert from 'node:assert/strict';
import {reconciliationWorksheetPage} from '../src/reconciliation-worksheet-presentation.js';

const rows=Object.freeze(Array.from({length:1261},(_,index)=>Object.freeze({bank_source_id:`source-${index}`,external_bank_line_id:`BANK-${index}`,transaction_date:'2026-06-30',amount:'-1.0000',currency:'USD',match_status:index%2===0?'ACTIVE':null,clearance_state:index%3===0?'CLEARED':'NOT_CLEARED',journal_entry_id:index%2===0?`journal-${index}`:null})));

test('1261-row worksheet has bounded first, next and final pages without mutating exact evidence',()=>{
  const first=reconciliationWorksheetPage(rows),next=reconciliationWorksheetPage(rows,{page:2}),last=reconciliationWorksheetPage(rows,{page:26});
  assert.equal(first.rows.length,50);assert.equal(first.totalRowCount,1261);assert.equal(first.pageCount,26);assert.equal(first.start,1);assert.equal(first.end,50);assert.equal(first.hasPrevious,false);assert.equal(first.hasNext,true);
  assert.equal(next.rows[0],rows[50]);assert.equal(next.start,51);assert.equal(next.end,100);
  assert.equal(last.rows.length,11);assert.equal(last.rows[0],rows[1250]);assert.equal(last.end,1261);assert.equal(last.hasNext,false);
  assert.equal(new Set([...first.rows,...next.rows].map(row=>row.bank_source_id)).size,100);
  assert.equal(rows.length,1261);assert.equal(first.rows[0],rows[0]);
});

test('search covers the whole population and preserves the original row and total count',()=>{
  const found=reconciliationWorksheetPage(rows,{query:'  bAnK-1260  ',page:26});
  assert.equal(found.matchingCount,1);assert.equal(found.totalRowCount,1261);assert.equal(found.page,1);assert.equal(found.rows[0],rows[1260]);
  assert.equal(reconciliationWorksheetPage(rows,{query:'journal-1260'}).rows[0],rows[1260]);
  const none=reconciliationWorksheetPage(rows,{query:'missing-source'});
  assert.equal(none.matchingCount,0);assert.equal(none.totalRowCount,1261);assert.equal(none.start,0);assert.equal(none.end,0);assert.equal(none.pageCount,1);
});

test('match and clearance are independent presentation filters, not accounting transitions',()=>{
  const matched=reconciliationWorksheetPage(rows,{status:'MATCHED'}),unmatched=reconciliationWorksheetPage(rows,{status:'UNMATCHED'}),cleared=reconciliationWorksheetPage(rows,{status:'CLEARED'}),notCleared=reconciliationWorksheetPage(rows,{status:'NOT_CLEARED'});
  assert.equal(matched.matchingCount+unmatched.matchingCount,1261);assert.equal(cleared.matchingCount+notCleared.matchingCount,1261);
  assert.ok(matched.rows.every(row=>row.match_status==='ACTIVE'));assert.ok(unmatched.rows.every(row=>row.match_status!=='ACTIVE'));assert.ok(cleared.rows.every(row=>row.clearance_state==='CLEARED'));
  assert.equal(rows[0].match_status,'ACTIVE');assert.equal(rows[0].clearance_state,'CLEARED');
});

test('page bounds reconcile shrinking populations and invalid presentation selection fails',()=>{
  assert.equal(reconciliationWorksheetPage(rows.slice(0,3),{page:26}).page,1);
  assert.equal(reconciliationWorksheetPage(rows,{page:-2}).page,1);
  assert.equal(reconciliationWorksheetPage(rows,{page:NaN}).page,1);
  assert.throws(()=>reconciliationWorksheetPage(rows,{status:'POST_NOW'}),TypeError);
  assert.throws(()=>reconciliationWorksheetPage(null),TypeError);
});

test('independent posted-adjustment pages retain exact command evidence and revision',()=>{
  const adjustments=Object.freeze(Array.from({length:75},(_,index)=>Object.freeze({...rows[index],match_status:null,adjustment_clearance_eligible:true,adjustment_journal_status:'POSTED',adjustment_journal_entry_id:`adjustment-${index}`,adjustment_journal_version:4})));
  const next=reconciliationWorksheetPage(adjustments,{page:2});
  assert.equal(next.rows.length,25);assert.equal(next.totalRowCount,75);assert.equal(next.rows[0],adjustments[50]);
  assert.equal(next.rows[0].adjustment_journal_entry_id,'adjustment-50');assert.equal(next.rows[0].adjustment_journal_version,4);assert.equal(next.rows[0].adjustment_clearance_eligible,true);
});
