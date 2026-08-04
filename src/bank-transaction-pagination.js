export const BANK_TRANSACTION_PAGE_SIZE = 50;

export function pageBankTransactionEvidence(rows, page = 1, pageSize = BANK_TRANSACTION_PAGE_SIZE) {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, Number(page) || 1), pageCount);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    total,
    currentPage,
    pageCount,
    start: total === 0 ? 0 : start + 1,
    end: Math.min(start + pageSize, total),
  };
}
