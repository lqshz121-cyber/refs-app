BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM counterparty_change) OR EXISTS(SELECT 1 FROM member_master WHERE counterparty_version<>0) THEN
  RAISE EXCEPTION 'Counterparty changes or revisions exist; preserve history and roll forward' USING ERRCODE='55000';
 END IF;
END; $$;
DROP FUNCTION refs_review_counterparty_change(uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION refs_propose_counterparty_change(uuid,uuid,text,text,text,bigint,text,boolean,text,text);
DROP TABLE counterparty_change;
DROP TRIGGER counterparty_version_guard ON member_master;
DROP FUNCTION refs_counterparty_version_guard();
ALTER TABLE member_master DROP COLUMN counterparty_version;
DELETE FROM runtime_human_permission_authority WHERE permission_code IN ('MASTER.COUNTERPARTY.PROPOSE','MASTER.COUNTERPARTY.APPROVE');
DELETE FROM permission_catalog WHERE permission_code IN ('MASTER.COUNTERPARTY.PROPOSE','MASTER.COUNTERPARTY.APPROVE');
COMMIT;
