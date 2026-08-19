BEGIN;

-- Provider Payable observations retain their signed MONEY4 fact.  The
-- controlled TEST_ONLY bridge records that exact identity, but AP bills use
-- the non-zero absolute magnitude expected by the ordinary accounting flow.
DO $migration$
DECLARE
  definition text;
  old_regex constant text:=$fragment$COALESCE(p_row->>'amount','')!~'^(0|[1-9][0-9]{0,15})\.[0-9]{4}$'$fragment$;
  new_regex constant text:=$fragment$COALESCE(p_row->>'amount','')!~'^-?(0|[1-9][0-9]{0,15})\.[0-9]{4}$'$fragment$;
  old_zero constant text:=$fragment$(p_row->>'amount')::numeric<=0$fragment$;
  new_zero constant text:=$fragment$(p_row->>'amount')::numeric=0$fragment$;
  old_assignment constant text:=$fragment$amount:=(p_row->>'amount')::numeric(20,4);$fragment$;
  new_assignment constant text:=$fragment$amount:=abs((p_row->>'amount')::numeric(20,4));$fragment$;
  occurrences integer;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)'::regprocedure
  ) INTO definition;

  occurrences:=(length(definition)-length(replace(definition,old_regex,'')))/length(old_regex);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected WBS test Payable MONEY4 validator' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_regex,new_regex);

  occurrences:=(length(definition)-length(replace(definition,old_zero,'')))/length(old_zero);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected WBS test Payable zero validator' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_zero,new_zero);

  occurrences:=(length(definition)-length(replace(definition,old_assignment,'')))/length(old_assignment);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Unexpected WBS test Payable amount assignment' USING ERRCODE='22023'; END IF;
  definition:=replace(definition,old_assignment,new_assignment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;

COMMIT;
