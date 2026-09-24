BEGIN;

-- Restores the 387 endpoint path check (the invalid {0,1023} quantifier) in
-- refs_create_webhook_subscription and on webhook_subscription. The table CHECK is restored
-- exactly as 387 wrote it (only on an empty table); with it no row can be inserted, as before 442.
DO $migration$
DECLARE
  definition text;
  old_check constant text:=$old$OR p_path!~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]{0,1023}$'$old$;
  new_check constant text:=$new$OR p_path!~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]*$' OR length(p_path)>1024$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_webhook_subscription(uuid,uuid,text,text,text,text[],text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(new_check IN definition)=0 OR position(new_check IN substr(definition,position(new_check IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 442 requires the 442 endpoint path check in refs_create_webhook_subscription' USING ERRCODE='55000';
  END IF;
  IF EXISTS(SELECT 1 FROM public.webhook_subscription) THEN
    RAISE EXCEPTION 'Down 442 refuses while webhook subscriptions exist: the 387 check cannot validate them' USING ERRCODE='55006';
  END IF;
  EXECUTE replace(definition,new_check,old_check);
END
$migration$;
ALTER TABLE webhook_subscription DROP CONSTRAINT webhook_subscription_endpoint_path_check;
ALTER TABLE webhook_subscription ADD CONSTRAINT webhook_subscription_endpoint_path_check
  CHECK(endpoint_path=btrim(endpoint_path) AND endpoint_path~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]{0,1023}$');

COMMIT;
