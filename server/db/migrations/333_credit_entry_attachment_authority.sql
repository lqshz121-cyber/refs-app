BEGIN;

-- Credit-entry support follows the same anchored compatibility rule as other
-- entry roles. It does not authorize allocation, refund, review or posting.
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check
  CHECK(permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'));
INSERT INTO runtime_human_additive_permission_authority(permission_code,authority_class)
  VALUES('ATTACHMENT.CREATE','ADJUSTMENT');

COMMIT;
