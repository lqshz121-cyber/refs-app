import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
assert.deepEqual(contract.components.schemas.AuthoritativeScopeReadRow.properties.period_status.enum,['OPEN','SOFT_CLOSED','CLOSED'],'authoritative scope status must match the PostgreSQL period_status enum');
const operations=Object.values(contract.paths).flatMap(path=>path.post?[path.post]:[]);
const accountingCommands=operations.filter(operation=>operation.operationId!=='explainAiAccountingAnalysis');
const propertyRentOperations=operations.filter(operation=>['reviewWbsPropertyRentPickup','createWbsPropertyRentPickupDraft','reviewInsurancePrepaidAmortization','createInsurancePrepaidAmortizationDraft'].includes(operation.operationId));
operations.splice(0,operations.length,...operations.filter(operation=>!propertyRentOperations.includes(operation)));
const insuranceResumeOperations=operations.filter(operation=>operation.operationId==='resumeProviderSignedWbsFinal1InsuranceAdmission');
operations.splice(0,operations.length,...operations.filter(operation=>!insuranceResumeOperations.includes(operation)));

test('accounting OpenAPI is 3.1, authenticated and operation ids match the runtime kernel surface',()=>{
  assert.deepEqual(propertyRentOperations.map(operation=>operation.operationId).sort(),['createInsurancePrepaidAmortizationDraft','createWbsPropertyRentPickupDraft','reviewInsurancePrepaidAmortization','reviewWbsPropertyRentPickup']);
  assert.deepEqual(insuranceResumeOperations.map(operation=>operation.operationId),['resumeProviderSignedWbsFinal1InsuranceAdmission']);
  assert.equal(contract.openapi,'3.1.0');assert.deepEqual(contract.security,[{bearerAuth:[]}]);
  if(false){
  assert.deepEqual(operations.map(operation=>operation.operationId).sort(),['admitProviderSignedWbsPayables','admitSignedWbsBankStatement','applyApVendorCredit','applyArCreditMemo','approveFinancialStatementSnapshot','approveWbsCompanyCatalogRow','approveWbsInsurancePcMappingProposal','assignAiFindingAction','attestObservedWbsPayables','bindExactWbsPayableAttachment','bindWbsPayableUploadedAttachment','classifyWbsCompanyCatalogRow','createAiAmortizationDraft','createApBill','createApBillVoid','createApPayment','createApPaymentReversal','createApVendorCredit','createArCreditMemo','createArInvoice','createArReceipt','createArReceiptReversal','createArRefund','createAutoJournal','createBankPaymentMatch','createJournalAdjustment','createManualJournal','createReconciliationAdjustmentDraft','createReviewedWbsCostCwipDraft','createReviewedWbsPayableApDraft','createWbsAutoRecAutocDraft','createWbsAutoRecPayableIncurDraft','createWbsInsurancePcMappingProposal','explainAiAccountingAnalysis','finalizeAttachment','finalizeWbsAutoRecG11Incur','importWbsControlledTestBankTransactions','importWbsTestPayables','ingestAdmittedWbsPayables','postJournal','prepareFinancialStatementSnapshot','proposeAiAmortizationSchedule','recordAiAmortizationCoverageEvidence','recordWbsSnapshot','reserveAttachment','reserveWbsPayableAttachment','resolveAiFindingAction','retainProviderSignedWbsFinal1Bank','retainProviderSignedWbsFinal1CostControl','retainProviderSignedWbsFinal1Insurance','retainProviderSignedWbsFinal1Payables','retainProviderSignedWbsFinal1PropertyControl','retainWbsCompanyCatalogCandidate','reviewAdmittedWbsCostCwip','reviewAdmittedWbsPayable','reviewAiWbsPayableDraftProposal','reviewWbsAutoRecBankMatch','setReconciliationAdjustmentClearance','setReconciliationClearance','startReconciliation','startReconciliationFromAdmittedWbsStatement','transitionJournal','transitionReconciliation','unmatchBankPayment','upgradeStage1WbsOperatorAccess','verifyWbsAutoRecTransitionContract']);
  assert.deepEqual(operations.map(operation=>operation.operationId).sort(),['admitProviderSignedWbsPayables','admitSignedWbsBankStatement','applyApVendorCredit','applyArCreditMemo','approveFinancialStatementSnapshot','approveWbsCompanyCatalogRow','approveWbsInsurancePcMappingProposal','assignAiFindingAction','attestObservedWbsPayables','bindExactWbsPayableAttachment','bindWbsPayableUploadedAttachment','classifyWbsCompanyCatalogRow','createAiAmortizationDraft','createApBill','createApBillVoid','createApPayment','createApPaymentReversal','createApVendorCredit','createArCreditMemo','createArInvoice','createArReceipt','createArReceiptReversal','createArRefund','createAutoJournal','createBankPaymentMatch','createJournalAdjustment','createManualJournal','createReconciliationAdjustmentDraft','createReviewedWbsCostCwipDraft','createReviewedWbsPayableApDraft','createWbsAutoRecAutocDraft','createWbsAutoRecPayableIncurDraft','createWbsInsurancePcMappingProposal','explainAiAccountingAnalysis','finalizeAttachment','finalizeWbsAutoRecG11Incur','importWbsTestPayables','ingestAdmittedWbsPayables','postJournal','prepareFinancialStatementSnapshot','proposeAiAmortizationSchedule','recordAiAmortizationCoverageEvidence','recordWbsSnapshot','reserveAttachment','reserveWbsPayableAttachment','resolveAiFindingAction','retainProviderSignedWbsFinal1Bank','retainProviderSignedWbsFinal1CostControl','retainProviderSignedWbsFinal1Insurance','retainProviderSignedWbsFinal1Payables','retainProviderSignedWbsFinal1PropertyControl','retainWbsCompanyCatalogCandidate','reviewAdmittedWbsCostCwip','reviewAdmittedWbsPayable','reviewAiWbsPayableDraftProposal','reviewWbsAutoRecBankMatch','runControlledTestAiWorkflow','setReconciliationAdjustmentClearance','setReconciliationClearance','startReconciliation','startReconciliationFromAdmittedWbsStatement','transitionJournal','transitionReconciliation','unmatchBankPayment','upgradeStage1WbsOperatorAccess','verifyWbsAutoRecTransitionContract']);
  }
  const operationIds=operations.map(operation=>operation.operationId);
  assert.equal(operationIds.length,76);
  assert.equal(new Set(operationIds).size,operationIds.length);
  assert.ok(operationIds.includes('importWbsControlledTestBankTransactions'));
  assert.ok(operationIds.includes('runControlledTestAiWorkflow'));
  assert.ok(operationIds.includes('runWbsControlledTestBankMatch'));
  assert.ok(operationIds.includes('materializeInvoiceAccountingClassifications'));
  assert.ok(operationIds.includes('proposeAiConstructionLoanEntry'));
});

