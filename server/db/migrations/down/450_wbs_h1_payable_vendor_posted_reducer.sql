BEGIN;

DO $migration$
DECLARE definition text;
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_vendor_posted_evidence) THEN
    RAISE EXCEPTION 'Posted vendor transfer history prevents migration 450 rollback' USING ERRCODE='55000';
  END IF;
  SELECT pg_get_functiondef('public.refs_create_wbs_h1_payable_reclass_draft(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position('baseline_vendor_member_ref,target_vendor_member_ref,bound_lines_hash)' IN definition)=0
     OR position('credit_member,refs_wbs_h1_reclass_lines_hash(p_tenant,p_entity,journal_id));' IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 450 down requires the bound-lines command' USING ERRCODE='55000';
  END IF;
  definition:=replace(definition,'baseline_vendor_member_ref,target_vendor_member_ref,bound_lines_hash)','baseline_vendor_member_ref,target_vendor_member_ref)');
  definition:=replace(definition,'credit_member,refs_wbs_h1_reclass_lines_hash(p_tenant,p_entity,journal_id));','credit_member);');
  EXECUTE definition;
END
$migration$;
DROP TRIGGER wbs_h1_payable_vendor_posted_reducer ON journal_entry;
DROP FUNCTION refs_apply_wbs_h1_payable_vendor_posted();
DROP TABLE wbs_h1_payable_vendor_posted_evidence;
ALTER TABLE wbs_h1_payable_reclass_draft_evidence DROP COLUMN bound_lines_hash;
ALTER TABLE wbs_h1_payable_reclass_draft_evidence DROP CONSTRAINT wbs_h1_payable_reclass_draft_scope_id_uq;
DROP FUNCTION refs_wbs_h1_reclass_lines_hash(uuid,uuid,uuid,boolean);

COMMIT;
