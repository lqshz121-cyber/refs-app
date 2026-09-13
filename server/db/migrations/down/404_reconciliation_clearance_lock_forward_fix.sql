BEGIN;
DO $$
BEGIN
  RAISE EXCEPTION 'Reconciliation clearance lock forward fix cannot be rolled back because it replaces immutable historical function definitions';
END;
$$;
COMMIT;