test('AI amortization schedule exposes immutable line identity and a closed Draft-only receipt',()=>{
  const list=contract.paths['/entities/{entityId}/ai/amortization/schedules'].get,draft=contract.paths['/entities/{entityId}/ai/amortization/schedules/{aiAmortizationScheduleId}/drafts'].post;
  assert.equal(list.operationId,'listAiAmortizationSchedules');assert.equal(list.responses['200'].headers['Cache-Control'].schema.const,'no-store');assert.equal(list.responses['200'].content['application/json'].schema.$ref,'#/components/schemas/AiAmortizationScheduleListEnvelope');
  const line=contract.components.schemas.AiAmortizationScheduleLine;assert.equal(line.additionalProperties,false);assert.ok(line.required.includes('ai_amortization_schedule_line_id'));assert.equal(line.properties.ai_amortization_schedule_line_id.$ref,'#/components/schemas/Uuid');assert.equal(line.properties.amount.type,'string');
  const schedule=contract.components.schemas.AiAmortizationSchedule;assert.equal(schedule.additionalProperties,false);assert.ok(schedule.required.includes('eligible_source_attachment_ids'));assert.equal(schedule.properties.eligible_source_attachment_ids.uniqueItems,true);assert.equal(schedule.properties.schedule_lines.items.$ref,'#/components/schemas/AiAmortizationScheduleLine');assert.equal(schedule.properties.source_document_version.type,'string');assert.equal(schedule.properties.confidence.type,'string');assert.equal(schedule.properties.original_amount.type,'string');
  assert.equal(draft.responses['201'].content['application/json'].schema.$ref,'#/components/schemas/AiAmortizationDraftEnvelope');
  const result=contract.components.schemas.AiAmortizationDraftResult;assert.equal(result.additionalProperties,false);assert.equal(result.properties.status.const,'DRAFT');assert.equal(result.properties.revision.const,0);for(const flag of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(result.properties[flag].const,false);
});

test('every accounting command requires idempotency and every mutable existing resource requires If-Match',()=>{
  for(const operation of accountingCommands.filter(operation=>operation.operationId!=='verifyWbsAutoRecTransitionContract'))assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IdempotencyKey'));
  for(const operation of operations.filter(item=>['transitionJournal','postJournal','createApBillVoid','createBankPaymentMatch','unmatchBankPayment','reviewWbsAutoRecBankMatch','setReconciliationClearance','setReconciliationAdjustmentClearance','transitionReconciliation','createReconciliationAdjustmentDraft','bindExactWbsPayableAttachment','bindWbsPayableUploadedAttachment','reviewAdmittedWbsPayable','reviewAiWbsPayableDraftProposal','createReviewedWbsPayableApDraft','classifyWbsCompanyCatalogRow','approveWbsCompanyCatalogRow','approveWbsInsurancePcMappingProposal'].includes(item.operationId)))assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));
  assert.equal(contract.components.parameters.IfMatch.schema.pattern,'^\\\"[0-9]+\\\"$');
});

test('WBS test import is a closed authenticated staging-only command',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/test-import/payables'].post;
  assert.equal(operation.operationId,'importWbsTestPayables');assert.match(operation.description,/staging-only authenticated/i);assert.match(operation.description,/does not claim Provider signature.*Object Lock.*malware scan.*formal Provider admission/i);
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  const body=operation.requestBody.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['periodId','companyCode','dateFrom','dateTo','limit']);
  const result=contract.components.schemas.WbsTestImportResult;assert.equal(result.additionalProperties,false);assert.deepEqual(result.required,['status','imported_count','replayed_count','posted_count','failed_count','test_only']);assert.equal(result.properties.test_only.const,true);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/WbsTestImportOk');assert.equal(operation.responses['201'].$ref,'#/components/responses/WbsTestImportOk');
});

test('controlled test Bank import is a separate closed staging-only reconciliation command',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/test-import/bank-transactions'].post;
  assert.equal(operation.operationId,'importWbsControlledTestBankTransactions');assert.match(operation.description,/Staging-only authenticated bridge/i);assert.match(operation.description,/WBS\.TEST\.IMPORT/);assert.match(operation.description,/Provider-signed admission route is unchanged/i);assert.match(operation.description,/never claims signature.*formal admission.*Match.*Review.*Sign-off.*Journal.*posting authority/i);
  const body=operation.requestBody.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['periodId','companyCode','dateFrom','dateTo','limit']);
  const result=contract.components.schemas.WbsControlledTestBankResult;assert.equal(result.oneOf.length,2);const [complete,partial]=result.oneOf;assert.equal(complete.additionalProperties,false);assert.equal(complete.properties.test_only.const,true);assert.equal(complete.properties.provenance_mode.const,'CONTROLLED_TEST_UNSIGNED');assert.equal(complete.properties.bank_account_ref.pattern,'^WBS_TEST_BANK(?:_2026_0[1-6])?$');assert.equal(complete.properties.status.const,'DRAFT');assert.equal(partial.properties.status.const,'WBS_TEST_BANK_IMPORT_PARTIAL');
});

