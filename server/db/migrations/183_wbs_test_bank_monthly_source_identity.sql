BEGIN;

-- A Provider Bank row can legitimately appear in the old July TEST_ONLY
-- account and in one H1 monthly account.  Retain the original Provider hash,
-- but make its TEST_ONLY persistence identity account-scoped.
ALTER TABLE wbs_controlled_test_bank_import
  ADD CONSTRAINT wbs_controlled_test_bank_import_account_identity_uq
  UNIQUE(tenant_id,entity_id,wbs_controlled_test_bank_import_id,bank_account_ref);

ALTER TABLE wbs_controlled_test_bank_import_row ADD COLUMN bank_account_ref text;
DROP TRIGGER wbs_controlled_test_bank_import_row_append_only ON wbs_controlled_test_bank_import_row;
UPDATE wbs_controlled_test_bank_import_row row_record
SET bank_account_ref=import_record.bank_account_ref
FROM wbs_controlled_test_bank_import import_record
WHERE import_record.tenant_id=row_record.tenant_id
  AND import_record.entity_id=row_record.entity_id
  AND import_record.wbs_controlled_test_bank_import_id=row_record.wbs_controlled_test_bank_import_id;
CREATE TRIGGER wbs_controlled_test_bank_import_row_append_only BEFORE UPDATE OR DELETE ON wbs_controlled_test_bank_import_row
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
ALTER TABLE wbs_controlled_test_bank_import_row ALTER COLUMN bank_account_ref SET NOT NULL;
ALTER TABLE wbs_controlled_test_bank_import_row
  ADD CONSTRAINT wbs_controlled_test_bank_import_row_account_check
  CHECK(bank_account_ref='WBS_TEST_BANK' OR bank_account_ref~'^WBS_TEST_BANK_2026_0[1-6]$');
ALTER TABLE wbs_controlled_test_bank_import_row
  ADD CONSTRAINT wbs_controlled_test_bank_import_row_account_fk
  FOREIGN KEY(tenant_id,entity_id,wbs_controlled_test_bank_import_id,bank_account_ref)
  REFERENCES wbs_controlled_test_bank_import(tenant_id,entity_id,wbs_controlled_test_bank_import_id,bank_account_ref);

DO $migration$
DECLARE constraint_name text;
BEGIN
  SELECT c.conname INTO STRICT constraint_name
  FROM pg_constraint c
  WHERE c.conrelid='wbs_controlled_test_bank_import_row'::regclass
    AND c.contype='u'
    AND pg_get_constraintdef(c.oid)='UNIQUE (tenant_id, entity_id, source_record_hash)';
  EXECUTE format('ALTER TABLE wbs_controlled_test_bank_import_row DROP CONSTRAINT %I',constraint_name);
END;
$migration$;

ALTER TABLE wbs_controlled_test_bank_import_row
  ADD CONSTRAINT wbs_controlled_test_bank_import_row_account_source_uq
  UNIQUE(tenant_id,entity_id,bank_account_ref,source_record_hash);

DO $migration$
DECLARE
  definition text;
  old_record constant text:='source_record_id:=''test-bank:''||substr(source_hash,8,24);';
  new_record constant text:='source_record_id:=''test-bank:''||lower(p_bank_account_ref)||'':''||substr(source_hash,8,24);';
  old_ref constant text:='source_ref:=''object://refs-test-only/''||p_entity||''/bank/''||substr(source_hash,8);';
  new_ref constant text:='source_ref:=''object://refs-test-only/''||p_entity||''/bank/''||lower(p_bank_account_ref)||''/''||substr(source_hash,8);';
  old_columns constant text:='INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)';
  new_columns constant text:='INSERT INTO wbs_controlled_test_bank_import_row(tenant_id,entity_id,wbs_controlled_test_bank_import_id,row_index,bank_account_ref,source_record_hash,original_transaction_date,posting_transaction_date,direction,signed_amount,raw_event_id,source_document_id,source_document_line_id,bank_source_id)';
  old_values constant text:='VALUES(p_tenant,p_entity,import_id,row_index,source_hash,original_date,posting_date,direction,signed_amount,raw_id,source_id,line_id,bank_id);';
  new_values constant text:='VALUES(p_tenant,p_entity,import_id,row_index,p_bank_account_ref,source_hash,original_date,posting_date,direction,signed_amount,raw_id,source_id,line_id,bank_id);';
BEGIN
  SELECT pg_get_functiondef('public.refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text)'::regprocedure) INTO definition;
  IF strpos(definition,old_record)=0 OR strpos(definition,old_ref)=0 OR strpos(definition,old_columns)=0 OR strpos(definition,old_values)=0 THEN
    RAISE EXCEPTION 'Unexpected controlled TEST_ONLY Bank source identity function' USING ERRCODE='22023';
  END IF;
  definition:=replace(definition,old_record,new_record);
  definition:=replace(definition,old_ref,new_ref);
  definition:=replace(definition,old_columns,new_columns);
  definition:=replace(definition,old_values,new_values);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_wbs_controlled_test_bank_scope(uuid,uuid,uuid,text,jsonb,text,text,text) TO refs_app;

COMMIT;
