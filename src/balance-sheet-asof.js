export function postedJournalEntriesAsOf(journals = [], { entityId = null, toPeriod = '' } = {}) {
  return journals.filter(journal => journal.posting_status === 'POSTED'
    && (!entityId || journal.entity_id === entityId)
    && (!toPeriod || journal.period_code <= toPeriod));
}
