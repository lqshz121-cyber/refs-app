BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM payment_occurrence WHERE occurrence_kind IN ('AP_PAYMENT','AR_RECEIPT')) THEN
    RAISE EXCEPTION 'Cannot roll back native settlement bank-account control after settlement evidence exists';
  END IF;
  RAISE EXCEPTION 'Native settlement function replacement cannot be rolled back because migration 305 is retained as immutable historical evidence';
END;
$$;

COMMIT;