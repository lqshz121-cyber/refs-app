// Bank queue status summary.
//
// Transaction queue status (Pending / Posted / Excluded) is a *bank review*
// dimension. It is deliberately independent of the reconciliation dimension
// (matched / cleared / signed-off): a Posted bank item is not cleared, and a
// cleared item is not signed off. This module only counts and labels; it never
// promotes, demotes, or couples the two dimensions.

export const BANK_QUEUE_SEGMENTS = Object.freeze([
  Object.freeze({ key: 'Review', label: 'Pending' }),
  Object.freeze({ key: 'Posted', label: 'Posted' }),
  Object.freeze({ key: 'Excluded', label: 'Excluded' }),
]);

export const BANK_QUEUE_DIMENSION_NOTE =
  'Queue status is the bank review dimension. Reconciliation (matched / cleared / signed-off) is a separate dimension and is never derived from it.';

export function formatQueueCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return '0';
  return String(Math.trunc(Math.abs(count))).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

// rows: evidence rows already scoped to the selected account/entity/filters.
// queueOf: reads the retained evidence queue for a row.
export function bankQueueSummary(rows = [], activeQueue = 'Review', queueOf = row => row?._state) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map(BANK_QUEUE_SEGMENTS.map(segment => [segment.key, 0]));
  let unclassified = 0;
  for (const row of list) {
    const key = queueOf(row);
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
    else unclassified += 1;
  }
  const selected = BANK_QUEUE_SEGMENTS.some(segment => segment.key === activeQueue) ? activeQueue : 'Review';
  return {
    activeQueue: selected,
    total: list.length,
    unclassified,
    dimensionNote: BANK_QUEUE_DIMENSION_NOTE,
    segments: BANK_QUEUE_SEGMENTS.map(segment => {
      const count = counts.get(segment.key) || 0;
      return {
        key: segment.key,
        label: segment.label,
        count,
        // QuickBooks renders the count inside the segment label, e.g. "Pending (1,402)".
        inlineLabel: `${segment.label} (${formatQueueCount(count)})`,
        selected: segment.key === selected,
      };
    }),
  };
}
