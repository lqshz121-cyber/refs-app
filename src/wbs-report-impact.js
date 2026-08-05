import {
  ACCOUNT_MAP,
  approveAndPostSuggestedJEs,
  buildAccountingEvents,
  buildTrialBalance,
  createWbsMockDataset,
  projectToGeneralLedger,
  retainMockReviewApproval,
  mockJeReviewFingerprint,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';

const money = value => Math.round(Number(value || 0) * 100) / 100;
const normalType = accountCode => {
  const lead = String(accountCode || '')[0];
  if (lead === '1') return 'ASSET';
  if (lead === '2') return 'LIABILITY';
  if (lead === '3') return 'EQUITY';
  if (lead === '4') return 'REVENUE';
  return 'EXPENSE';
};
const presentationAmount = row => ['ASSET', 'EXPENSE'].includes(row.account_type) ? row.net_amount : -row.net_amount;

export function buildWbsReportImpact(snapshot = createWbsMockDataset()) {
  const events = buildAccountingEvents(snapshot);
  const findings = runDeterministicAccountingRules(snapshot, events);
  const suggestedJEs = findings.map(finding => finding.suggested_je).filter(Boolean);
  const mockReviewDecisions = ['LOAN_DRAW_RECOGNITION','ACCRUAL_CANDIDATE','PROPERTY_TAX_ACCRUAL_REQUIRED'].map(ruleId => {
    const suggestedJe = suggestedJEs.find(je => je.ai_rule_id === ruleId);
    return { rule_id: ruleId, source_document_id: suggestedJe?.source_document_id, je_fingerprint: mockJeReviewFingerprint(suggestedJe), decision: 'APPROVED_FOR_MOCK_POSTING', actor: 'CONTROLLER_MOCK', reviewed_at: '2026-08-05T00:00:00.000Z' };
  });
  const reviewApprovedJEs = mockReviewDecisions.map(decision => {
    const suggested = suggestedJEs.find(je => je.ai_rule_id === decision.rule_id && je.source_document_id === decision.source_document_id);
    return retainMockReviewApproval({ suggestedJe: suggested, decision });
  }).filter(Boolean);
  const postedWbsJEs = approveAndPostSuggestedJEs({ suggestedJEs: reviewApprovedJEs, periods: snapshot.accountingPeriods });
  const postedJournalEntries = [...snapshot.journalEntries, ...postedWbsJEs].filter(je => je.posting_status === 'POSTED');
  const glLines = projectToGeneralLedger(postedJournalEntries);
  const tb = buildTrialBalance(glLines);
  const rows = tb.rows.map(row => ({
    ...row,
    account_type: normalType(row.account_code),
    presentation_amount: presentationAmount({ ...row, account_type: normalType(row.account_code) }),
  }));
  const byType = type => rows.filter(row => row.account_type === type);
  const total = type => money(byType(type).reduce((sum, row) => sum + row.presentation_amount, 0));
  const statement = {
    assets: total('ASSET'),
    liabilities: total('LIABILITY'),
    equity: total('EQUITY'),
    revenue: total('REVENUE'),
    expenses: total('EXPENSE'),
  };
  statement.netIncome = money(statement.revenue - statement.expenses);
  statement.balanceSheetRightSide = money(statement.liabilities + statement.equity + statement.netIncome);
  statement.balanceSheetTied = Math.abs(statement.assets - statement.balanceSheetRightSide) < 0.005;
  const sourceDocuments = new Map(snapshot.sourceDocuments.map(doc => [doc.id, doc]));
  const impactRows = glLines.map(line => {
    const accountType = normalType(line.account_code);
    const source = sourceDocuments.get(line.source_document_id);
    const signedAmount = money(Number(line.debit_amount || 0) - Number(line.credit_amount || 0));
    return {
      key: line.gl_line_id,
      statement: accountType === 'REVENUE' || accountType === 'EXPENSE' ? 'Income Statement' : 'Balance Sheet',
      account_code: line.account_code,
      account_type: accountType,
      amount: money(['ASSET', 'EXPENSE'].includes(accountType) ? signedAmount : -signedAmount),
      source_document_id: line.source_document_id,
      source_type: source?.document_type || 'RETAINED_SOURCE',
      je_number: line.je_number,
      entity_id: line.entity_id,
      control_state: source ? 'SOURCE_LINKED_POSTED' : 'SOURCE_REVIEW_REQUIRED',
    };
  });
  const cashLines = glLines.filter(line => line.account_code === ACCOUNT_MAP.cash);
  const cashFlow = {
    operating: money(cashLines.filter(line => !/LOAN/.test(line.source_document_id || '')).reduce((sum, line) => sum + line.debit_amount - line.credit_amount, 0)),
    financing: money(cashLines.filter(line => /LOAN/.test(line.source_document_id || '')).reduce((sum, line) => sum + line.debit_amount - line.credit_amount, 0)),
  };
  cashFlow.closingCash = money(cashFlow.operating + cashFlow.financing);
  const controls = [
    { control: 'Trial Balance', state: tb.balanced ? 'TIED' : 'REVIEW_REQUIRED', evidence: `${tb.total_debit.toFixed(2)} debit / ${tb.total_credit.toFixed(2)} credit` },
    { control: 'Balance Sheet', state: statement.balanceSheetTied ? 'TIED' : 'REVIEW_REQUIRED', evidence: `${statement.assets.toFixed(2)} assets / ${statement.balanceSheetRightSide.toFixed(2)} liabilities-equity-income` },
    { control: 'Posted-only projection', state: postedJournalEntries.every(je => je.posting_status === 'POSTED') ? 'TIED' : 'REVIEW_REQUIRED', evidence: `${postedJournalEntries.length} posted JEs included` },
    { control: 'Source trace', state: impactRows.every(row => row.control_state === 'SOURCE_LINKED_POSTED') ? 'TIED' : 'REVIEW_REQUIRED', evidence: `${impactRows.filter(row => row.source_document_id).length} source-linked GL lines` },
  ];
  return {
    mode: 'WBS_MOCK_POSTED_REPORT_IMPACT',
    snapshot,
    events,
    findings,
    mockReviewDecisions,
    postedWbsJEs,
    postedJournalEntries,
    glLines,
    trialBalance: { ...tb, rows },
    statement,
    cashFlow,
    impactRows,
    controls,
    boundaries: [
      'WBS mock only',
      'POSTED journal entries only',
      'No report export',
      'No automatic posting',
      'No real WBS call or signed receipt',
    ],
  };
}
