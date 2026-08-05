BEGIN;

DROP TRIGGER IF EXISTS bank_match_signed_reconciliation_guard ON bank_match;
DROP FUNCTION IF EXISTS refs_block_signed_reconciliation_match_change();
DROP FUNCTION IF EXISTS refs_transition_reconciliation(uuid,uuid,uuid,text,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_reconciliation_transition_hash(uuid,uuid,uuid,text,bigint,text);
DROP FUNCTION IF EXISTS refs_set_reconciliation_clearance(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text,text,text);
DROP FUNCTION IF EXISTS refs_reconciliation_clearance_hash(uuid,uuid,uuid,uuid,bigint,bigint,boolean,text);
DROP FUNCTION IF EXISTS refs_start_reconciliation(uuid,uuid,text,date,numeric,numeric,text,text,text);
DROP FUNCTION IF EXISTS refs_reconciliation_start_hash(uuid,uuid,text,date,numeric,numeric,text);
DROP TABLE IF EXISTS reconciliation_snapshot;
DROP INDEX IF EXISTS reconciliation_one_open_account_uq;
DROP TABLE IF EXISTS reconciliation_item;
ALTER TABLE reconciliation
  DROP CONSTRAINT IF EXISTS reconciliation_reopened_ck,
  DROP CONSTRAINT IF EXISTS reconciliation_reviewed_ck,
  DROP CONSTRAINT IF EXISTS reconciliation_started_ck,
  DROP COLUMN IF EXISTS review_reason,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by,
  DROP COLUMN IF EXISTS started_at,
  DROP COLUMN IF EXISTS started_by,
  DROP COLUMN IF EXISTS currency,
  DROP COLUMN IF EXISTS book_ending_balance,
  DROP COLUMN IF EXISTS statement_opening_balance;
DELETE FROM permission_catalog WHERE permission_code IN (
  'BANK.RECONCILIATION.START','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REVIEW',
  'BANK.RECONCILIATION.SIGN_OFF','BANK.RECONCILIATION.REOPEN'
);

COMMIT;
