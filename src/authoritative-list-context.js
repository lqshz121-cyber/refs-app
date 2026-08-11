const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const DEFAULT_AUTHORITATIVE_LIST_VIEW = Object.freeze({
  query: '',
  status: 'ALL',
  transactionType: 'ALL',
  from: '',
  through: '',
  counterparty: 'ALL',
  accountCode: 'ALL',
  page: 1,
  pageSize: 25,
});

const cleanDate = value => ISO_DATE.test(String(value || '')) ? String(value) : '';
const cleanText = (value, max = 128) => String(value || '').trim().slice(0, max);

export const normalizeAuthoritativeListView = value => {
  const page = Number(value?.page);
  const pageSize = Number(value?.pageSize);
  return {
    query: cleanText(value?.query),
    status: /^[A-Z][A-Z0-9_]{0,63}$/.test(String(value?.status || '')) ? String(value.status) : 'ALL',
    transactionType: ['ALL','BILLS','VENDOR_CREDITS'].includes(String(value?.transactionType || '')) ? String(value.transactionType) : 'ALL',
    from: cleanDate(value?.from),
    through: cleanDate(value?.through),
    counterparty: cleanText(value?.counterparty, 128) || 'ALL',
    accountCode: /^[A-Za-z0-9._-]{1,64}$/.test(String(value?.accountCode || '')) ? String(value.accountCode) : 'ALL',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100 ? pageSize : 25,
  };
};

const searchable = row => Object.values(row || {})
  .filter(value => typeof value === 'string' || typeof value === 'number')
  .join(' ')
  .toLocaleLowerCase('en-US');

// Counterparty and offset-account filters are deliberately opt-in. AP/AR
// document readers retain those facts, while adjustment readers do not.
export const filterAuthoritativeRows = (rows, view, dateField, { counterpartyField = null, accountField = null } = {}) => {
  const state = normalizeAuthoritativeListView(view);
  const query = state.query.toLocaleLowerCase('en-US');
  return (Array.isArray(rows) ? rows : []).filter(row => {
    const rowDate = cleanDate(row?.[dateField]);
    if (query && !searchable(row).includes(query)) return false;
    if (state.status === 'REVIEW_REQUIRED' && !['PENDING_REVIEW','PENDING_APPROVAL'].includes(row?.status)) return false;
    if (state.status !== 'ALL' && state.status !== 'REVIEW_REQUIRED' && row?.status !== state.status) return false;
    if (state.from && (!rowDate || rowDate < state.from)) return false;
    if (state.through && (!rowDate || rowDate > state.through)) return false;
    if (counterpartyField && state.counterparty !== 'ALL' && row?.[counterpartyField] !== state.counterparty) return false;
    if (accountField && state.accountCode !== 'ALL' && row?.[accountField] !== state.accountCode) return false;
    return true;
  });
};

export const paginateAuthoritativeRows = (rows, view) => {
  const state = normalizeAuthoritativeListView(view);
  const pageCount = Math.max(1, Math.ceil((rows?.length || 0) / state.pageSize));
  const page = Math.min(state.page, pageCount);
  const start = (page - 1) * state.pageSize;
  return { rows:(rows || []).slice(start, start + state.pageSize), page, pageCount, total:rows?.length || 0 };
};

export const authoritativeEvidenceKey = (kind, row) => {
  const raw = kind === 'adjustment'
    ? row?.business_adjustment_id
    : row?.business_document_id;
  return typeof raw === 'string' && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null;
};

export const createAuthoritativeReturnContext = ({ config, view, focusId, scrollY = 0 }) => {
  if (!config?.entityId || !config?.periodId || typeof focusId !== 'string' || !focusId) return null;
  return Object.freeze({
    entityId: config.entityId,
    periodId: config.periodId,
    view: Object.freeze(normalizeAuthoritativeListView(view)),
    focusId,
    scrollY: Number.isFinite(scrollY) && scrollY >= 0 ? scrollY : 0,
  });
};

export const restoreAuthoritativeReturnContext = (environment, config, context) => {
  if (!context || context.entityId !== config?.entityId || context.periodId !== config?.periodId) return false;
  const restore = () => {
    try { environment?.scrollTo?.({ top:context.scrollY, behavior:'auto' }); } catch { /* non-fatal presentation restore */ }
    try { environment?.document?.getElementById?.(context.focusId)?.focus?.(); } catch { /* non-fatal focus restore */ }
  };
  try { environment?.setTimeout?.(restore, 0); }
  catch { restore(); }
  return true;
};
