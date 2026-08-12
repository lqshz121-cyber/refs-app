BEGIN;
DO $$ BEGIN
  IF to_regclass('public.wbs_payable_attachment_upload_intent') IS NOT NULL
    AND EXISTS(SELECT 1 FROM wbs_payable_attachment_upload_intent) THEN
    RAISE EXCEPTION 'Cannot remove retained WBS Payable attachment upload intent evidence';
  END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_uploaded_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_uploaded_attachment_hash(uuid,uuid,uuid,uuid,bigint,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_wbs_payable_attachment_uploads(uuid,uuid,uuid) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_reserve_wbs_payable_attachment(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_reserve_wbs_payable_attachment_hash(uuid,uuid,uuid,text,text,bigint,text,text,text) FROM refs_app;
DROP FUNCTION refs_bind_wbs_payable_uploaded_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text);
DROP FUNCTION refs_bind_wbs_payable_uploaded_attachment_hash(uuid,uuid,uuid,uuid,bigint,text);
DROP FUNCTION refs_read_wbs_payable_attachment_uploads(uuid,uuid,uuid);
DROP FUNCTION refs_reserve_wbs_payable_attachment(uuid,uuid,uuid,text,text,bigint,text,text,text,text,text);
DROP FUNCTION refs_reserve_wbs_payable_attachment_hash(uuid,uuid,uuid,text,text,bigint,text,text,text);
DROP TABLE wbs_payable_attachment_upload_intent;
COMMIT;
