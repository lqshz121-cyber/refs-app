BEGIN;

LOCK TABLE runtime_grant_sync_receipt IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_grant_sync_receipt
    WHERE grant_policy_version='SOD_FINITE_V2' AND authority_class='ADJUSTMENT'
      AND response_body->'permissions' ? 'ATTACHMENT.CREATE')
    OR EXISTS(SELECT 1 FROM runtime_actor_grant
      WHERE authority_class='ADJUSTMENT' AND permission='ATTACHMENT.CREATE') THEN
    RAISE EXCEPTION 'Cannot remove credit entry upload authority with retained grant evidence' USING ERRCODE='55006';
  END IF;
END; $$;
DELETE FROM runtime_human_additive_permission_authority
  WHERE permission_code='ATTACHMENT.CREATE' AND authority_class='ADJUSTMENT';
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check
  CHECK(permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT'));

COMMIT;
