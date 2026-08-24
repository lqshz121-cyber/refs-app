BEGIN;

-- A source-document link proves lineage, but it does not prove that the manual
-- Journal has a verified-clean supporting attachment.  Keep the retained
-- source IDs in the finding while deriving the HIGH no-attachment rule solely
-- from the immutable JE_ATTACHMENT evidence population.
DO $migration$
DECLARE
  definition text;
  rewritten text;
  old_support constant text:='no_support:=attachment_count=0 AND jsonb_array_length(source_ids)=0;';
  new_support constant text:='no_support:=attachment_count=0;';
  old_reason constant text:='A large manual Journal Entry has no retained attachment or source document evidence.';
  new_reason constant text:='A large manual Journal Entry has no verified-clean retained attachment; source-document lineage alone is not supporting attachment evidence.';
BEGIN
  SELECT pg_get_functiondef('refs_materialize_ai_manual_journal_risk_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure)
    INTO definition;
  IF strpos(definition,old_support)=0 OR strpos(definition,old_reason)=0
     OR strpos(definition,new_support)>0 OR strpos(definition,new_reason)>0 THEN
    RAISE EXCEPTION 'Manual Journal materializer does not match the exact pre-280 contract' USING ERRCODE='55000';
  END IF;
  rewritten:=replace(replace(definition,old_support,new_support),old_reason,new_reason);
  EXECUTE rewritten;
  SELECT pg_get_functiondef('refs_materialize_ai_manual_journal_risk_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure)
    INTO definition;
  IF strpos(definition,new_support)=0 OR strpos(definition,new_reason)=0
     OR strpos(definition,old_support)>0 OR strpos(definition,old_reason)>0 THEN
    RAISE EXCEPTION 'Manual Journal materializer verified-attachment rewrite failed closed' USING ERRCODE='55000';
  END IF;
END;
$migration$;

COMMIT;
