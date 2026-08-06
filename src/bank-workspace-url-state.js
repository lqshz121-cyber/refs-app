// Deep-link state for the Bank transactions workspace.
//
// This module encodes and decodes *presentation and navigation* state only:
// selected bank account, entity scope, queue tab, search text, date range,
// transaction direction filter, page, and the focused bank item.
//
// It intentionally carries no accounting value. A URL can never assert a
// match, a clearing state, a sign-off, a posting status, or an authorization
// result; every decoded value is re-validated against retained local evidence
// and the caller's existing permissions before anything is rendered.

export const BANK_WORKSPACE_QUEUES = ['Review', 'Posted', 'Excluded'];
export const BANK_WORKSPACE_DATE_RANGES = ['All dates', 'This month', 'Last 90 days', 'Custom range'];
export const BANK_WORKSPACE_TYPES = ['All transactions', 'Money in', 'Money out'];

export const BANK_WORKSPACE_URL_PARAMS = Object.freeze({
  acctCode: 'acct',
  entityId: 'entity',
  queue: 'queue',
  query: 'q',
  dateRange: 'dates',
  dateFrom: 'from',
  dateTo: 'to',
  type: 'type',
  page: 'page',
  bankTxnId: 'txn',
});

export const BANK_WORKSPACE_URL_DEFAULTS = Object.freeze({
  acctCode: '',
  entityId: '',
  queue: 'Review',
  query: '',
  dateRange: 'All dates',
  dateFrom: '',
  dateTo: '',
  type: 'All transactions',
  page: 1,
  bankTxnId: '',
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = value => (value == null ? '' : String(value)).trim();
const oneOf = (value, allowed, fallback) => (allowed.includes(text(value)) ? text(value) : fallback);
// A date filter must be a real calendar date, not merely ISO-shaped.
const isoDate = value => {
  const candidate = text(value);
  if (!ISO_DATE.test(candidate)) return '';
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? '' : candidate;
};
const pageNumber = value => {
  const parsed = Number.parseInt(text(value), 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
};

// Fail closed: any unknown, malformed, or hostile parameter collapses to the
// default view rather than widening scope.
export function normalizeBankWorkspaceUrlState(state = {}) {
  return {
    acctCode: text(state.acctCode),
    entityId: text(state.entityId),
    queue: oneOf(state.queue, BANK_WORKSPACE_QUEUES, BANK_WORKSPACE_URL_DEFAULTS.queue),
    query: text(state.query),
    dateRange: oneOf(state.dateRange, BANK_WORKSPACE_DATE_RANGES, BANK_WORKSPACE_URL_DEFAULTS.dateRange),
    dateFrom: isoDate(state.dateFrom),
    dateTo: isoDate(state.dateTo),
    type: oneOf(state.type, BANK_WORKSPACE_TYPES, BANK_WORKSPACE_URL_DEFAULTS.type),
    page: pageNumber(state.page),
    bankTxnId: text(state.bankTxnId),
  };
}

export function encodeBankWorkspaceUrlState(state = {}) {
  const normalized = normalizeBankWorkspaceUrlState(state);
  const pairs = [];
  for (const [field, param] of Object.entries(BANK_WORKSPACE_URL_PARAMS)) {
    const value = normalized[field];
    if (value === BANK_WORKSPACE_URL_DEFAULTS[field]) continue;
    pairs.push(`${param}=${encodeURIComponent(String(value))}`);
  }
  return pairs.join('&');
}

const readSearch = search => {
  const raw = text(search).replace(/^[?#]/, '');
  const found = new Map();
  for (const chunk of raw.split('&')) {
    if (!chunk) continue;
    const index = chunk.indexOf('=');
    const key = index < 0 ? chunk : chunk.slice(0, index);
    const value = index < 0 ? '' : chunk.slice(index + 1);
    let decoded = '';
    try { decoded = decodeURIComponent(value.replace(/\+/g, ' ')); } catch { decoded = ''; }
    if (!found.has(key)) found.set(key, decoded);
  }
  return found;
};

export function decodeBankWorkspaceUrlState(search = '') {
  const found = readSearch(search);
  const draft = {};
  for (const [field, param] of Object.entries(BANK_WORKSPACE_URL_PARAMS)) {
    draft[field] = found.has(param) ? found.get(param) : BANK_WORKSPACE_URL_DEFAULTS[field];
  }
  return normalizeBankWorkspaceUrlState(draft);
}

// True when the address bar actually carries a Bank workspace scope worth
// restoring. An empty query must not overwrite in-app navigation context.
export function hasBankWorkspaceUrlState(search = '') {
  const found = readSearch(search);
  return Object.values(BANK_WORKSPACE_URL_PARAMS).some(param => found.has(param));
}

export function bankWorkspaceUrlSearch(state = {}) {
  const encoded = encodeBankWorkspaceUrlState(state);
  return encoded ? `?${encoded}` : '';
}

// Navigation context shape consumed by the existing goto()/navContext plumbing.
export function bankWorkspaceNavContext(state = {}) {
  const normalized = normalizeBankWorkspaceUrlState(state);
  return {
    route: 'banktx',
    acctCode: normalized.acctCode || undefined,
    entityId: normalized.entityId || undefined,
    queue: normalized.queue,
    query: normalized.query,
    dateRange: normalized.dateRange,
    dateFrom: normalized.dateFrom,
    dateTo: normalized.dateTo,
    type: normalized.type,
    page: normalized.page,
    bankTxnId: normalized.bankTxnId || undefined,
  };
}

export function bankWorkspaceUrlScopeLabel(state = {}) {
  const normalized = normalizeBankWorkspaceUrlState(state);
  const range = normalized.dateRange === 'Custom range'
    ? `${normalized.dateFrom || 'open start'} to ${normalized.dateTo || 'open end'}`
    : normalized.dateRange;
  return `Account ${normalized.acctCode || 'unselected'} · entity ${normalized.entityId || 'all'} · ${normalized.queue} · ${range} · ${normalized.type} · page ${normalized.page}`;
}
