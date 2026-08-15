BEGIN;

-- Restore the exact migration 145 permission predicates without editing 145.
DO $$
DECLARE
  function_definition text;
  restored_definition text;
BEGIN
  function_definition:=pg_get_functiondef('refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer)'::regprocedure);
  IF function_definition NOT LIKE 'CREATE OR REPLACE FUNCTION%'
    OR position('refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.REVIEW'')' in function_definition)=0
    OR position('refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.DRAFT'')' in function_definition)=0
    OR position('refs_entity_has_permission(p_entity,''GL.JE.AUTO.CREATE'')' in function_definition)=0 THEN
    RAISE EXCEPTION 'Insurance amortization readiness definition is not the expected migration 147 contract' USING ERRCODE='55000';
  END IF;

  restored_definition:=replace(function_definition,
    'refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.REVIEW'')',
    'refs_has_permission(''PREPAID.AMORTIZATION.REVIEW'')');
  restored_definition:=replace(restored_definition,
    'refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.DRAFT'')',
    'refs_has_permission(''PREPAID.AMORTIZATION.DRAFT'')');
  restored_definition:=replace(restored_definition,
    'refs_entity_has_permission(p_entity,''GL.JE.AUTO.CREATE'')',
    'refs_has_permission(''GL.JE.AUTO.CREATE'')');
  EXECUTE restored_definition;
END;
$$;

COMMIT;
