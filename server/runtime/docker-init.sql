-- LOCAL TEST ONLY. Production roles and secrets must be provisioned by the platform owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_app') THEN
    CREATE ROLE refs_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_runtime') THEN
    CREATE ROLE refs_runtime LOGIN PASSWORD 'refs_runtime_test_N7v2p9Q4x6Lm' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_context_issuer') THEN
    CREATE ROLE refs_context_issuer LOGIN PASSWORD 'refs_issuer_test_P6m4s8V2q7Jc' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='refs_grant_sync') THEN
    CREATE ROLE refs_grant_sync LOGIN PASSWORD 'refs_grant_sync_test_R9k5d3W8y2Fn' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END;
$$;
GRANT refs_app TO refs_runtime;
ALTER ROLE refs_runtime SET row_security=on;
