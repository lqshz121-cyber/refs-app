import assert from 'node:assert/strict';
import test from 'node:test';
import {validCustomReport,validCustomReportRequest} from '../runtime/custom-report-contract.mjs';
import {validReportSavedViewInput} from '../runtime/report-saved-view-contract.mjs';

const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',ledgerId='44444444-4444-4444-8444-444444444444',journalId='55555555-5555-4555-8555-555555555555',lineId='66666666-6666-4666-8666-666666666666',sourceId='77777777-7777-4777-8777-777777777777';
const hash=`sha256:${'a'.repeat(64)}`;
const request={reportType:'DIMENSION_PNL',periodId,dimensionType:'PROJECT',dimensionRef:'P-001',limit:100,afterAccountCode:null};
const row={account_code:'5000',account_name:'Cost',statement_section:'EXPENSES',display_balance:'10.0000',budget_amount:null,actual_amount:null,variance_amount:null,journal_entry_ids:[journalId],journal_line_ids:[lineId],ledger_line_ids:[ledgerId],source_document_ids:[sourceId],row_hash:hash};
const report={schema_version:'CUSTOM_REPORT_V1',report_type:'DIMENSION_PNL',tenant_id:tenantId,entity_id:entityId,period_id:periodId,dimension_type:'PROJECT',dimension_ref:'P-001',limit:100,after_account_code:null,next_after_account_code:null,population_source:'POSTED_LEDGER',approved_snapshot_hash:null,ledger_evidence_hash:hash,rows:[row],action_flags:{can_create_draft:false,can_review:false,can_approve:false,can_post:false}};

test('custom report contract accepts only bounded allowlisted projections',()=>{
  assert.equal(validCustomReportRequest(request),true);
  assert.equal(validCustomReport(report),true);
  for(const invalid of [
    {...request,reportType:'SQL'},
    {...request,reportType:'DIMENSION_PNL',dimensionType:null,dimensionRef:null},
    {...request,reportType:'TRIAL_BALANCE',dimensionType:'PROJECT',dimensionRef:'P-001'},
    {...request,limit:201},
    {...request,afterAccountCode:'5000; DROP TABLE ledger_line'}
  ])assert.equal(validCustomReportRequest(invalid),false);
  assert.equal(validCustomReport({...report,action_flags:{can_create_draft:true,can_review:false,can_approve:false,can_post:false}}),false);
  assert.equal(validCustomReport({...report,rows:[{...row,row_hash:'sha256:bad'}]}),false);
  const saved={name:'Project P&L',reportType:'DIMENSION_PNL',periodId,filters:{dimensionType:'PROJECT',dimensionRef:'P-001'},visibility:'ENTITY_SHARED',reason:'Retain the exact project reporting selection.'};
  assert.equal(validReportSavedViewInput(saved),true);
  assert.equal(validReportSavedViewInput({...saved,filters:{dimensionType:'PROJECT'}}),false);
  assert.equal(validReportSavedViewInput({...saved,reportType:'TRIAL_BALANCE'}),false);
});
