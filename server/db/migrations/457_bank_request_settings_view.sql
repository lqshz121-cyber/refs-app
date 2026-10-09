BEGIN;
-- Add only workflow VIEW to bounded request authority, preserving all prior
-- approved additive pairings. No lifecycle command is made additive.
ALTER TABLE runtime_human_additive_permission_authority DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(
 (permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'))
 OR(permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST','BANK_IMPORT_REQUEST'))
 OR(permission_code='RECURRING.SCHEDULE.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','REVIEW','SCHEDULE'))
 OR(permission_code='GROUP.CONSOLIDATION.CONFIG.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
 OR(permission_code='GROUP.INTERCOMPANY_ELIMINATION.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
 OR(permission_code='INTEGRATION.WEBHOOK.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','JE_REVIEW'))
 OR(permission_code='REPORT.FORECAST.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
 OR(permission_code='REPORT.SAVED_VIEW.VIEW' AND authority_class IN('DRAFT','REVIEW'))
);
INSERT INTO runtime_human_additive_permission_authority(permission_code,authority_class)
VALUES('ACCOUNTING.SETTINGS.WORKFLOW.VIEW','BANK_IMPORT_REQUEST');
COMMIT;
