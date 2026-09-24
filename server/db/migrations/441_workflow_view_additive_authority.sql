BEGIN;

-- Same defect and same fix as 412 (recurring schedule), for the four other workflows whose commands
-- assert their own READ-class VIEW permission next to the action permission (found by the
-- postgres-kernel intercompany elimination lifecycle test, then by a catalog-wide scan, 2026-09-24):
--
--   refs_create_consolidation_configuration  CONFIG.CREATE (DRAFT)  + CONFIG.VIEW (READ)
--   refs_create_intercompany_elimination     ELIMINATION.CREATE     + ELIMINATION.VIEW
--   refs_create_webhook_subscription         WEBHOOK.CREATE         + WEBHOOK.VIEW
--   refs_create_forecast_workflow            FORECAST.CREATE        + FORECAST.VIEW
--
-- A human grant carries exactly one authority class, so no actor could hold both and every one of
-- these commands (and their transitions, which assert VIEW the same way) failed with 42501 for any
-- real grant. The VIEW permission becomes additive to exactly the classes of its own workflow; no
-- class gains any other permission, and SoD between classes is unchanged.
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(
    (permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'))
    OR (permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
    OR (permission_code='RECURRING.SCHEDULE.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','REVIEW','SCHEDULE'))
    OR (permission_code='GROUP.CONSOLIDATION.CONFIG.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
    OR (permission_code='GROUP.INTERCOMPANY_ELIMINATION.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
    OR (permission_code='INTEGRATION.WEBHOOK.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','JE_REVIEW'))
    OR (permission_code='REPORT.FORECAST.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
  );
INSERT INTO runtime_human_additive_permission_authority(permission_code,authority_class) VALUES
  ('GROUP.CONSOLIDATION.CONFIG.VIEW','DRAFT'),
  ('GROUP.CONSOLIDATION.CONFIG.VIEW','SUBMIT'),
  ('GROUP.CONSOLIDATION.CONFIG.VIEW','APPROVE'),
  ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','DRAFT'),
  ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','SUBMIT'),
  ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','REVIEW'),
  ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','APPROVE'),
  ('GROUP.INTERCOMPANY_ELIMINATION.VIEW','POST'),
  ('INTEGRATION.WEBHOOK.VIEW','DRAFT'),
  ('INTEGRATION.WEBHOOK.VIEW','SUBMIT'),
  ('INTEGRATION.WEBHOOK.VIEW','APPROVE'),
  ('INTEGRATION.WEBHOOK.VIEW','JE_REVIEW'),
  ('REPORT.FORECAST.VIEW','DRAFT'),
  ('REPORT.FORECAST.VIEW','SUBMIT'),
  ('REPORT.FORECAST.VIEW','APPROVE')
ON CONFLICT DO NOTHING;

COMMIT;