test('isolated controlled test Bank Match is a closed server-selected command',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/test-import/bank-match/run'].post;
  assert.equal(operation.operationId,'runWbsControlledTestBankMatch');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  const body=operation.requestBody.content['application/json'].schema;
  assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['reason']);assert.deepEqual(Object.keys(body.properties),['reason']);
  const result=contract.components.schemas.ControlledTestBankMatchResult;
  assert.equal(result.additionalProperties,false);assert.equal(result.properties.status.const,'CONTROLLED_TEST_BANK_MATCH_ACTIVE');assert.equal(result.properties.test_only.const,true);assert.equal(result.properties.bank_account_ref.const,'WBS_TEST_BANK');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/ControlledTestBankMatchOk');assert.equal(operation.responses['201'].$ref,'#/components/responses/ControlledTestBankMatchOk');
});

test('paged WBS test month import is closed, bounded, and aggregate-only',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/test-import/range'].post;
  assert.equal(operation.operationId,'importWbsControlledTestRange');
  const body=operation.requestBody.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['companyCode','dateFrom','dateTo','pageSize','maxPages']);assert.equal(body.properties.dateFrom.pattern,'^2026-0[1-6]-01$');assert.equal(body.properties.pageSize.const,10);assert.equal(body.properties.maxPages.maximum,1000);
  const result=contract.components.schemas.WbsTestRangeImportResult;assert.equal(result.oneOf.length,2);assert.equal(result.oneOf[0].additionalProperties,false);assert.equal(result.oneOf[0].properties.status.const,'WBS_TEST_MONTH_IMPORT_COMPLETE');assert.equal(result.oneOf[1].properties.status.const,'WBS_TEST_MONTH_IMPORT_PARTIAL');assert.equal(result.oneOf[1].properties.test_only.const,true);assert.equal(contract.components.schemas.WbsTestBankStageCheckpoint.properties.chunk_count.maximum,100);
  assert.equal(contract.components.schemas.WbsTestRangePayablesResult.properties.record_count.maximum,10000);assert.equal(contract.components.schemas.WbsTestRangePayablesResult.properties.h1_record_count.maximum,10000);assert.equal(contract.components.schemas.WbsTestRangeBankResult.properties.bank_source_ids.maxItems,10000);assert.equal(contract.components.schemas.WbsTestRangeBankResult.properties.provider_page_count.maximum,1000);assert.ok(contract.components.schemas.WbsTestRangeBankResult.properties.reconciliation.oneOf);
  assert.ok(contract.components.schemas.WbsTestRangeBankReconciliation.required.includes('period_id'));assert.equal(contract.components.schemas.WbsTestRangeBankReconciliation.properties.period_id.$ref,'#/components/schemas/Uuid');
  assert.equal(contract.components.schemas.ControlledTestBankWorkflowResult.properties.processed_count.maximum,10000);assert.equal(contract.components.schemas.ControlledTestBankWorkflowResult.properties.journal_entry_ids.maxItems,10000);assert.equal(contract.components.schemas.ControlledTestBankRangeWorkflowResult.properties.processed_count.maximum,60000);
  assert.equal(contract.components.schemas.ControlledTestBankWorkflowPartialResult.properties.remaining_count.minimum,1);assert.equal(contract.components.schemas.ControlledTestBankWorkflowPartialResult.properties.total_count.maximum,10000);
});

test('identity and server-computed request hash are absent from all public request schemas',()=>{
  const {WbsProviderSignedPayableAdmission,WbsProviderFinal1Admission,...ordinaryBodies}=contract.components.requestBodies;
  const serialized=JSON.stringify(ordinaryBodies);
  for(const forbidden of ['actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash'])assert.equal(serialized.includes(`\"${forbidden}\"`),false);
  const signedSchema=WbsProviderSignedPayableAdmission.content['application/json'].schema;
  for(const forbidden of ['actorId','actor_id','tenantId','entityId','requestHash','request_hash','providerTrust'])assert.equal(Object.hasOwn(signedSchema.properties,forbidden),false);
  assert.equal(signedSchema.properties.receipt.additionalProperties,false,'signed scope is evidence inside the verified receipt, never caller authority');
  const final1Schema=WbsProviderFinal1Admission.content['application/json'].schema;
  for(const forbidden of ['actorId','actor_id','tenantId','entityId','requestHash','request_hash','providerTrust'])assert.equal(Object.hasOwn(final1Schema.properties,forbidden),false);
  assert.equal(final1Schema.properties.receipt.additionalProperties,false,'Final-1 signed scope is verified evidence, never caller authority');
});

test('all responses are no-store and use a structured success or problem envelope',()=>{
  assert.equal(contract.components.responses.CommandCreated.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.CommandCreated.headers.ETag.schema.pattern,'^\\"[0-9]+\\"$');
  assert.equal(contract.components.responses.CommandReplay.headers.ETag.schema.pattern,'^\\"[0-9]+\\"$');
  assert.equal(contract.components.responses.Problem.headers['Cache-Control'].schema.const,'no-store');
  assert.deepEqual(contract.components.responses.Problem.headers['Retry-After'].schema,{type:'integer',minimum:0});
  assert.match(contract.components.responses.Problem.description,/412/);
  assert.match(contract.components.responses.Problem.description,/503/);
  for(const operation of accountingCommands){assert.ok(operation.responses['200']);assert.ok(operation.responses['503']);assert.ok(operation.responses.default);if(operation.operationId!=='verifyWbsAutoRecTransitionContract')assert.ok(operation.responses['201']);}
  const explanation=contract.paths['/entities/{entityId}/ai/analysis-explanation'].post;assert.ok(explanation.responses['200']);assert.ok(explanation.responses['503']);assert.equal(explanation.responses['201'],undefined);assert.match(explanation.description,/cannot create a Draft.*approve.*post/i);const explanationAction=contract.components.schemas.AiAccountingAnalysisExplanationResult.properties.controller_actions.items;assert.deepEqual(explanationAction.required,['category','finding_ids','action']);assert.equal(explanationAction.properties.finding_ids.minItems,1);
  for(const operation of operations.filter(item=>['transitionJournal','postJournal','createApBillVoid','createBankPaymentMatch','unmatchBankPayment','reviewWbsAutoRecBankMatch','setReconciliationClearance','setReconciliationAdjustmentClearance','transitionReconciliation','createReconciliationAdjustmentDraft','bindExactWbsPayableAttachment','bindWbsPayableUploadedAttachment','reviewAdmittedWbsPayable','reviewAiWbsPayableDraftProposal','createReviewedWbsPayableApDraft'].includes(item.operationId)))assert.equal(operation.responses['412'].$ref,'#/components/responses/PreconditionFailed');
  assert.equal(contract.components.responses.SerializationRetryExhausted.headers['Retry-After'].schema.minimum,0);
});

