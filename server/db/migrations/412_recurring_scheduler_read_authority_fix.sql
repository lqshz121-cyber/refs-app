BEGIN;

-- A lifecycle role must be able to read the exact recurring schedule it acts on
-- without acquiring a second authority class.
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(
    (permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'))
    OR (permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
    OR (permission_code='RECURRING.SCHEDULE.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','REVIEW','SCHEDULE'))
  );
INSERT INTO runtime_human_additive_permission_authority(permission_code,authority_class) VALUES
  ('RECURRING.SCHEDULE.VIEW','DRAFT'),('RECURRING.SCHEDULE.VIEW','SUBMIT'),
  ('RECURRING.SCHEDULE.VIEW','APPROVE'),('RECURRING.SCHEDULE.VIEW','REVIEW'),
  ('RECURRING.SCHEDULE.VIEW','SCHEDULE')
ON CONFLICT DO NOTHING;

COMMIT;
