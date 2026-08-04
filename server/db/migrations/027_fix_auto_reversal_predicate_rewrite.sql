BEGIN;
DO $$
DECLARE fn text; original text;
BEGIN
 SELECT pg_get_functiondef('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO fn;
 original:=fn;
 fn:=replace(fn, 'original.journal_type IN (''MANUAL'',''RECLASS'')', 'original.journal_type IN (''MANUAL'',''RECLASS'',''AUTO'')');
 fn:=replace(fn, 'original.journal_type IN (''MANUAL'', ''RECLASS'')', 'original.journal_type IN (''MANUAL'', ''RECLASS'', ''AUTO'')');
 fn:=regexp_replace(fn, $re$original[[:space:]]*\.[[:space:]]*journal_type[[:space:]]*IN[[:space:]]*\([[:space:]]*'MANUAL'[[:space:]]*,[[:space:]]*'RECLASS'[[:space:]]*\)$re$, 'original.journal_type IN (''MANUAL'',''RECLASS'',''AUTO'')', 'g');
 fn:=replace(fn, 'IF je.journal_type=''REVERSAL'' AND (', 'IF je.journal_type=''REVERSAL'' AND NOT EXISTS (SELECT 1 FROM journal_entry auto_original WHERE auto_original.tenant_id=p_tenant AND auto_original.entity_id=p_entity AND auto_original.journal_entry_id=je.reversal_of_id AND auto_original.journal_type=''AUTO'') AND (');
 IF fn=original AND position('AUTO' in fn)=0 THEN RAISE EXCEPTION 'refs_post_journal reversal predicate not found' USING ERRCODE='55000'; END IF;
 EXECUTE fn;
END $$;
COMMIT;