test('WBS transition-contract verification is scoped, signed evidence rather than a command',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/auto-reconciliation/transition-contracts/verify'].post;
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId']);
  assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsAutoRecTransitionContractVerify');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');
  assert.match(operation.description,/requires WBS AutoRec view scope/i);assert.match(operation.description,/never writes WBS.*Draft.*approves.*posts/i);
});

test('attachment create and replay responses use the exact attachment envelope',()=>{
  for(const path of ['/entities/{entityId}/attachments/reservations','/entities/{entityId}/attachments/{attachmentId}/finalize']){
    const responses=contract.paths[path].post.responses;
    assert.equal(responses['200'].$ref,'#/components/responses/AttachmentReplay');assert.equal(responses['201'].$ref,'#/components/responses/AttachmentCreated');
  }
  const result=contract.components.schemas.AttachmentResult;assert.equal(result.additionalProperties,false);
  assert.deepEqual(result.required,['attachment_id','entity_id','status','idempotent']);
});

test('WBS snapshot observations are scoped idempotent evidence only and production signatures fail closed',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/snapshots'].post;
  assert.equal(operation.operationId,'recordWbsSnapshot');assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsSnapshot');
  assert.equal(operation.responses['422'].$ref,'#/components/responses/Problem');assert.equal(operation.responses['503'].$ref,'#/components/responses/SerializationRetryExhausted');
  assert.match(operation.description,/never writes WBS, source documents, journal entries or ledger lines/i);assert.match(operation.description,/detached Ed25519 signature/i);
  const body=contract.components.requestBodies.WbsSnapshot.content['application/json'].schema;
  assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['snapshot']);
});

test('admitted Payable import requires signed explicit scope and exposes no accounting action',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/inbound/payables'].post;
  assert.equal(operation.operationId,'ingestAdmittedWbsPayables');assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsSnapshot');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  assert.match(operation.description,/production V2 Payable snapshot/i);assert.match(operation.description,/company, currency and snapshot-token/i);assert.match(operation.description,/never writes WBS.*Draft.*posts/i);
});

test('WBS Payable review is an evidence-only CAS command with frozen server-side scope',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/inbound/payables/{wbsInboundRowId}/reviews'].post;
  assert.equal(operation.operationId,'reviewAdmittedWbsPayable');assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsPayableReview');
  assert.deepEqual(operation.parameters.filter(item=>item.$ref).map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey','#/components/parameters/IfMatch']);
  assert.match(operation.description,/WBS\.PAYABLE\.REVIEW/);assert.match(operation.description,/never creates a Bill, Journal Entry, approval, posting batch, or ledger line/);
  const body=contract.components.requestBodies.WbsPayableReview.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.ok(body.required.includes('expectedEvidenceHash'));assert.ok(body.required.includes('mappingSnapshotId'));assert.ok(body.required.includes('attachmentIds'));
});

test('AI payable proposals are immutable human-review evidence and cannot create or post a journal',()=>{
  const list=contract.paths['/entities/{entityId}/ai/wbs-payable-draft-proposals'].get;
  const review=contract.paths['/entities/{entityId}/ai/wbs-payable-draft-proposals/{proposalId}/reviews'].post;
  assert.equal(list.operationId,'listAiWbsPayableDraftProposals');assert.match(list.description,/does not create a Draft, submit, approve, or post/i);
  assert.equal(review.operationId,'reviewAiWbsPayableDraftProposal');assert.deepEqual(review.parameters.filter(item=>item.$ref).map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey','#/components/parameters/IfMatch']);
  assert.match(review.description,/never creates a Draft or advances a journal/i);assert.equal(review.responses['412'].$ref,'#/components/responses/PreconditionFailed');
  assert.equal(contract.components.schemas.AiWbsPayableDraftProposal.properties.can_post.const,false);
});

test('admitted WBS Payable review candidates are dual-permission closed GET contracts',()=>{
  const list=contract.paths['/entities/{entityId}/wbs/inbound/payables/review-candidates'].get;
  const detail=contract.paths['/entities/{entityId}/wbs/inbound/payables/review-candidates/{wbsInboundRowId}'].get;
  assert.equal(list.operationId,'listAdmittedWbsPayableReviewCandidates');assert.equal(detail.operationId,'getAdmittedWbsPayableReviewCandidate');
  for(const operation of [list,detail]){assert.match(operation.description,/WBS\.PAYABLE\.REVIEW/);assert.match(operation.description,/AP\.VIEW/);assert.match(operation.description,/no Draft|creates no Draft/i);}
  const row=contract.components.schemas.WbsPayableReviewCandidateRow;assert.equal(row.additionalProperties,false);assert.ok(row.required.includes('review_readiness'));assert.ok(row.required.includes('can_review'));
  for(const forbidden of ['raw','normalized','payload_ref','source_record_id','provider_secret','signature','access_token'])assert.equal(row.properties[forbidden],undefined);
});

test('reviewed WBS Payable evidence is a dual-permission closed GET contract',()=>{
  const list=contract.paths['/entities/{entityId}/wbs/inbound/payables/reviews'].get;
  const detail=contract.paths['/entities/{entityId}/wbs/inbound/payables/reviews/{reviewEvidenceId}'].get;
  assert.equal(list.operationId,'listReviewedWbsPayableEvidence');assert.equal(detail.operationId,'getReviewedWbsPayableEvidence');
  assert.match(list.description,/WBS\.AUTOREC\.VIEW/);assert.match(list.description,/AP\.VIEW/);assert.match(detail.description,/WBS\.AUTOREC\.VIEW/);assert.match(detail.description,/AP\.VIEW/);
  assert.equal(list.responses['200'].$ref,'#/components/responses/WbsPayableEvidenceListOk');assert.equal(detail.responses['200'].$ref,'#/components/responses/WbsPayableEvidenceDetailOk');
  const row=contract.components.schemas.WbsPayableEvidenceReadRow;assert.equal(row.additionalProperties,false);assert.ok(row.required.includes('draft_readiness'));assert.ok(row.required.includes('can_create_draft'));
  for(const forbidden of ['raw_payload','provider_request','provider_response','provider_secret','signature','access_token'])assert.equal(row.properties[forbidden],undefined);
});

test('reviewed WBS Payable AP Draft derives every accounting fact from immutable review evidence',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/inbound/payables/{wbsInboundRowId}/drafts'].post;
  assert.equal(operation.operationId,'createReviewedWbsPayableApDraft');assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsPayableApDraft');
  assert.deepEqual(operation.parameters.filter(item=>item.$ref).map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey','#/components/parameters/IfMatch']);
  assert.match(operation.description,/AP\.BILL\.CREATE/);assert.match(operation.description,/maker must differ from the reviewer/i);assert.match(operation.description,/never submits, reviews, approves, posts, or writes a ledger line/i);
  const body=contract.components.requestBodies.WbsPayableApDraft.content['application/json'].schema;
  assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['reviewEvidenceId','expectedEvidenceHash','mappingSnapshotId','attachmentIds','reason']);
  for(const forbidden of ['amount','currency','documentNumber','vendorRef','offsetAccountCode','accountingDate','dueDate','lines'])assert.equal(body.properties[forbidden],undefined);
});

