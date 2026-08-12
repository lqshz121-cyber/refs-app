BEGIN;

DO $$
BEGIN
  IF to_regclass('public.wbs_payable_draft_evidence') IS NOT NULL
     AND EXISTS(SELECT 1 FROM wbs_payable_draft_evidence) THEN
    RAISE EXCEPTION 'Cannot remove WBS Payable AP Draft lineage while Draft evidence exists';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text) FROM refs_app;
REVOKE EXECUTE ON FUNCTION refs_create_wbs_payable_ap_draft_hash(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text) FROM refs_app;
DROP FUNCTION refs_create_wbs_payable_ap_draft(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text,text,text);
DROP FUNCTION refs_create_wbs_payable_ap_draft_hash(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid[],text);
DROP TABLE wbs_payable_draft_evidence;

COMMIT;
