import {
  ACCOUNTING_EVENT_TYPES,
  WBS_MCP_CONTRACTS,
  approveAndPostSuggestedJEs,
  buildAccountingEvents,
  buildTrialBalance,
  createAmortizationScheduleFromInsurance,
  createWbsMockConnector,
  createWbsMockDataset,
  projectToGeneralLedger,
  runDeterministicAccountingRules,
  runWbsAccountingMockPipeline,
  validateWbsContractRecord,
} from '../src/wbs-accounting-foundation.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const byRule = (findings, ruleId) => findings.find(finding => finding.rule_id === ruleId);
const sum = rows => Math.round(rows.reduce((total, row) => total + Number(row.amount || 0), 0) * 100) / 100;

async function main() {
  const dataset = createWbsMockDataset();

  ['BankTransaction', 'PayableInvoice', 'ConstructionLoan', 'SourceDocument', 'AIFinding', 'JournalEntry', 'JournalEntryLine', 'AmortizationSchedule', 'AccrualSchedule'].forEach(contractName => {
    ['id', 'external_source_id', 'source_system', 'entity_id', 'project_id', 'property_id', 'transaction_date', 'accounting_period', 'amount', 'currency', 'status', 'source_document_id', 'created_at', 'updated_at', 'confidence_score', 'audit_trail_id'].forEach(field => {
      assert(WBS_MCP_CONTRACTS[contractName].includes(field), `${contractName} is missing common field ${field}`);
    });
  });
  assert(ACCOUNTING_EVENT_TYPES.includes('loan_draw') && ACCOUNTING_EVENT_TYPES.includes('amortization') && ACCOUNTING_EVENT_TYPES.includes('manual_je'), 'required accounting event types are registered');
  assert(validateWbsContractRecord('PayableInvoice', dataset.payableInvoices[0]).ok, 'mock payable invoice must satisfy WBS contract');

  const connector = createWbsMockConnector(dataset);
  const snapshot = await connector.fetchSnapshot();
  assert(snapshot !== dataset && snapshot.payableInvoices.length >= 4, 'mock connector returns an isolated WBS snapshot');
  assert(snapshot.sourceDocuments.length >= 5, 'mock connector includes source-document evidence');

  const events = buildAccountingEvents(snapshot);
  ['prepaid', 'invoice', 'payment', 'loan_draw', 'loan_interest', 'construction_cost', 'rent_income'].forEach(eventType => {
    assert(events.some(event => event.event_type === eventType), `missing accounting event type ${eventType}`);
  });
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

  const blocked = approveAndPostSuggestedJEs({
    suggestedJEs: [{ ...suggested[0], source_document_id: null }],
    periods: snapshot.accountingPeriods,
  })[0];
  assert(blocked.posting_status === 'BLOCKED' && /source/i.test(blocked.block_reason), 'missing source document blocks posting');

  const posted = approveAndPostSuggestedJEs({
    suggestedJEs: [suggested.find(je => je.ai_rule_id === 'LOAN_DRAW_RECOGNITION')],
    periods: snapshot.accountingPeriods,
  })[0];
  assert(posted.posting_status === 'POSTED', 'approved balanced source-backed JE posts');
  assert(posted.audit_trail.some(entry => entry.action === 'posted'), 'posted JE records audit trail');

  const gl = projectToGeneralLedger([...snapshot.journalEntries, posted]);
  assert(gl.some(line => line.je_id === posted.je_id), 'posted JE flows into GL projection');
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
  assert(pipeline.glLines.length > snapshot.journalEntries.length, 'pipeline projects posted JE lines into GL');
  assert(pipeline.trialBalance.balanced, 'pipeline Trial Balance is balanced');

  console.log('wbs-accounting-foundation: contracts, mock connector, events, rules, JE, GL, TB and amortization passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