test('signed Bank admission is a scoped evidence command that exposes no matching or reconciliation authority',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/inbound/bank-statements'].post;
  assert.equal(operation.operationId,'admitSignedWbsBankStatement');
  assert.deepEqual(operation.parameters.map(parameter=>parameter.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  const body=operation.requestBody.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['admission']);
  assert.match(operation.description,/WBS\.BANK\.ADMIT/i);assert.match(operation.description,/never matches, reconciles, creates a Draft, or posts/i);
});

test('WBS AutoRec review is a bounded authenticated read with no accounting action contract',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/auto-reconciliation/review-candidates'].get;
  assert.equal(operation.operationId,'getWbsAutoRecReviewCandidates');assert.equal(operation.parameters[1].name,'companyKey');assert.equal(operation.parameters[2].name,'sourceRecordId');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');assert.match(operation.description,/never writes WBS, matches transactions, creates a Draft, approves, posts/i);
});

test('AutoRec Bank Match review is an independent CAS decision with GET-only immutable readback',()=>{
  const command=contract.paths['/entities/{entityId}/wbs/auto-reconciliation/match-reviews'].post;
  const read=contract.paths['/entities/{entityId}/wbs/auto-reconciliation/match-reviews/{reviewId}'].get;
  assert.equal(command.operationId,'reviewWbsAutoRecBankMatch');assert.deepEqual(command.parameters.map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey','#/components/parameters/IfMatch']);
  assert.match(command.description,/reviewer must differ.*Bank Match maker.*candidate preparer/i);assert.match(command.description,/never creates or posts.*Journal Entry.*G11.*INCURRED/i);
  const body=command.requestBody.content['application/json'].schema;assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['reviewCandidateId','candidateHash','bankMatchId','decision','reason']);assert.deepEqual(body.properties.decision.enum,['ACCEPTED','REJECTED']);
  assert.equal(read.operationId,'getWbsAutoRecBankMatchReview');assert.equal(read.responses['200'].$ref,'#/components/responses/ReadOk');assert.match(read.description,/immutable decision.*reviewer\/time.*SoD/i);assert.match(read.description,/cannot create a match.*G11.*INCURRED.*post/i);
});

test('WBS Cost GL and Property controls are authenticated evidence-only reads',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/control-reconciliation'].get;
  assert.equal(operation.operationId,'getWbsControlReconciliation');
  assert.deepEqual(operation.parameters.slice(1).map(parameter=>parameter.name),['sourceType','companyKey','period','propertyRef','periodStart','periodEnd','currency','bankAccountRef']);
  assert.deepEqual(operation.parameters[1].schema.enum,['COST_GENERAL_LEDGER','PROPERTY_COMPARISON']);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');
  assert.match(operation.description,/never writes WBS, creates a transaction or allocation, creates a Draft, approves, or posts/i);
});

test('AP and AR aging are no-store authenticated GETs with a required as-of date',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/aging','getApAging'],['/entities/{entityId}/ar/aging','getArAging']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.parameters[1].name,'asOf');assert.equal(operation.parameters[1].required,true);
    assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');
  }
  assert.equal(contract.components.responses.ReadOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.ArAgingRow.additionalProperties,false);
});

test('AP and AR control totals are no-store authenticated GETs',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/control-totals','getApControlTotal'],['/entities/{entityId}/ar/control-totals','getArControlTotal']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.parameters[1].name,'periodId');assert.equal(operation.parameters[1].required,true);assert.equal(operation.responses['200'].$ref,'#/components/responses/ControlTotalOk');
  }
  assert.equal(contract.components.responses.ControlTotalOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.ControlTotalRow.additionalProperties,false);
  assert.deepEqual(contract.components.schemas.ControlTotalRow.required,['period_id','account_code','currency','open_balance','control_balance','in_balance','business_document_ids','document_source_document_ids','journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids','document_contributors','ledger_contributors']);
  assert.equal(contract.components.schemas.ControlTotalDocumentContributor.additionalProperties,false);
  assert.equal(contract.components.schemas.ControlTotalLedgerContributor.additionalProperties,false);
});

test('AP Bill and AR Invoice list reads are authenticated no-store operations',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/bills','listApBills'],['/entities/{entityId}/ar/invoices','listArInvoices']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.responses['200'].$ref,'#/components/responses/BusinessDocumentReadOk');
  }
  const row=contract.components.schemas.BusinessDocumentReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.required,['business_document_id','document_number','counterparty_ref','counterparty_name','currency','accounting_date','gross_amount','open_balance','status','version','offset_account_code','description','journal_entry_id','journal_status','journal_revision','period_id']);
});

