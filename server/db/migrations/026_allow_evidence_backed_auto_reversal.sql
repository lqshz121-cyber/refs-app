BEGIN;
DO $$
DECLARE fn text; needle text:='original.journal_type IN (''MANUAL'',''RECLASS'')'; replacement text:='original.journal_type IN (''MANUAL'',''RECLASS'',''AUTO'')'; pos integer;
BEGIN
 SELECT pg_get_functiondef('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO fn;
 pos:=strpos(fn,needle);
 IF pos=0 THEN RETURN; END IF;
 fn:=overlay(fn placing replacement from pos for length(needle));
 EXECUTE fn;
END $$;
COMMIT;
