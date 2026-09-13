export type Money4 = `${number}.${string}`;

export interface JournalEvidence {
  journal_entry_id: string;
  currency: string;
}

export interface JournalLineEvidence {
  journal_line_id: string;
  ledger_line_id: string;
  account_code: string;
  debit_amount: string;
  credit_amount: string;
  source_document_ids: readonly string[];
}

export interface LedgerLineEvidence {
  journal_entry_id: string;
  journal_line_id: string;
  ledger_line_id: string;
  account_code: string;
  currency: string;
  debit_amount: string;
  credit_amount: string;
  source_document_ids: readonly string[];
}

const MONEY4 = /^-?(?:0|[1-9][0-9]{0,15})\.\d{4}$/;

export const exactLineageIdSet = (left: unknown, right: unknown): boolean => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  if (!left.every((value): value is string => typeof value === 'string')) return false;
  if (!right.every((value): value is string => typeof value === 'string')) return false;
  const sortedLeft=[...left].sort();
  const sortedRight=[...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
};

export const journalLineMatchesLedger = (
  journal: JournalEvidence | null | undefined,
  line: JournalLineEvidence | null | undefined,
  row: LedgerLineEvidence | null | undefined,
): boolean => Boolean(
  journal
  && line
  && row
  && journal.journal_entry_id === row.journal_entry_id
  && line.journal_line_id === row.journal_line_id
  && line.ledger_line_id === row.ledger_line_id
  && line.account_code === row.account_code
  && journal.currency === row.currency
  && MONEY4.test(line.debit_amount)
  && line.debit_amount === row.debit_amount
  && MONEY4.test(line.credit_amount)
  && line.credit_amount === row.credit_amount
  && exactLineageIdSet(line.source_document_ids, row.source_document_ids),
);