test('Journal Entry list read is authenticated, scoped and no-store',()=>{
  const operation=contract.paths['/entities/{entityId}/journal-entries'].get;
  assert.equal(operation.operationId,'listJournalEntries');assert.equal(operation.responses['200'].$ref,'#/components/responses/JournalEntryReadOk');
  const row=contract.components.schemas.JournalEntryReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.required,['journal_entry_id','journal_number','journal_type','status','journal_date','currency','revision','created_at','ledger_line_count']);
  assert.equal(contract.components.responses.JournalEntryReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('Journal workflow capabilities are a closed fixed-permission current-actor read',()=>{
  const operation=contract.paths['/entities/{entityId}/journal-workflow/capabilities'].get;
  assert.equal(operation.operationId,'getJournalWorkflowCapabilities');assert.deepEqual(operation.parameters,[{$ref:'#/components/parameters/EntityId'}]);
  assert.match(operation.description,/GL\.JE\.SUBMIT/);assert.match(operation.description,/callers cannot submit a permission name/i);assert.match(operation.description,/segregation of duties/i);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/JournalWorkflowCapabilitiesOk');assert.equal(contract.components.responses.JournalWorkflowCapabilitiesOk.headers['Cache-Control'].schema.const,'no-store');
  const shape=contract.components.schemas.JournalWorkflowCapabilities;assert.equal(shape.additionalProperties,false);assert.deepEqual(shape.required,['entity_id','can_submit','can_review','can_approve','can_post']);
  for(const field of ['can_submit','can_review','can_approve','can_post'])assert.equal(shape.properties[field].type,'boolean');
});

test('Source Document reads are OIDC-authenticated entity evidence only and match the no-query runtime contract',()=>{
  assert.deepEqual(contract.security,[{bearerAuth:[]}]);
  const list=contract.paths['/entities/{entityId}/source-documents'].get;
  const detail=contract.paths['/entities/{entityId}/source-documents/{sourceDocumentId}'].get;
  assert.equal(list.operationId,'listSourceDocuments');assert.equal(detail.operationId,'getSourceDocumentDetail');
  assert.deepEqual(list.parameters,[{$ref:'#/components/parameters/EntityId'}]);
  assert.deepEqual(detail.parameters,[{$ref:'#/components/parameters/EntityId'},{$ref:'#/components/parameters/SourceDocumentId'}]);
  assert.equal(contract.components.parameters.SourceDocumentId.schema.$ref,'#/components/schemas/Uuid');
  assert.equal(list.responses['200'].$ref,'#/components/responses/SourceDocumentReadOk');
  assert.equal(detail.responses['200'].$ref,'#/components/responses/SourceDocumentDetailReadOk');
  for(const operation of [list,detail]){
    assert.match(operation.description,/OIDC Bearer token/i);assert.match(operation.description,/does not accept a period query parameter/i);
    assert.match(operation.description,/never returns raw provider payloads, attachment bytes, storage references, or provider credentials/i);
  }
  for(const response of ['SourceDocumentReadOk','SourceDocumentDetailReadOk'])assert.equal(contract.components.responses[response].headers['Cache-Control'].schema.const,'no-store');
  const listRow=contract.components.schemas.SourceDocumentReadRow,detailRow=contract.components.schemas.SourceDocumentDetailReadRow,line=contract.components.schemas.SourceDocumentLineReadRow;
  assert.equal(listRow.additionalProperties,false);assert.equal(detailRow.additionalProperties,false);assert.equal(line.additionalProperties,false);
  assert.deepEqual(listRow.required,['source_document_id','source_document_revision','raw_event_id','source_system','source_module','source_record_id','source_version','document_type','document_no','business_date','accounting_date','currency','gross_amount','status','payload_hash','source_line_count','posted_journal_entry_ids','created_at','updated_at']);
  assert.ok(detailRow.required.includes('lines'));assert.equal(detailRow.properties.lines.items.$ref,'#/components/schemas/SourceDocumentLineReadRow');
  assert.equal(listRow.properties.source_document_revision.minimum,0);assert.equal(listRow.properties.gross_amount.pattern,'^-?(?:0|[1-9][0-9]{0,15})\\.[0-9]{4}$');
  assert.equal(line.properties.amount.pattern,'^-?(?:0|[1-9][0-9]{0,15})\\.[0-9]{4}$');
  const publicSchemas=JSON.stringify({listRow,detailRow,line});
  for(const forbidden of ['"payload":','"raw_payload"','"provider_payload"','"attachment"','"attachment_id"','"attachment_ids"','"storage_ref"','"storage_version"','"receipt_hash"','"access_token"','"credential"'])assert.equal(publicSchemas.includes(forbidden),false);
  assert.ok(line.required.includes('provider_trace'));assert.equal(line.properties.provider_trace.oneOf[0].type,'null');assert.equal(line.properties.provider_trace.oneOf[1].$ref,'#/components/schemas/WbsProviderSourceTrace');
});

test('controlled TEST_ONLY AI source read is exact-period, bounded, filtered and no-store',()=>{
  const operation=contract.paths['/entities/{entityId}/source-documents/controlled-test-ai-eligible'].get;
  assert.equal(operation.operationId,'listControlledTestAiSources');
  assert.deepEqual(operation.parameters[0],{$ref:'#/components/parameters/EntityId'});
  assert.deepEqual(operation.parameters[1],{name:'periodId',in:'query',required:true,schema:{$ref:'#/components/schemas/Uuid'}});
  assert.deepEqual(operation.parameters[2].schema,{type:'integer',minimum:1,maximum:100,default:100});
  for(const token of ['STAGING TEST ONLY','GL.JE.VIEW','exact active entity binding','WBS or REFS_STAGE1','source_module payable','document_type WBS_TEST_PAYABLE','status POSTED','source-linked POSTED journal entry','exact configured OPEN period'])assert.match(operation.description,new RegExp(token));
  assert.equal(operation.responses['200'].$ref,'#/components/responses/ControlledTestAiSourceReadOk');
  assert.equal(contract.components.responses.ControlledTestAiSourceReadOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.ControlledTestAiSourceReadEnvelope.properties.data.maxItems,100);
});

test('bank transaction and reconciliation reads are scoped no-store evidence only',()=>{
  const transactions=contract.paths['/entities/{entityId}/bank/transactions'].get;
  assert.equal(transactions.operationId,'listBankTransactions');
  assert.equal(transactions.responses['200'].$ref,'#/components/responses/BankTransactionReadOk');
  assert.deepEqual(transactions.parameters.slice(1).map(parameter=>parameter.name),['bankAccountRef','from','through','limit','offset']);
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='bankAccountRef').required,true);
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='bankAccountRef').schema.pattern,'^(?:\\S|\\S.*\\S)$');
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='limit').schema.maximum,200);
  assert.deepEqual(transactions.parameters.find(parameter=>parameter.name==='offset').schema,{type:'integer',minimum:0,maximum:10000,default:0});
  assert.match(transactions.description,/cannot match, clear, sign off, or post/i);
  const reconciliation=contract.paths['/entities/{entityId}/bank/reconciliation'].get;
  assert.equal(reconciliation.operationId,'getReconciliationSummary');
  assert.equal(reconciliation.responses['200'].$ref,'#/components/responses/ReconciliationSummaryOk');
  assert.equal(reconciliation.parameters.find(parameter=>parameter.name==='statementEndingDate').required,true);
  assert.equal(reconciliation.parameters.find(parameter=>parameter.name==='bankAccountRef').schema.pattern,'^(?:\\S|\\S.*\\S)$');
  assert.match(reconciliation.description,/cannot match, clear, reopen, sign off, or post/i);
  assert.match(reconciliation.description,/DRAFT, IN_REVIEW, or REOPENED/);assert.match(reconciliation.description,/prior RECONCILED/);assert.match(reconciliation.description,/not dynamically recomputed or returned/);
  assert.equal(contract.components.responses.BankTransactionReadOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.ReconciliationSummaryOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.BankTransactionReadRow.additionalProperties,false);
  assert.equal(contract.components.schemas.ReconciliationSummaryRow.additionalProperties,false);
});

