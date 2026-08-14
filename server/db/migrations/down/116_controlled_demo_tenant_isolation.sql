BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM controlled_demo_tenant)
    OR EXISTS(SELECT 1 FROM controlled_demo_tenant_retirement) THEN
    RAISE EXCEPTION 'Cannot remove controlled DEMO tenant markers or retirement audit evidence' USING ERRCODE='55000';
  END IF;
END $$;

DROP FUNCTION refs_retire_controlled_demo_tenant(uuid,text,text);
DROP FUNCTION refs_read_controlled_demo_tenant(uuid);
DROP FUNCTION refs_validate_controlled_demo_tenant();
DROP TABLE controlled_demo_tenant_retirement;
DROP TABLE controlled_demo_tenant;

COMMIT;
