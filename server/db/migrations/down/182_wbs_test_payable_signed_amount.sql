BEGIN;

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

  occurrences:=(length(definition)-length(replace(definition,new_regex,'')))/length(new_regex);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected WBS test Payable MONEY4 validator' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_regex,old_regex);

  occurrences:=(length(definition)-length(replace(definition,new_zero,'')))/length(new_zero);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected WBS test Payable zero validator' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_zero,old_zero);

  occurrences:=(length(definition)-length(replace(definition,new_assignment,'')))/length(new_assignment);
  IF occurrences<>1 THEN RAISE EXCEPTION 'Cannot restore unexpected WBS test Payable amount assignment' USING ERRCODE='55000'; END IF;
  definition:=replace(definition,new_assignment,old_assignment);
  EXECUTE definition;
END;
$migration$;

REVOKE ALL ON FUNCTION refs_create_wbs_test_payable_draft_v168(uuid,uuid,uuid,jsonb,jsonb,integer,text,text)
  FROM PUBLIC,refs_app;

COMMIT;
