BEGIN;
LOCK TABLE journal_entry,unit_transfer_pair,unit_transfer_unit_control,unit_transfer_elimination_basis IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM unit_transfer_pair) OR EXISTS(SELECT 1 FROM unit_transfer_unit_control) OR EXISTS(SELECT 1 FROM unit_transfer_elimination_basis) THEN
  RAISE EXCEPTION 'Refusing to remove retained Unit Transfer evidence' USING ERRCODE='55000';
 END IF;
END $$;
DROP TRIGGER IF EXISTS unit_transfer_journal_transition_guard ON journal_entry;
DROP TRIGGER IF EXISTS unit_transfer_journal_insert_guard ON journal_entry;
DROP TRIGGER IF EXISTS unit_transfer_journal_line_guard ON journal_line;
DROP TRIGGER IF EXISTS unit_transfer_source_link_guard ON source_link;
DROP TRIGGER IF EXISTS unit_transfer_pair_protect ON unit_transfer_pair;
DROP TRIGGER IF EXISTS unit_transfer_unit_protect ON unit_transfer_unit_control;
REVOKE ALL ON FUNCTION
 refs_unit_transfer_cost_snapshot(uuid,uuid,date,text,text,char(3),text[],uuid),
 refs_create_unit_transfer_hash(uuid,uuid,uuid,uuid,uuid,date,text,uuid,uuid,bigint,text,text,text,numeric,uuid,text,uuid,text,text[],text,text,numeric,bigint,uuid[],text,text,text,text),
 refs_create_unit_transfer(uuid,uuid,uuid,uuid,uuid,date,text,uuid,uuid,bigint,text,text,text,numeric,uuid,text,uuid,text,text[],text,text,numeric,bigint,uuid[],text,text,text,text,text,text),
 refs_unit_transfer_transition_hash(uuid,uuid,uuid,text,bigint,bigint,bigint,text),refs_transition_unit_transfer_pair(uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text),
 refs_unit_transfer_cancel_hash(uuid,uuid,uuid,bigint,bigint,bigint,text),refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text),
 refs_unit_transfer_post_hash(uuid,uuid,uuid,bigint,bigint,bigint),refs_post_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text),
 refs_read_unit_transfer_create_options(uuid,uuid,uuid,uuid,date,uuid[]),
 refs_read_unit_transfer_pair(uuid,uuid,uuid),refs_read_unit_transfer_register(uuid,uuid,uuid,integer,date,uuid) FROM refs_app;
DROP FUNCTION refs_read_unit_transfer_register(uuid,uuid,uuid,integer,date,uuid);
DROP FUNCTION refs_read_unit_transfer_pair(uuid,uuid,uuid);
DROP FUNCTION refs_post_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text);
DROP FUNCTION refs_unit_transfer_post_hash(uuid,uuid,uuid,bigint,bigint,bigint);
DROP FUNCTION refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text);
DROP FUNCTION refs_unit_transfer_cancel_hash(uuid,uuid,uuid,bigint,bigint,bigint,text);
DROP FUNCTION refs_transition_unit_transfer_pair(uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text);
DROP FUNCTION refs_unit_transfer_transition_hash(uuid,uuid,uuid,text,bigint,bigint,bigint,text);
DROP FUNCTION refs_guard_unit_transfer_source_link_mutation();
DROP FUNCTION refs_guard_unit_transfer_journal_line_mutation();
DROP FUNCTION refs_guard_unit_transfer_journal_transition();
DROP FUNCTION refs_protect_unit_transfer_pair();
DROP FUNCTION refs_protect_unit_transfer_unit();
DROP FUNCTION refs_create_unit_transfer(uuid,uuid,uuid,uuid,uuid,date,text,uuid,uuid,bigint,text,text,text,numeric,uuid,text,uuid,text,text[],text,text,numeric,bigint,uuid[],text,text,text,text,text,text);
DROP FUNCTION refs_create_unit_transfer_hash(uuid,uuid,uuid,uuid,uuid,date,text,uuid,uuid,bigint,text,text,text,numeric,uuid,text,uuid,text,text[],text,text,numeric,bigint,uuid[],text,text,text,text);
DROP FUNCTION refs_read_unit_transfer_create_options(uuid,uuid,uuid,uuid,date,uuid[]);
DROP FUNCTION refs_unit_transfer_mapping_is_current(uuid,uuid,uuid,date);
DROP FUNCTION refs_unit_transfer_cost_snapshot(uuid,uuid,date,text,text,char(3),text[],uuid);
DROP FUNCTION refs_unit_transfer_attachment_ids_snapshot(uuid,uuid,uuid[]);
DROP FUNCTION refs_unit_transfer_attachment_snapshot(uuid,uuid,uuid);
DROP FUNCTION refs_unit_transfer_journal_snapshot(uuid,uuid,uuid);
DROP TABLE unit_transfer_internal_gate;
DROP TABLE unit_transfer_elimination_basis;
ALTER TABLE unit_transfer_unit_control DROP CONSTRAINT unit_transfer_unit_control_last_transfer_pair_tenant_fk;
DROP TABLE unit_transfer_pair;
DROP TABLE unit_transfer_unit_control;
UPDATE permission_catalog SET active=false,effective_to=COALESCE(effective_to,clock_timestamp()),version=version+1
 WHERE permission_code LIKE 'REAL_ESTATE.UNIT_TRANSFER.%';
DELETE FROM runtime_human_permission_authority WHERE permission_code IN(
 'REAL_ESTATE.UNIT_TRANSFER.CREATE','REAL_ESTATE.UNIT_TRANSFER.SUBMIT','REAL_ESTATE.UNIT_TRANSFER.REVIEW',
 'REAL_ESTATE.UNIT_TRANSFER.APPROVE','REAL_ESTATE.UNIT_TRANSFER.REJECT','REAL_ESTATE.UNIT_TRANSFER.CANCEL','REAL_ESTATE.UNIT_TRANSFER.POST');
COMMIT;
