BEGIN;

LOCK TABLE runtime_grant_sync_receipt IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS(
    SELECT 1
    FROM runtime_grant_sync_receipt r
    WHERE r.grant_policy_version='SOD_FINITE_V2'
      AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(r.response_body->'permissions','[]'::jsonb)) p
        WHERE p#>>'{}'='RECURRING.SCHEDULE.VIEW'
      )
      AND r.authority_class IN('DRAFT','SUBMIT','APPROVE','REVIEW','SCHEDULE')
  ) THEN
    RAISE EXCEPTION 'Cannot remove recurring schedule read authority with retained grant evidence' USING ERRCODE='55006';
  END IF;
END; $$;

DELETE FROM runtime_human_additive_permission_authority WHERE permission_code='RECURRING.SCHEDULE.VIEW';
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(
    (permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'))
    OR (permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
  );

COMMIT;
