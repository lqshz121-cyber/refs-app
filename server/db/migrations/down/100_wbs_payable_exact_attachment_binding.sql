BEGIN;

DO $$ BEGIN
  IF to_regclass('public.wbs_payable_attachment_binding') IS NOT NULL
     AND EXISTS(SELECT 1 FROM wbs_payable_attachment_binding) THEN
    RAISE EXCEPTION 'Cannot remove retained WBS Payable attachment bindings';
  END IF;
END $$;

DROP TRIGGER IF EXISTS wbs_payable_review_attachment_exact_binding ON wbs_payable_review_attachment;
DROP FUNCTION IF EXISTS refs_require_wbs_payable_attachment_binding();
-- Restore migration 099's fail-closed contract before removing the binding
-- table.  Downgrade must never re-expose entity-wide clean attachments.
CREATE OR REPLACE FUNCTION refs_read_wbs_payable_attachment_choices(
  p_tenant uuid,p_entity uuid,p_row uuid,p_source_version text,
  p_receipt_hash text,p_provider_receipt_hash text,p_evidence_hash text
)
RETURNS TABLE(attachment_choices jsonb,attachment_count integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT '[]'::jsonb,0::integer
$$;
REVOKE ALL ON FUNCTION refs_read_wbs_payable_attachment_choices(uuid,uuid,uuid,text,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_bind_wbs_payable_attachment_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text) FROM refs_app;
DROP FUNCTION refs_bind_wbs_payable_attachment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text,text,text);
DROP FUNCTION refs_bind_wbs_payable_attachment_hash(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text,text,text);
DROP TABLE wbs_payable_attachment_binding;

COMMIT;
