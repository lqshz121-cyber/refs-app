import assert from 'node:assert/strict';
import { localAgingGlTbBridgeEvidence } from './src/aging-local-evidence.js';

const apJournal = {je_number:'AP-1',je_date:'2026-07-31',entity_id:2,posting_status:'POSTED',source_system:'BILL',lines:[{account_code:'291001',credit_amount:100,debit_amount:0,property_id:11,project_id:21}]};
const arJournal = {je_number:'AR-1',je_date:'2026-07-31',entity_id:2,posting_status:'POSTED',source_system:'INVOICE',lines:[{account_code:'120200',debit_amount:200,credit_amount:0,property_id:11,project_id:21}]};
const manual = {je_number:'MAN-1',je_date:'2026-07-31',entity_id:2,posting_status:'POSTED',source_system:'MANUAL',lines:[{account_code:'120200',debit_amount:50,credit_amount:0,property_id:11,project_id:21}]};
const apRow = {included:true,outstanding_amount:100,dimensions:{property_ids:[11],project_ids:[21]},evidence:{apJournal}};
const arRow = {included:true,outstanding_amount:200,dimensions:{property_ids:[11],project_ids:[21]},evidence:{sourceJournal:arJournal}};
const otherEntityRow = {included:true,outstanding_amount:900,dimensions:{property_ids:[11],project_ids:[21]},evidence:{sourceJournal:{...arJournal,je_number:'AR-X',entity_id:3}}};
const result = localAgingGlTbBridgeEvidence({apRows:[apRow],arRows:[arRow,otherEntityRow],journals:[apJournal,arJournal,manual],entityId:2,asOfDate:'2026-07-31',propertyId:'11',projectId:'21'});
assert.equal(result.state,'LOCAL_GL_TB_AGING_REVIEW');
assert.equal(result.ap.reconciliation.detailTotal,100);
assert.equal(result.ar.reconciliation.detailTotal,200);
assert.equal(result.issues.some(row=>row.reportType==='AR' && row.category==='POSTED_CONTROL_UNMODELED' && row.journal?.je_number==='MAN-1'),true);
assert.equal(result.ar.reconciliation.postedControlTotal,250);
console.log('aging GL/TB bridge evidence: same-scope AP/AR controls retain only local review drills');
