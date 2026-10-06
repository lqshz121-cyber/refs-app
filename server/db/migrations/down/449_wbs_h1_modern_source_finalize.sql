BEGIN;

DO $migration$
DECLARE definition text; block_start integer; block_end integer;
DECLARE anchor constant text:=$old$SELECT * INTO trace FROM wbs_test_import_draft WHERE tenant_id=p_tenant AND entity_id=p_entity
    AND source_document_id=p_source_document AND business_document_id=p_business_document AND journal_entry_id=p_journal_entry FOR SHARE;$old$;
DECLARE event_anchor constant text:=$old$event_payload:=jsonb_build_object('wbs_test_import_draft_id',trace.wbs_test_import_draft_id,'source_document_id',p_source_document,
    'business_document_id',p_business_document,'journal_entry_id',p_journal_entry,'status','POSTED','test_only',true);$old$;
BEGIN
  SELECT pg_get_functiondef('public.refs_finalize_wbs_test_import_source(uuid,uuid,uuid,uuid,uuid,text,text)'::regprocedure) INTO definition;
  IF position('trace record; modern_trace boolean:=false;' IN definition)=0 OR position(anchor IN definition)=0 THEN
    RAISE EXCEPTION 'Migration 449 down requires modern source finalization' USING ERRCODE='55000';
  END IF;
  block_start:=position(anchor IN definition)+length(anchor);
  block_end:=position('    modern_trace:=true;
  END IF;' IN definition);
  IF block_end<block_start THEN RAISE EXCEPTION 'Modern trace rollback anchor missing' USING ERRCODE='55000'; END IF;
  definition:=substr(definition,1,block_start-1)||substr(definition,block_end+length('    modern_trace:=true;
  END IF;'));
  block_start:=position('IF modern_trace THEN' IN definition);
  block_end:=position(event_anchor||'
  END IF;' IN definition);
  IF block_start=0 OR block_end<block_start THEN RAISE EXCEPTION 'Modern event rollback anchor missing' USING ERRCODE='55000'; END IF;
  definition:=substr(definition,1,block_start-1)||event_anchor||substr(definition,block_end+length(event_anchor||'
  END IF;'));
  definition:=replace(definition,'trace record; modern_trace boolean:=false;','trace wbs_test_import_draft;');
  EXECUTE definition;
END
$migration$;

COMMIT;
