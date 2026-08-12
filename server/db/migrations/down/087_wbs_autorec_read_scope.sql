BEGIN;

-- Restore the preceding read boundary without dropping the reader functions
-- that the preceding migration set owns.  All 087 reader replacements call
-- this helper, so changing it is an atomic functional rollback to the original
-- import-only read guard.
CREATE OR REPLACE FUNCTION refs_assert_wbs_autorec_read_scope(p_tenant uuid,p_entity uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'WBS.SNAPSHOT.IMPORT');
END $$;
REVOKE ALL ON FUNCTION refs_assert_wbs_autorec_read_scope(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_assert_wbs_autorec_read_scope(uuid,uuid) TO refs_app;

REVOKE ALL ON FUNCTION refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint) FROM refs_grant_sync;
DROP FUNCTION IF EXISTS refs_upgrade_stage1_wbs_autorec_read(uuid,text,uuid,text,text,bigint);

COMMIT;
