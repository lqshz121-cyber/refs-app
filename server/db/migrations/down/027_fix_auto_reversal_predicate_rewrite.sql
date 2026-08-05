BEGIN;
DO $$
DECLARE fn text;
BEGIN
 SELECT pg_get_functiondef('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO fn;
 fn:=regexp_replace(fn, $re$original[[:space:]]*\.[[:space:]]*journal_type[[:space:]]*IN[[:space:]]*\([[:space:]]*'MANUAL'[[:space:]]*,[[:space:]]*'RECLASS'[[:space:]]*,[[:space:]]*'AUTO'[[:space:]]*\)$re$, 'original.journal_type IN (''MANUAL'',''RECLASS'')', 'g');
 fn:=replace(fn, 'IF je.journal_type=''REVERSAL'' AND NOT EXISTS (SELECT 1 FROM journal_entry auto_original WHERE auto_original.tenant_id=p_tenant AND auto_original.entity_id=p_entity AND auto_original.journal_entry_id=je.reversal_of_id AND auto_original.journal_type=''AUTO'') AND (', 'IF je.journal_type=''REVERSAL'' AND (');
 EXECUTE fn;
END $$;
COMMIT;
