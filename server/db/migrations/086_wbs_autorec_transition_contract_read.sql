BEGIN;

-- Signed provider transition contracts are evidence only.  They require a
-- dedicated view grant and never authorize a REFS or WBS state change.
INSERT INTO permission_catalog(permission_code,domain,risk_class,sod_class)
  VALUES('WBS.AUTOREC.VIEW','WBS','MEDIUM','WBS_AUTOREC_READER')
  ON CONFLICT (permission_code) DO NOTHING;

COMMIT;
