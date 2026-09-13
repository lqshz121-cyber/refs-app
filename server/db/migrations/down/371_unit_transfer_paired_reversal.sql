BEGIN;
LOCK TABLE journal_entry,unit_transfer_pair,unit_transfer_unit_control,unit_transfer_ic_open_item,unit_transfer_reversal_pair,unit_transfer_elimination_basis,unit_transfer_elimination_reversal_basis IN ACCESS EXCLUSIVE MODE;
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM unit_transfer_reversal_pair) OR EXISTS(SELECT 1 FROM unit_transfer_elimination_reversal_basis) OR EXISTS(SELECT 1 FROM unit_transfer_ic_open_item) OR EXISTS(SELECT 1 FROM journal_entry j WHERE j.reversal_of_id IN(SELECT source_journal_entry_id FROM unit_transfer_pair UNION ALL SELECT target_journal_entry_id FROM unit_transfer_pair)) THEN
  RAISE EXCEPTION 'Refusing to remove retained Unit Transfer reversal evidence' USING ERRCODE='55000';
 END IF;
END$$;

DROP TRIGGER IF EXISTS unit_transfer_reversal_source_link_guard ON source_link;
DROP TRIGGER IF EXISTS unit_transfer_reversal_journal_line_guard ON journal_line;
DROP TRIGGER IF EXISTS unit_transfer_reversal_pair_protect ON unit_transfer_reversal_pair;
DROP TRIGGER IF EXISTS unit_transfer_create_reversal_race_guard ON unit_transfer_pair;

DO $$DECLARE fn text;BEGIN
 fn:=pg_get_functiondef('refs_post_unit_transfer_pair_370(uuid,uuid,uuid,bigint,bigint,bigint,text,text)'::regprocedure);EXECUTE replace(fn,'public.refs_post_unit_transfer_pair_370(','public.refs_post_unit_transfer_pair(');
 fn:=pg_get_functiondef('refs_read_unit_transfer_pair_370(uuid,uuid,uuid)'::regprocedure);EXECUTE replace(fn,'public.refs_read_unit_transfer_pair_370(','public.refs_read_unit_transfer_pair(');
 fn:=pg_get_functiondef('refs_guard_unit_transfer_journal_transition_370()'::regprocedure);EXECUTE replace(fn,'public.refs_guard_unit_transfer_journal_transition_370()','public.refs_guard_unit_transfer_journal_transition()');
 fn:=pg_get_functiondef('refs_protect_unit_transfer_unit_370()'::regprocedure);EXECUTE replace(fn,'public.refs_protect_unit_transfer_unit_370()','public.refs_protect_unit_transfer_unit()');
END$$;
DROP FUNCTION refs_post_unit_transfer_pair_370(uuid,uuid,uuid,bigint,bigint,bigint,text,text);
DROP FUNCTION refs_read_unit_transfer_pair_370(uuid,uuid,uuid);
DROP FUNCTION refs_guard_unit_transfer_journal_transition_370();
DROP FUNCTION refs_protect_unit_transfer_unit_370();

REVOKE ALL ON FUNCTION refs_create_unit_transfer_reversal_pair_hash(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text),refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text),refs_unit_transfer_reversal_transition_hash(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text),refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text),refs_unit_transfer_reversal_cancel_hash(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text),refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text),refs_unit_transfer_reversal_post_hash(uuid,uuid,uuid,uuid,bigint,bigint,bigint),refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text),refs_read_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid) FROM refs_app;
DROP FUNCTION refs_read_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid);
DROP FUNCTION refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text);
DROP FUNCTION refs_post_unit_transfer_reversal_journal(uuid,uuid,uuid,uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION refs_unit_transfer_reversal_post_hash(uuid,uuid,uuid,uuid,bigint,bigint,bigint);
DROP FUNCTION refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text);
DROP FUNCTION refs_unit_transfer_reversal_cancel_hash(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text);
DROP FUNCTION refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text);
DROP FUNCTION refs_unit_transfer_reversal_transition_hash(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text);
DROP FUNCTION refs_protect_unit_transfer_reversal_pair();
DROP FUNCTION refs_guard_unit_transfer_reversal_source_link();
DROP FUNCTION refs_guard_unit_transfer_reversal_line();
DROP FUNCTION refs_guard_unit_transfer_create_against_reversal();
DROP FUNCTION refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text);
DROP FUNCTION refs_create_unit_transfer_reversal_pair_hash(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text);
DROP FUNCTION refs_unit_transfer_can_reverse(uuid,unit_transfer_pair,unit_transfer_unit_control);
DROP FUNCTION refs_unit_transfer_reversal_source_net(uuid,unit_transfer_pair,text,date);
DROP FUNCTION refs_unit_transfer_reversal_target_cost_snapshot(uuid,unit_transfer_pair,text,date);
DROP FUNCTION refs_unit_transfer_ic_has_later_activity(uuid,unit_transfer_ic_open_item,unit_transfer_ic_open_item);

ALTER TABLE unit_transfer_unit_control DROP CONSTRAINT unit_transfer_unit_control_last_reversal_tenant_fk;
ALTER TABLE unit_transfer_unit_control DROP COLUMN last_transfer_reversal_id;
ALTER TABLE unit_transfer_internal_gate DROP CONSTRAINT unit_transfer_internal_gate_resource_kind_check;
ALTER TABLE unit_transfer_internal_gate ADD CONSTRAINT unit_transfer_internal_gate_resource_kind_check CHECK(resource_kind IN('JOURNAL','PAIR','UNIT'));
DROP TABLE unit_transfer_elimination_reversal_basis;
ALTER TABLE unit_transfer_elimination_basis DROP CONSTRAINT unit_transfer_elimination_basis_tenant_id_uq;
DROP TABLE unit_transfer_reversal_pair;
DROP TRIGGER unit_transfer_ic_open_item_protect ON unit_transfer_ic_open_item;
DROP FUNCTION refs_protect_unit_transfer_ic_open_item();
DROP TABLE unit_transfer_ic_open_item;
DELETE FROM runtime_human_permission_authority WHERE permission_code='REAL_ESTATE.UNIT_TRANSFER.REVERSE';
DELETE FROM permission_catalog WHERE permission_code='REAL_ESTATE.UNIT_TRANSFER.REVERSE';
COMMIT;
