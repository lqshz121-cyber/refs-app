BEGIN;
-- Removing a retained installation identity is not an ordinary rollback.
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.refs_deployment_identity) THEN
    RAISE EXCEPTION 'Initialized deployment identity cannot be rolled back' USING ERRCODE='42501';
  END IF;
END $$;
DROP FUNCTION refs_assert_deployment_identity(uuid,text,text);
DROP FUNCTION refs_assert_staging_deployment_target(uuid,text);
DROP FUNCTION refs_initialize_deployment_identity(uuid,text,text,text);
DROP TABLE refs_deployment_identity;
DROP FUNCTION refs_deployment_identity_immutable();
COMMIT;
