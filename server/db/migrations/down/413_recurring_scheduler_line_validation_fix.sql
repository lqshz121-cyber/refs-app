BEGIN;

-- The original function can only be restored when no retained recurring data
-- depends on the corrected canonical-money validation contract.
LOCK TABLE recurring_schedule IN SHARE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM recurring_schedule) THEN
    RAISE EXCEPTION 'Cannot restore defective recurring line validation with retained schedules' USING ERRCODE='55006';
  END IF;
END; $$;

CREATE OR REPLACE FUNCTION refs_validate_recurring_schedule_lines(p_tenant uuid,p_entity uuid,p_lines jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN
 IF jsonb_typeof(p_lines)<>'array' OR jsonb_array_length(p_lines) NOT BETWEEN 2 AND 500 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x WHERE ARRAY(SELECT jsonb_object_keys(x) ORDER BY 1)<>ARRAY['accountCode','creditAmount','debitAmount','description','dimensions','lineNo','memberRef'] OR x->>'lineNo' !~ '^[1-9][0-9]*$' OR x->>'accountCode' !~ '^[A-Za-z0-9._-]{1,64}$' OR x->>'debitAmount' !~ '^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$' OR x->>'creditAmount' !~ '^(0|[1-9][0-9]{0,15})\\.[0-9]{4}$' OR NOT(((x->>'debitAmount')::numeric>0 AND (x->>'creditAmount')::numeric=0) OR((x->>'creditAmount')::numeric>0 AND (x->>'debitAmount')::numeric=0)) OR jsonb_typeof(x->'dimensions')<>'object' OR (x->'memberRef' IS NOT NULL AND (jsonb_typeof(x->'memberRef')<>'null' AND (x->>'memberRef'<>btrim(x->>'memberRef') OR length(x->>'memberRef') NOT BETWEEN 1 AND 128))) OR (x->'description' IS NOT NULL AND (jsonb_typeof(x->'description')<>'null' AND (x->>'description'<>btrim(x->>'description') OR length(x->>'description') NOT BETWEEN 1 AND 1000)))) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x GROUP BY (x->>'lineNo') HAVING count(*)>1) OR (SELECT sum((x->>'debitAmount')::numeric) FROM jsonb_array_elements(p_lines) x)<>(SELECT sum((x->>'creditAmount')::numeric) FROM jsonb_array_elements(p_lines) x) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_lines) x LEFT JOIN account_master a ON a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.account_code=x->>'accountCode' AND a.active WHERE a.account_code IS NULL) THEN RAISE EXCEPTION 'Recurring schedule lines must be canonical, active-account, and balanced' USING ERRCODE='23514'; END IF;
END;$$;

COMMIT;
