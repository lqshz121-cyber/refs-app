import {
  ACCOUNT_MAP,
  ACCOUNTING_EVENT_TYPES,
  WBS_MCP_CONTRACT_RULES,
  WBS_MCP_CONTRACTS,
  WBS_MOCK_CONTRACT_COLLECTIONS,
  approveAndPostSuggestedJEs,
  buildAccountingEvents,
  buildTrialBalance,
  classifyPropertyTaxStatement,
  createAmortizationScheduleFromInsurance,
  createWbsMockConnector,
  createWbsMockDataset,
  projectToGeneralLedger,
  retainMockReviewApproval,
  mockJeReviewFingerprint,
  runDeterministicAccountingRules,
  runWbsAccountingMockPipeline,
  validateWbsContractRecord,
  validateWbsMockContractCollections,
} from '../src/wbs-accounting-foundation.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const byRule = (findings, ruleId) => findings.find(finding => finding.rule_id === ruleId);
const sum = rows => Math.round(rows.reduce((total, row) => total + Number(row.amount || 0), 0) * 100) / 100;

async function main() {
  const dataset = createWbsMockDataset();

  ['BankTransaction', 'PayableInvoice', 'ConstructionLoan', 'PropertyTaxStatement', 'SourceDocument', 'AIFinding', 'JournalEntry', 'JournalEntryLine', 'AmortizationSchedule', 'AccrualSchedule'].forEach(contractName => {
    ['id', 'external_source_id', 'source_system', 'entity_id', 'project_id', 'property_id', 'transaction_date', 'accounting_period', 'amount', 'currency', 'status', 'source_document_id', 'created_at', 'updated_at', 'confidence_score', 'audit_trail_id'].forEach(field => {
      assert(WBS_MCP_CONTRACTS[contractName].includes(field), `${contractName} is missing common field ${field}`);
    });
  });
  assert(ACCOUNTING_EVENT_TYPES.includes('loan_draw') && ACCOUNTING_EVENT_TYPES.includes('amortization') && ACCOUNTING_EVENT_TYPES.includes('manual_je'), 'required accounting event types are registered');
  assert(WBS_MCP_CONTRACT_RULES.Entity.kind === 'MASTER', 'Entity must be an explicit master-record exception to transaction common fields');
  assert(Object.keys(WBS_MCP_CONTRACTS).every(name => name in WBS_MOCK_CONTRACT_COLLECTIONS), 'every declared contract must have an explicit mock collection registration');
  assert(validateWbsContractRecord('PayableInvoice', dataset.payableInvoices[0]).ok, 'mock payable invoice must satisfy WBS contract');
  assert(dataset.bankTransactions.every(row => validateWbsContractRecord('BankTransaction', row).ok), 'bank transactions must accept either vendor or customer party identity');
  assert(dataset.sourceDocuments.every(row => validateWbsContractRecord('SourceDocument', row).ok), 'source documents must accept either vendor or customer party identity');
  assert(validateWbsContractRecord('BankTransaction', { ...dataset.bankTransactions[0], vendor_id: null, customer_id: null }).ok, 'unidentified bank parties must remain valid optional adapter fields');
  assert(dataset.propertyTaxStatements.length === 2 && dataset.propertyTaxStatements.every(row => validateWbsContractRecord('PropertyTaxStatement', row).ok), 'mock property tax statements must satisfy the adapter-ready WBS contract');
  const conformance = validateWbsMockContractCollections(dataset);
  assert(conformance.all_contracts_registered, 'contract registry must cover every declared contract without unknown entries');
  assert(conformance.contract_count === Object.keys(WBS_MCP_CONTRACTS).length, 'conformance report must include every declared contract');
  assert(conformance.results.find(result => result.contract === 'CustomerTenant')?.status === 'UNSUPPORTED', 'missing Customer/Tenant data must be reported as unsupported, not fabricated');
  assert(conformance.results.find(result => result.contract === 'ResidentActivity')?.status === 'UNSUPPORTED', 'missing Resident Activity data must be reported as unsupported, not fabricated');
  assert(conformance.results.find(result => result.contract === 'ClosingStatement')?.status === 'UNSUPPORTED', 'missing Closing Statement data must be reported as unsupported, not fabricated');
  assert(conformance.results.find(result => result.contract === 'JournalEntry')?.status === 'INVALID_ROWS', 'workflow journal projections must not be claimed as connector-contract conformant');
  assert(conformance.complete === false && conformance.supported_collections_conform === false, 'current mock contract coverage must truthfully remain incomplete and non-conformant');
  const invalidDataset = structuredClone(dataset);
  delete invalidDataset.projects[1].project_code;
  invalidDataset.properties = [];
  delete invalidDataset.vendors;
  const invalidConformance = validateWbsMockContractCollections(invalidDataset);
  assert(invalidConformance.results.find(result => result.contract === 'Project')?.invalid_rows[0]?.index === 1, 'conformance gate must validate and locate every invalid collection row');
  assert(invalidConformance.results.find(result => result.contract === 'Property')?.status === 'EMPTY_COLLECTION', 'an available but empty collection must not be called conformant');
  assert(invalidConformance.results.find(result => result.contract === 'Vendor')?.status === 'MISSING_COLLECTION', 'a registered but absent collection must be reported as missing');
  const propertyTaxAccrual = classifyPropertyTaxStatement(dataset.propertyTaxStatements.find(row => row.id === 'PTAX-TRAVIS-2026'));
  const propertyTaxPrepaid = classifyPropertyTaxStatement(dataset.propertyTaxStatements.find(row => row.id === 'PTAX-TRAVIS-2027-PREPAID'));
  assert(propertyTaxAccrual.decision === 'ACCRUAL' && propertyTaxAccrual.amount === 14000 && propertyTaxAccrual.recognized_months === 7, 'elapsed unpaid property tax must classify as a seven-month accrual');
  assert(propertyTaxPrepaid.decision === 'PREPAID' && propertyTaxPrepaid.amount === 12000 && propertyTaxPrepaid.recognized_months === 0, 'paid future-period property tax must classify as prepaid');

  const connector = createWbsMockConnector(dataset);
  const snapshot = await connector.fetchSnapshot();
  assert(snapshot !== dataset && snapshot.payableInvoices.length >= 4, 'mock connector returns an isolated WBS snapshot');
  assert(snapshot.sourceDocuments.length >= 7, 'mock connector includes property-tax source-document evidence');
  const connectorConformance = await connector.inspectContractConformance();
  assert(connectorConformance.unsupported_contract_count > 0 && connectorConformance.invalid_collection_count > 0, 'connector must expose unsupported and invalid contract coverage truthfully');

  const events = buildAccountingEvents(snapshot);
  ['prepaid', 'invoice', 'payment', 'loan_draw', 'loan_interest', 'construction_cost', 'rent_income', 'property_expense'].forEach(eventType => {
    assert(events.some(event => event.event_type === eventType), `missing accounting event type ${eventType}`);
  });
  const taxAccrualEvent = events.find(event => event.source_transaction_id === 'PTAX-TRAVIS-2026');
  const taxPrepaidEvent = events.find(event => event.source_transaction_id === 'PTAX-TRAVIS-2027-PREPAID');
  assert(taxAccrualEvent?.accounting_decision === 'ACCRUAL' && taxAccrualEvent.amount === 14000 && taxAccrualEvent.suggested_debit_account === ACCOUNT_MAP.propertyTaxExpense && taxAccrualEvent.suggested_credit_account === ACCOUNT_MAP.ap, 'property tax accrual event must be prorated and mapped to expense/AP');
  assert(taxPrepaidEvent?.accounting_decision === 'PREPAID' && taxPrepaidEvent.amount === 12000 && taxPrepaidEvent.suggested_debit_account === ACCOUNT_MAP.prepaidPropertyTax && taxPrepaidEvent.suggested_credit_account === ACCOUNT_MAP.cash, 'future property tax event must be mapped to prepaid/cash');
  events.forEach(event => {
    ['event_id', 'event_type', 'source_transaction_id', 'entity_id', 'project_id', 'property_id', 'amount', 'accounting_period', 'suggested_debit_account', 'suggested_credit_account', 'rule_id', 'confidence_score', 'status', 'reason', 'requires_review'].forEach(field => {
      assert(field in event, `event ${event.event_id} missing ${field}`);
    });
  });

  const findings = runDeterministicAccountingRules(snapshot, events);
  [
    'PREPAID_SCHEDULE_REQUIRED',
    'PAYMENT_WITHOUT_BILL',
    'LOAN_DRAW_RECOGNITION',
    'INTEREST_CAPITALIZATION_REQUIRED',
    'ACCRUAL_CANDIDATE',
    'DUPLICATE_INVOICE_RISK',
    'CWIP_POST_COMPLETION_CUTOFF',
    'LOAN_BALANCE_MISMATCH',
    'RENT_ROLL_REVENUE_MISMATCH',
    'MISSING_SOURCE_DOCUMENT',
    'MANUAL_JE_LARGE_NO_ATTACHMENT',
    'PROPERTY_TAX_ACCRUAL_REQUIRED',
    'PROPERTY_TAX_PREPAID_REQUIRED',
  ].forEach(ruleId => assert(byRule(findings, ruleId), `missing deterministic finding ${ruleId}`));
  findings.forEach(finding => {
    ['finding_id', 'rule_id', 'rule_name', 'risk_level', 'object_type', 'object_id', 'reason', 'suggested_action', 'confidence_score', 'owner', 'due_date', 'status', 'audit_trail'].forEach(field => {
      assert(field in finding, `finding ${finding.finding_id} missing ${field}`);
    });
    if (finding.risk_level === 'HIGH') assert(finding.status === 'REVIEW_REQUIRED', `${finding.rule_id} must enter review`);
  });

  const suggested = findings.map(finding => finding.suggested_je).filter(Boolean);
  assert(suggested.length >= 8, 'rule engine should create suggested JEs for actionable findings');
  suggested.forEach(je => {
    const debit = je.lines.reduce((total, line) => total + Number(line.debit_amount || 0), 0);
    const credit = je.lines.reduce((total, line) => total + Number(line.credit_amount || 0), 0);
    assert(Math.abs(debit - credit) < 0.005, `${je.je_id} must be balanced`);
    assert(je.source_document_id, `${je.je_id} must retain source reference`);
    assert(je.audit_trail.length >= 1, `${je.je_id} must retain audit trail`);
  });
  const propertyTaxAccrualJe = suggested.find(je => je.ai_rule_id === 'PROPERTY_TAX_ACCRUAL_REQUIRED');
  const propertyTaxPrepaidJe = suggested.find(je => je.ai_rule_id === 'PROPERTY_TAX_PREPAID_REQUIRED');
  assert(propertyTaxAccrualJe?.source_document_id === 'DOC-PROPERTY-TAX-2026' && propertyTaxAccrualJe.lines.some(row => row.account_code === ACCOUNT_MAP.propertyTaxExpense && row.debit_amount === 14000), 'property tax accrual Draft JE must remain source-backed and debit property tax expense');
  assert(propertyTaxPrepaidJe?.posting_status === 'DRAFT' && propertyTaxPrepaidJe.lines.some(row => row.account_code === ACCOUNT_MAP.prepaidPropertyTax && row.debit_amount === 12000), 'property tax prepaid suggestion must remain a source-backed Draft and never auto-post');

  const blocked = approveAndPostSuggestedJEs({
    suggestedJEs: [{ ...suggested[0], source_document_id: null }],
    periods: snapshot.accountingPeriods,
  })[0];
  assert(blocked.posting_status === 'BLOCKED' && /source/i.test(blocked.block_reason), 'missing source document blocks posting');

  const unreviewed = approveAndPostSuggestedJEs({ suggestedJEs: [suggested.find(je => je.ai_rule_id === 'LOAN_DRAW_RECOGNITION')], periods: snapshot.accountingPeriods })[0];
  assert(unreviewed.posting_status === 'BLOCKED' && /review approval/i.test(unreviewed.block_reason), 'unreviewed suggested JE cannot bypass the mock review gate');
  const loanSuggested = suggested.find(je => je.ai_rule_id === 'LOAN_DRAW_RECOGNITION');
  const reviewedLoan = retainMockReviewApproval({ suggestedJe: loanSuggested, decision: { rule_id: 'LOAN_DRAW_RECOGNITION', source_document_id: loanSuggested.source_document_id, je_fingerprint: mockJeReviewFingerprint(loanSuggested), decision: 'APPROVED_FOR_MOCK_POSTING', actor: 'CONTROLLER_MOCK', reviewed_at: '2026-08-05T00:00:00.000Z' } });
  const tamperedAfterReview = approveAndPostSuggestedJEs({ suggestedJEs: [{ ...reviewedLoan, lines: reviewedLoan.lines.map(line => ({ ...line, debit_amount: line.debit_amount ? line.debit_amount + 1 : 0, credit_amount: line.credit_amount ? line.credit_amount + 1 : 0 })) }], periods: snapshot.accountingPeriods })[0];
  assert(tamperedAfterReview.posting_status === 'BLOCKED' && /content-bound/i.test(tamperedAfterReview.block_reason), 'mock approval is bound to the reviewed JE content');
  for (const mutation of [
    { je_date: '2026-07-16' },
    { project_id: 'PROJ-TAMPERED' },
    { property_id: 'PROP-TAMPERED' },
    { source_system: 'UNREVIEWED_SOURCE' },
    { has_attachment: false },
  ]) {
    const tampered = approveAndPostSuggestedJEs({ suggestedJEs: [{ ...reviewedLoan, ...mutation }], periods: snapshot.accountingPeriods })[0];
    assert(tampered.posting_status === 'BLOCKED' && /content-bound/i.test(tampered.block_reason), `mock approval rejects changed ${Object.keys(mutation)[0]}`);
  }
  const lineDimensionTamper = approveAndPostSuggestedJEs({ suggestedJEs: [{ ...reviewedLoan, lines: reviewedLoan.lines.map((item, index) => index ? item : { ...item, property_id: 'PROP-TAMPERED' }) }], periods: snapshot.accountingPeriods })[0];
  assert(lineDimensionTamper.posting_status === 'BLOCKED' && /content-bound/i.test(lineDimensionTamper.block_reason), 'mock approval rejects changed line dimensions');
  const posted = approveAndPostSuggestedJEs({
    suggestedJEs: [reviewedLoan],
    periods: snapshot.accountingPeriods,
  })[0];
  assert(posted.posting_status === 'POSTED', 'approved balanced source-backed JE posts');
  assert(posted.audit_trail.some(entry => entry.action === 'posted'), 'posted JE records audit trail');

  const postedPropertyTax = approveAndPostSuggestedJEs({ suggestedJEs: [retainMockReviewApproval({ suggestedJe: propertyTaxAccrualJe, decision: { rule_id: 'PROPERTY_TAX_ACCRUAL_REQUIRED', source_document_id: propertyTaxAccrualJe.source_document_id, je_fingerprint: mockJeReviewFingerprint(propertyTaxAccrualJe), decision: 'APPROVED_FOR_MOCK_POSTING', actor: 'CONTROLLER_MOCK', reviewed_at: '2026-08-05T00:00:00.000Z' } })], periods: snapshot.accountingPeriods })[0];
  assert(postedPropertyTax.posting_status === 'POSTED' && postedPropertyTax.audit_trail.some(entry => entry.action === 'approved') && postedPropertyTax.audit_trail.some(entry => entry.action === 'posted'), 'reviewed property tax accrual can enter the guarded mock posting projection with audit evidence');

  const gl = projectToGeneralLedger([...snapshot.journalEntries, posted, postedPropertyTax]);
  assert(gl.some(line => line.je_id === posted.je_id), 'posted JE flows into GL projection');
  assert(gl.filter(line => line.source_document_id === 'DOC-PROPERTY-TAX-2026').length === 2, 'posted property tax accrual produces two source-linked GL lines');
  const tb = buildTrialBalance(gl);
  assert(tb.balanced, 'Trial Balance generated from posted JE must balance');
  assert(tb.total_debit === tb.total_credit, 'Trial Balance debit equals credit');

  const schedule = createAmortizationScheduleFromInsurance(snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO'));
  assert(schedule.status === 'DRAFT', 'amortization schedule starts in draft review');
  assert(schedule.lines.length === 12, '12-month insurance generates 12 amortization lines');
  assert(sum(schedule.lines) === 12000, 'amortization schedule ties to source amount');
  schedule.lines.forEach(line => {
    const debit = line.suggested_je.lines.reduce((total, jeLine) => total + Number(jeLine.debit_amount || 0), 0);
    const credit = line.suggested_je.lines.reduce((total, jeLine) => total + Number(jeLine.credit_amount || 0), 0);
    assert(Math.abs(debit - credit) < 0.005, `amortization JE for ${line.period} must balance`);
  });

  const pipeline = await runWbsAccountingMockPipeline(connector);
  assert(pipeline.events.length === events.length, 'pipeline returns the accounting events');
  assert(pipeline.findings.length === findings.length, 'pipeline returns deterministic rule results');
  assert(pipeline.postedJEs.every(je => je.posting_status === 'POSTED'), 'pipeline can approve and post eligible source-backed suggested JEs');
  assert(pipeline.postedJEs.some(je => je.ai_rule_id === 'ACCRUAL_CANDIDATE' && je.source_document_id === 'DOC-AP-MISSING-GL'), 'pipeline retains reviewed payable accrual through the standard mock JE gate');
  assert(pipeline.glLines.length > snapshot.journalEntries.length, 'pipeline projects posted JE lines into GL');
  assert(pipeline.trialBalance.balanced, 'pipeline Trial Balance is balanced');

  console.log('wbs-accounting-foundation: implemented mock collections conform where reported; unsupported and invalid contract outputs remain explicit');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
