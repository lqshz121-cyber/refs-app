BEGIN;

LOCK TABLE runtime_auth_context IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM runtime_auth_context WHERE revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Cannot remove context additive-authority guard with active contexts' USING ERRCODE='55006';
  END IF;
END; $$;

-- The predecessor guard remains installed until all active contexts are gone;
-- rollback is deliberately denied above when its behavior could matter.
COMMIT;
