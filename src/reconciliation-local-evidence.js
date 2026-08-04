const amount = value => +(value || 0);
const signedBankAmount = transaction => transaction.direction === 'CREDIT' ? amount(transaction.amount) : -amount(transaction.amount);

// This verifies retained local evidence. It never fetches bank data, changes
// matching, posts an entry, or infers a reconciliation outcome from POSTED.
export function localReconciliationEvidence({ accountCode, bankAccount, journals = [], bankAccountMaster = [] } = {}) {
  const master = bankAccountMaster.find(row => row.bank_account_code === accountCode) || null;
  const cashAccountCode = master?.gl_account_code || null;
  const entityId = master?.entity_id || null;
  const throughDate = bankAccount?.stmt_date || '';
  const posted = journals.filter(journal => journal.posting_status === 'POSTED'
    && (!entityId || journal.entity_id === entityId)
    && (!throughDate || journal.je_date <= throughDate));
  const localBookBalance = cashAccountCode ? posted.reduce((sum, journal) => sum + (journal.lines || []).filter(line => line.account_code === cashAccountCode).reduce((lineSum, line) => lineSum + amount(line.debit_amount) - amount(line.credit_amount), 0), 0) : null;
  const matched = (bankAccount?.txns || []).filter(transaction => transaction.match_status === 'MATCHED').map(transaction => {
    const journal = posted.find(row => row.je_number === transaction.matched_je) || null;
    const cashAmount = journal && cashAccountCode ? (journal.lines || []).filter(line => line.account_code === cashAccountCode).reduce((sum, line) => sum + amount(line.debit_amount) - amount(line.credit_amount), 0) : null;
    const expectedAmount = signedBankAmount(transaction);
    const state = !cashAccountCode ? 'MISSING_GL_MAPPING'
      : !journal ? 'MISSING_OR_UNPOSTED_JE'
      : Math.abs(cashAmount - expectedAmount) >= 0.005 ? 'CASH_AMOUNT_MISMATCH'
      : 'VERIFIED_LOCAL_MATCH';
    return { transaction, journal, cashAmount, expectedAmount, state };
  });
  const invalidMatches = matched.filter(row => row.state !== 'VERIFIED_LOCAL_MATCH');
  const storedBookBalance = bankAccount ? amount(bankAccount.gl_book_balance) : null;
  const bookBalanceAligned = cashAccountCode !== null && Math.abs(localBookBalance - storedBookBalance) < 0.005;
  return { master, cashAccountCode, entityId, throughDate, localBookBalance, storedBookBalance, bookBalanceAligned, matched, invalidMatches };
}

export function localReconciliationReadiness(baseStatus, evidence) {
  if (baseStatus?.signedHistory) return { canSign:false, reason:'ALREADY_SIGNED' };
  if (!evidence?.master) return { canSign:false, reason:'MISSING_LOCAL_ACCOUNT_MAPPING' };
  if (evidence.master.cash_scope !== 'Operating') return { canSign:false, reason:'NON_OPERATING_CASH_SCOPE' };
  if (!evidence.cashAccountCode) return { canSign:false, reason:'MISSING_GL_MAPPING' };
  if (evidence.invalidMatches.length) return { canSign:false, reason:'UNVERIFIED_MATCHED_ACTIVITY' };
  if (!evidence.bookBalanceAligned) return { canSign:false, reason:'LOCAL_LEDGER_MISMATCH' };
  if (!baseStatus?.canSign) return { canSign:false, reason:baseStatus?.reason || 'NOT_READY' };
  return { canSign:true, reason:null };
}

export function localReconciliationPhase(baseStatus, readiness, evidence = null) {
  if (baseStatus?.signedHistory) return 'SIGNED_OFF';
  if (!evidence?.master || !evidence?.cashAccountCode || !evidence?.throughDate) return 'DRAFT';
  if (readiness?.canSign) return 'BALANCED';
  return 'IN_REVIEW';
}

