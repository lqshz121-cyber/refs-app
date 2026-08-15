BEGIN;

-- Preserve the immutable 145 definition while replacing only its three
-- capability permission predicates. pg_get_functiondef returns the canonical
-- CREATE OR REPLACE FUNCTION statement, including the retained function body.
DO $$
DECLARE
  function_definition text;
  tightened_definition text;
BEGIN
  function_definition:=pg_get_functiondef('refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer)'::regprocedure);
  IF function_definition NOT LIKE 'CREATE OR REPLACE FUNCTION%'
    OR position('refs_has_permission(''PREPAID.AMORTIZATION.REVIEW'')' in function_definition)=0
    OR position('refs_has_permission(''PREPAID.AMORTIZATION.DRAFT'')' in function_definition)=0
    OR position('refs_has_permission(''GL.JE.AUTO.CREATE'')' in function_definition)=0 THEN
    RAISE EXCEPTION 'Insurance amortization readiness definition is not the expected migration 145 contract' USING ERRCODE='55000';
  END IF;

  tightened_definition:=replace(function_definition,
    'refs_has_permission(''PREPAID.AMORTIZATION.REVIEW'')',
    'refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.REVIEW'')');
  tightened_definition:=replace(tightened_definition,
    'refs_has_permission(''PREPAID.AMORTIZATION.DRAFT'')',
    'refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.DRAFT'')');
  tightened_definition:=replace(tightened_definition,
    'refs_has_permission(''GL.JE.AUTO.CREATE'')',
    'refs_entity_has_permission(p_entity,''GL.JE.AUTO.CREATE'')');
  EXECUTE tightened_definition;

  function_definition:=pg_get_functiondef('refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer)'::regprocedure);
  IF position('refs_has_permission(''PREPAID.AMORTIZATION.REVIEW'')' in function_definition)>0
    OR position('refs_has_permission(''PREPAID.AMORTIZATION.DRAFT'')' in function_definition)>0
    OR position('refs_has_permission(''GL.JE.AUTO.CREATE'')' in function_definition)>0
    OR position('refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.REVIEW'')' in function_definition)=0
    OR position('refs_entity_has_permission(p_entity,''PREPAID.AMORTIZATION.DRAFT'')' in function_definition)=0
    OR position('refs_entity_has_permission(p_entity,''GL.JE.AUTO.CREATE'')' in function_definition)=0 THEN
    RAISE EXCEPTION 'Insurance amortization entity capability tightening did not apply exactly' USING ERRCODE='55000';
  END IF;
END;
$$;

COMMIT;
