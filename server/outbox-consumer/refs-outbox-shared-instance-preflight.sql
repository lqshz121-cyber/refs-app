-- Catalog-only anonymous PUBLIC privilege inventory for the CURRENT database.
-- Execute inside BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; ... ROLLBACK;
-- NULL ACL means PostgreSQL defaults, not no privileges. No function bodies/data.
WITH exposed AS (
  SELECT 'database'::text AS category, a.privilege_type, false AS security_definer
  FROM pg_catalog.pg_database d
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(d.datacl, pg_catalog.acldefault('d', d.datdba))) a
  WHERE d.datname = current_database() AND a.grantee = 0
  UNION ALL
  SELECT 'schema', a.privilege_type, false
  FROM pg_catalog.pg_namespace n
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND a.grantee = 0
  UNION ALL
  SELECT CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'relation' END, a.privilege_type, false
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) a
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND a.grantee = 0
  UNION ALL
  SELECT 'column', a.privilege_type, false
  FROM pg_catalog.pg_attribute att JOIN pg_catalog.pg_class c ON c.oid = att.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(att.attacl) a
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND att.attnum > 0 AND NOT att.attisdropped AND a.grantee = 0
  UNION ALL
  SELECT 'routine', a.privilege_type, p.prosecdef
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema' AND a.grantee = 0
  UNION ALL
  SELECT 'default:' || d.defaclobjtype::text || CASE WHEN d.defaclnamespace = 0 THEN ':global' ELSE ':schema' END, a.privilege_type, false
  FROM pg_catalog.pg_default_acl d
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a WHERE a.grantee = 0
)
SELECT category, privilege_type, security_definer, count(*)::integer AS count
FROM exposed GROUP BY category, privilege_type, security_definer
ORDER BY category, privilege_type, security_definer;
