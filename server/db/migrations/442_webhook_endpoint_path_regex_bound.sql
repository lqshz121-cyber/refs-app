BEGIN;

-- R12 follow-up (found by the 441 end-to-end webhook test, 2026-09-25).
--
-- 387 bounds the webhook endpoint path with the regular expression quantifier {0,1023}.
-- PostgreSQL's regex engine caps a bound at 255 (RE_DUP_MAX), so the expression itself is
-- invalid: every call of refs_create_webhook_subscription, and every insert that reaches the
-- table CHECK, fails with 2201B "invalid repetition count(s)". No webhook subscription could
-- ever be created. The intended rule (a leading slash, the listed characters, at most 1024
-- characters in total) is kept; the length is enforced with length() instead of the quantifier.
-- Fail-closed: refuses unless the exact 387 text is present exactly once in each place.
DO $migration$
DECLARE
  definition text;
  constraint_name text;
  old_check constant text:=$old$OR p_path!~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]{0,1023}$'$old$;
  new_check constant text:=$new$OR p_path!~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]*$' OR length(p_path)>1024$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_webhook_subscription(uuid,uuid,text,text,text,text[],text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(old_check IN definition)=0 OR position(old_check IN substr(definition,position(old_check IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 442 requires the exact 387 endpoint path check in refs_create_webhook_subscription' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_check,new_check);

  SELECT c.conname INTO STRICT constraint_name FROM pg_constraint c
   WHERE c.conrelid='public.webhook_subscription'::regclass AND c.contype='c'
     AND pg_get_constraintdef(c.oid) LIKE '%endpoint_path%{0,1023}%';
  EXECUTE format('ALTER TABLE public.webhook_subscription DROP CONSTRAINT %I',constraint_name);
END
$migration$;
ALTER TABLE webhook_subscription ADD CONSTRAINT webhook_subscription_endpoint_path_check
  CHECK(endpoint_path=btrim(endpoint_path) AND endpoint_path~'^/[A-Za-z0-9._~!$&''()*+,;=:@/%-]*$' AND length(endpoint_path)<=1024);

COMMIT;
