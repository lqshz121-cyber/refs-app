BEGIN;

DO $migration$
BEGIN
  IF EXISTS(
    SELECT 1 FROM wbs_controlled_test_bank_import_row
    GROUP BY tenant_id,entity_id,source_record_hash
    HAVING count(DISTINCT bank_account_ref)>1
  ) THEN
    RAISE EXCEPTION 'Cannot restore global TEST_ONLY Bank source identity while cross-account hashes exist' USING ERRCODE='55006';
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  definition text;
  new_record constant text:='source_record_id:=''test-bank:''||lower(p_bank_account_ref)||'':''||substr(source_hash,8,24);';
  old_record constant text:='source_record_id:=''test-bank:''||substr(source_hash,8,24);';
  new_ref constant text:='source_ref:=''object://refs-test-only/''||p_entity||''/bank/''||lower(p_bank_account_ref)||''/''||substr(source_hash,8);';
  old_ref constant text:='source_ref:=''object://refs-test-only/''||p_entity||''/bank/''||substr(source_hash,8);';
  new_columns constant text:='INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,bank_account_ref,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)';
  old_columns constant text:='INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)';
  new_values constant text:='VALUES(p_tenant,p_entity,import_id,row_index,p_bank_account_ref,source_hash,original_date,posting_date,direction,signed_amount,raw_id,source_id,line_id,bank_id);';
  old_values constant text:='VALUES(p_tenant,p_entity,import_id,row_index,source_hash,original_date,posting_date,direction,signed_amount,raw_id,source_id,line_id,bank_id);';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) INTO definition;
  IF strpos(definition,new_record)=0 OR strpos(definition,new_ref)=0 OR strpos(definition,new_columns)=0 OR strpos(definition,new_values)=0 THEN
    RAISE EXCEPTION 'Unexpected account-scoped TEST_ONLY Bank source identity function' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,new_record,old_record);
  definition:=replace(definition,new_ref,old_ref);
  definition:=replace(definition,new_columns,old_columns);
  definition:=replace(definition,new_values,old_values);
  EXECUTE definition;
END;
$migration$;

ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_account_source_uq;
ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_account_fk;
ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT wbs_controlled_test_bank_import_row_account_check;
ALTER TABLE wbs_controlled_test_bank_import_row DROP COLUMN bank_account_ref;
ALTER TABLE wbs_controlled_test_bank_import_row
  ADD CONSTRAINT wbs_controlled_test_bank_import_row_source_record_hash_uq
  UNIQUE(tenant_id,entity_id,source_record_hash);
ALTER TABLE wbs_controlled_test_bank_import DROP CONSTRAINT wbs_controlled_test_bank_import_account_identity_uq;

REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) TO refs_app;

COMMIT;
