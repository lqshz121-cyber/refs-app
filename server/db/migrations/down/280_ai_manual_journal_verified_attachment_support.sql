BEGIN;

DO $migration$
DECLARE
  definition text;
  rewritten text;
  old_support constant text:='no_support:=attachment_count=0 AND jsonb_array_length(source_ids)=0;';
  new_support constant text:='no_support:=attachment_count=0;';
  old_reason constant text:='A large manual Journal Entry has no retained attachment or source document evidence.';
  new_reason constant text:='A large manual Journal Entry has no verified-clean retained attachment; source-document lineage alone is not supporting attachment evidence.';
  old_lookup constant text:='SELECT ai_manual_journal_risk_finding_id INTO finding_id FROM ai_manual_journal_risk_finding WHERE tenant_id=p_tenant AND entity_id=p_entity AND finding_hash=finding_hash;';
  new_lookup constant text:='SELECT retained.ai_manual_journal_risk_finding_id INTO finding_id FROM ai_manual_journal_risk_finding retained WHERE retained.tenant_id=p_tenant AND retained.entity_id=p_entity AND retained.finding_hash=refs_jsonb_hash(jsonb_build_object(''schema_version'',''AI_MANUAL_JOURNAL_RISK_EVIDENCE_V1'',''tenant_id'',p_tenant,''entity_id'',p_entity,''accounting_period_id'',p_period,''finding'',item));';
BEGIN
  IF EXISTS(
    SELECT 1 FROM ai_manual_journal_risk_finding
    WHERE finding->>'reason'=new_reason
  ) THEN
    RAISE EXCEPTION 'Cannot restore source-link suppression after retaining verified-attachment findings' USING ERRCODE='55000';
  END IF;
  SELECT pg_get_functiondef('refs_materialize_ai_manual_journal_risk_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure)
    INTO definition;
  IF strpos(definition,new_support)=0 OR strpos(definition,new_reason)=0 OR strpos(definition,new_lookup)=0
     OR strpos(definition,old_support)>0 OR strpos(definition,old_reason)>0 OR strpos(definition,old_lookup)>0 THEN
    RAISE EXCEPTION 'Manual Journal materializer does not match the exact migration 280 contract' USING ERRCODE='55000';
  END IF;
  rewritten:=replace(replace(replace(definition,new_support,old_support),new_reason,old_reason),new_lookup,old_lookup);
  EXECUTE rewritten;
END;
$migration$;

COMMIT;