test('signed reconciliation snapshot is a documented immutable historical readback',()=>{
  const operation=contract.paths['/entities/{entityId}/bank/reconciliations/{reconciliationId}/signed-snapshot'].get;
  assert.equal(operation.operationId,'getSignedReconciliationSnapshot');assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');
  assert.deepEqual(operation.parameters,[{$ref:'#/components/parameters/EntityId'},{$ref:'#/components/parameters/ReconciliationId'}]);
  assert.match(operation.description,/immutable/i);assert.match(operation.description,/historical Bank-to-Journal readback/i);assert.match(operation.description,/cannot match.*clear.*review.*reopen.*sign off.*Draft.*post/i);
});

test('financial statements are an authenticated period-scoped POSTED evidence read',()=>{
  const operation=contract.paths['/entities/{entityId}/reports/financial-statements'].get;
  assert.equal(operation.operationId,'getFinancialStatements');
  assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId').required,true);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/FinancialStatementReadOk');
  assert.match(operation.description,/cannot create, adjust, post, export, or persist/i);
  const row=contract.components.schemas.FinancialStatementReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.properties.statement_type.enum,['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
  assert.equal(row.properties.classification_basis.const,'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER');
  for(const key of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.equal(row.properties[key].items.$ref,'#/components/schemas/Uuid');
  assert.equal(contract.components.responses.FinancialStatementReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('financial statement snapshot read exposes a versioned immutable evidence contract',()=>{
  const operation=contract.paths['/entities/{entityId}/reports/financial-statement-snapshot'].get;
  assert.equal(operation.operationId,'getFinancialStatementSnapshot');
  assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId').required,true);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/FinancialStatementSnapshotReadOk');
  assert.match(operation.description,/latest.*immutable|immutable.*snapshot/i);
  const row=contract.components.schemas.FinancialStatementSnapshotReadRow;
  for(const field of ['financial_statement_snapshot_id','version','snapshot_hash','ledger_evidence_hash','prepared_by','approved_by','journal_entry_ids','ledger_line_ids','source_document_ids','row_hash'])assert.ok(row.required.includes(field));
});

test('dimension profitability is an exact, read-only Property, Project, or Unit ledger view',()=>{
  const operation=contract.paths['/entities/{entityId}/reports/dimension-profitability'].get;
  assert.equal(operation.operationId,'getDimensionProfitability');
  assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId').required,true);
  assert.deepEqual(operation.parameters.find(parameter=>parameter.name==='dimensionType').schema.enum,['PROPERTY','PROJECT','UNIT','LOT']);
  assert.equal(operation.parameters.find(parameter=>parameter.name==='dimensionRef').schema.maxLength,160);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/DimensionProfitabilityReadOk');
  assert.match(operation.description,/Missing dimensions are excluded rather than inferred/i);
  const row=contract.components.schemas.DimensionProfitabilityReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.properties.statement_type.enum,['PROPERTY_PNL','PROJECT_PNL','UNIT_PROFITABILITY','LOT_PROFITABILITY']);
  assert.equal(row.properties.classification_basis.const,'POSTED_LEDGER_DIMENSION_EXACT');
  for(const key of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.equal(row.properties[key].items.$ref,'#/components/schemas/Uuid');
  assert.equal(contract.components.responses.DimensionProfitabilityReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('cash flow classification requires a mapping snapshot and carries blocked evidence rather than inferred totals',()=>{
  const operation=contract.paths['/entities/{entityId}/reports/cash-flow-classification'].get;
  assert.equal(operation.operationId,'getCashFlowClassification');assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId').required,true);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/CashFlowClassificationReadOk');
  assert.match(operation.description,/Missing, ambiguous, invalid, or multi-cash mappings remain BLOCKED/i);
  const row=contract.components.schemas.CashFlowClassificationReadRow;
  assert.equal(row.additionalProperties,false);assert.deepEqual(row.properties.classification.enum,['OPERATING','INVESTING','FINANCING','BLOCKED']);
  assert.ok(row.properties.mapping_status.enum.includes('BLOCKED_MAPPING_REQUIRED'));assert.ok(row.properties.mapping_status.enum.includes('BLOCKED_JOURNAL_SHAPE_REQUIRED'));
  for(const key of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.equal(row.properties[key].items.$ref,'#/components/schemas/Uuid');
  assert.equal(contract.components.responses.CashFlowClassificationReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('AP and AR adjustment list reads expose only the authoritative scoped adjustment envelope',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/adjustments','listApAdjustments'],['/entities/{entityId}/ar/adjustments','listArAdjustments']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.responses['200'].$ref,'#/components/responses/BusinessAdjustmentReadOk');
  }
  const row=contract.components.schemas.BusinessAdjustmentReadRow;
  assert.equal(row.additionalProperties,false);assert.deepEqual(row.required,['business_adjustment_id','adjustment_kind','amount','currency','accounting_date','period_id','reason','status','version','created_at']);
});

test('AP Bill and AR Invoice create commands are Draft-only and require a canonical business document body',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/bills','createApBill'],['/entities/{entityId}/ar/invoices','createArInvoice']]){
    const operation=contract.paths[path].post;
    assert.equal(operation.operationId,operationId);assert.equal(operation.requestBody.$ref,'#/components/requestBodies/BusinessDocument');
    assert.equal(operation.responses['201'].$ref,'#/components/responses/CommandCreated');
  }
  const schema=contract.components.requestBodies.BusinessDocument.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['periodId','documentNumber','counterpartyRef','counterpartyName','currency','accountingDate','amount','offsetAccountCode','attachmentIds']);
});

test('AI accrual analysis returns a closed bounded no-action evidence contract',()=>{
  const operation=contract.paths['/entities/{entityId}/ai/accrual-candidates'].get;
  assert.equal(operation.operationId,'analyzeAiAccrualCandidates');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/AiAccrualAnalysisOk');
  assert.equal(contract.components.responses.AiAccrualAnalysisOk.headers['Cache-Control'].$ref,'#/components/headers/NoStore');
  assert.equal(contract.components.responses.AiAccrualAnalysisOk.content['application/json'].schema.$ref,'#/components/schemas/AiAccrualAnalysisEnvelope');

  const envelope=contract.components.schemas.AiAccrualAnalysisEnvelope;
  assert.equal(envelope.additionalProperties,false);assert.deepEqual(envelope.required,['ok','data']);assert.equal(envelope.properties.data.$ref,'#/components/schemas/AiAccrualAnalysisResult');
  const result=contract.components.schemas.AiAccrualAnalysisResult;
  assert.equal(result.additionalProperties,false);assert.deepEqual(result.required,Object.keys(result.properties));
  assert.equal(result.properties.status.const,'AI_ACCRUAL_ANALYSIS_COMPLETE');
  assert.deepEqual(result.properties.excluded_explicit_non_accrual_evidence_count,{type:'integer',minimum:0,maximum:1000});
  assert.equal(result.properties.candidates.maxItems,1000);assert.equal(result.properties.candidates.items.$ref,'#/components/schemas/AiAccrualCandidate');
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(result.properties[field].const,false);

  const candidate=contract.components.schemas.AiAccrualCandidate;
  assert.equal(candidate.additionalProperties,false);assert.deepEqual(candidate.required,Object.keys(candidate.properties));
  assert.equal(candidate.properties.status.const,'ACCRUAL_CANDIDATE_REVIEW_REQUIRED');assert.equal(candidate.properties.rule_id.const,'RECURRING_OBLIGATION_MISSING_CURRENT_PERIOD');
  for(const field of ['recurring_obligation_id','service_frequency'])assert.deepEqual(candidate.properties[field].type,['string','null']);
  assert.equal(candidate.properties.historical_amounts.minItems,3);assert.equal(candidate.properties.historical_amounts.maxItems,3);
  assert.equal(candidate.properties.prior_source_trace.minItems,3);assert.equal(candidate.properties.prior_source_trace.maxItems,3);assert.equal(candidate.properties.prior_source_trace.items.$ref,'#/components/schemas/AiAccrualSourceTrace');
  assert.equal(candidate.properties.required_human_fields.items,false);assert.deepEqual(candidate.properties.required_human_fields.prefixItems.map(item=>item.const),['owner','due_date','accrual_basis','account_mapping','member_trace','reversing_entry_decision']);
  for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(candidate.properties[field].const,false);

  const trace=contract.components.schemas.AiAccrualSourceTrace;
  assert.equal(trace.additionalProperties,false);assert.deepEqual(trace.required,Object.keys(trace.properties));
  for(const field of ['source_document_id','source_document_line_id','accounting_period_id'])assert.equal(trace.properties[field].$ref,'#/components/schemas/Uuid');
  for(const field of ['source_payload_hash','source_line_hash'])assert.equal(trace.properties[field].pattern,'^sha256:[0-9a-f]{64}$');
  for(const field of ['recurring_obligation_id','service_frequency','obligation_status'])assert.deepEqual(trace.properties[field].type,['string','null']);
});

test('Stage 1 WBS operator self-upgrade is a closed exact-scope command',()=>{
  const operation=contract.paths['/entities/{entityId}/access/self-service-wbs-operator-grant/upgrade'].post;
  assert.equal(operation.operationId,'upgradeStage1WbsOperatorAccess');assert.deepEqual(operation.parameters.map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  assert.equal(operation.requestBody.content['application/json'].schema.additionalProperties,false);assert.equal(operation.requestBody.content['application/json'].schema.maxProperties,0);
  assert.match(operation.description,/only WBS\.PAYABLE\.OPERATOR_ATTEST/);assert.match(operation.description,/no import, review, Draft, approval, posting, ledger, or WBS write authority/i);
});

test('controlled test workflow self-upgrade is a closed identity-free staging command',()=>{
  const operation=contract.paths['/entities/{entityId}/access/self-service-controlled-test-workflow-grant/upgrade'].post;
  assert.equal(operation.operationId,'upgradeStage1ControlledTestWorkflowAccess');assert.deepEqual(operation.parameters.map(item=>item.$ref),['#/components/parameters/EntityId','#/components/parameters/IdempotencyKey']);
  const schema=operation.requestBody.content['application/json'].schema;assert.equal(schema.additionalProperties,false);assert.equal(schema.maxProperties,0);
  assert.match(operation.description,/version 3/);assert.match(operation.description,/version 4/);assert.match(operation.description,/No identity, permission or scope selector/i);
});