// Presentation-only reconciliation worksheet. It describes the selected
// local account/statement scope and never clears an item or writes an entry.
export function localReconciliationWorksheet({ accountCode, bankAccount, baseStatus, evidence, readiness, phase } = {}) {
  const matchedCount = evidence?.matched?.length || 0;
  const invalidMatchCount = evidence?.invalidMatches?.length || 0;
  const unmatchedCount = baseStatus?.unmatched?.length || 0;
  const outstandingChecks = bankAccount?.outstanding_checks || [];
  const depositsInTransit = bankAccount?.deposits_in_transit || [];
  return {
    scope: {
      accountCode: accountCode || null,
      entityId: evidence?.entityId || null,
      cashScope: evidence?.master?.cash_scope || null,
      period: bankAccount?.period || null,
      statementDate: bankAccount?.stmt_date || null,
      statementBeginning: amount(bankAccount?.stmt_begin),
      statementEnding: amount(bankAccount?.stmt_end),
    },
    clearing: {
      matchedCount,
      invalidMatchCount,
      unmatchedCount,
      outstandingCheckCount: outstandingChecks.length,
      depositInTransitCount: depositsInTransit.length,
    },
    balances: {
      adjustedBank: amount(baseStatus?.adjustedBank),
      adjustedBook: amount(baseStatus?.adjustedBook),
      difference: amount(baseStatus?.diff),
    },
    phase: phase || localReconciliationPhase(baseStatus, readiness, evidence),
    closeState: readiness?.canSign ? 'READY_TO_SIGN_OFF' : (baseStatus?.signedHistory ? 'SIGNED_OFF' : 'BLOCKED'),
    closeReason: readiness?.reason || null,
  };
}

// A read-only report bridge. Matched, cleared, and signed-off are deliberately
// separate facts: this helper never upgrades one fact into another or changes
// a bank item/reconciliation/JE. It only exposes retained evidence that is
// compatible with a selected GL/TB entity, cutoff, and dimension scope.
export function localReconciliationGlTbBridgeEvidence({ bankAccounts = {}, history = [], journals = [], bankAccountMaster = [], entityId = null, asOfDate = '', propertyId = 'ALL', projectId = 'ALL' } = {}) {
  const wantedProperty = String(propertyId || 'ALL');
  const wantedProject = String(projectId || 'ALL');
  const rows = [];
  Object.entries(bankAccounts || {}).forEach(([accountCode, bankAccount]) => {
    const evidence = localReconciliationEvidence({accountCode,bankAccount,journals,bankAccountMaster});
    if (entityId && evidence.entityId !== entityId) return;
    const signedEntry = (history || []).find(entry => entry.account === accountCode && entry.period === bankAccount?.period && entry.stmt_date === bankAccount?.stmt_date && entry.reopen_state !== 'REOPENED') || null;
    const reopenedWithoutAudit = (history || []).find(entry => entry.account === accountCode && entry.period === bankAccount?.period && entry.stmt_date === bankAccount?.stmt_date && entry.reopen_state === 'REOPENED' && !entry.reopen_requested_by) || null;
    evidence.matched.forEach(item => {
      const cashLines = (item.journal?.lines || []).filter(line => line.account_code === evidence.cashAccountCode);
      const dimensionsMatch = (!wantedProperty || wantedProperty === 'ALL' || cashLines.some(line => String(line.property_id) === wantedProperty))
        && (!wantedProject || wantedProject === 'ALL' || cashLines.some(line => String(line.project_id) === wantedProject));
      const bankAfterCutoff = Boolean(asOfDate && item.transaction?.txn_date && item.transaction.txn_date > asOfDate);
      const state = evidence.master?.cash_scope !== 'Operating' ? 'NON_OPERATING_CASH_SCOPE_REVIEW'
        : item.state !== 'VERIFIED_LOCAL_MATCH' ? item.state
        : !dimensionsMatch ? 'DIMENSION_SCOPE_REVIEW'
        : bankAfterCutoff ? 'BANK_DATE_AFTER_CUTOFF_REVIEW'
        : reopenedWithoutAudit ? 'REOPEN_AUDIT_MISSING_REVIEW'
        : 'RETAINED_BANK_GL_EVIDENCE';
      rows.push({
        key:`${accountCode}:${item.transaction?.bank_txn_id || item.transaction?.external_id || rows.length}`,
        accountCode, entityId:evidence.entityId, cashScope:evidence.master?.cash_scope || null,
        statementDate:bankAccount?.stmt_date || null, bankTransaction:item.transaction, journal:item.journal,
        matched:item.transaction?.match_status === 'MATCHED', cleared:item.transaction?.cleared === true,
        signedOff:Boolean(signedEntry), signedAt:signedEntry?.at || null, state,
        reason:state === 'RETAINED_BANK_GL_EVIDENCE' ? 'Retained matched bank and posted cash JE evidence; clear/sign-off states are shown independently.' : state,
      });
    });
  });
  const reviewRows = rows.filter(row => row.state !== 'RETAINED_BANK_GL_EVIDENCE');
  return {rows,reviewRows,state:reviewRows.length ? 'LOCAL_BANK_GL_TB_REVIEW' : 'LOCAL_BANK_GL_TB_EVIDENCE_RETAINED'};
}
