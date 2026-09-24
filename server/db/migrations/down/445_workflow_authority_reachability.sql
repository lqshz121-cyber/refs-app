BEGIN;

-- Reverses migration 445: restores the 371 assertions, then removes the additive saved-view VIEW
-- authority (refusing while a live grant relies on it) and restores 441's check.

-- 11. refs_cancel_unit_transfer_pair: Forward-pair cancel outbox row for the target entity: same payload hash as the other row (23505); carry entity_id as the post and transition rows do.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload||jsonb_build_object('entity_id',pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',pair.target_entity_id)));$old$;
  new_text constant text:=$new$VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 11 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 10. refs_cancel_unit_transfer_pair: Forward-pair cancel outbox row for the source entity: same payload hash as the other row (23505); carry entity_id as the post and transition rows do.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload||jsonb_build_object('entity_id',pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',pair.source_entity_id)));$old$;
  new_text constant text:=$new$VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 10 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 9. refs_guard_unit_transfer_journal_transition: Forward-pair journal guard: a paired reversal journal bound to its original is guarded by the reversal-pair guard, not refused as a generic reversal (0A000 at reversal Post).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$IF NOT FOUND THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM unit_transfer_reversal_pair rp WHERE rp.tenant_id=NEW.tenant_id AND NEW.journal_entry_id IN(rp.source_reversal_journal_entry_id,rp.target_reversal_journal_entry_id)) THEN RETURN NEW;END IF;
 IF NEW.journal_entry_id NOT IN(pair.source_journal_entry_id,pair.target_journal_entry_id)$old$;
  new_text constant text:=$new$IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.journal_entry_id NOT IN(pair.source_journal_entry_id,pair.target_journal_entry_id)$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_guard_unit_transfer_journal_transition()'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 9 in refs_guard_unit_transfer_journal_transition' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 8. refs_cancel_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload||jsonb_build_object('entity_id',r.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.source_entity_id))),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload||jsonb_build_object('entity_id',r.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.target_entity_id)));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload,refs_jsonb_hash(payload)),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 8 in refs_cancel_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 7. refs_post_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload||jsonb_build_object('entity_id',original_pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.source_entity_id))),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload||jsonb_build_object('entity_id',original_pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.target_entity_id)));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload,refs_jsonb_hash(payload)),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 7 in refs_post_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 6. refs_transition_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload||jsonb_build_object('entity_id',r.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.source_entity_id))),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload||jsonb_build_object('entity_id',r.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.target_entity_id)));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload,refs_jsonb_hash(payload)),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 6 in refs_transition_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 5. refs_create_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload||jsonb_build_object('entity_id',original_pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.source_entity_id))),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload||jsonb_build_object('entity_id',original_pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.target_entity_id)));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload,refs_jsonb_hash(payload)),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload,refs_jsonb_hash(payload));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 5 in refs_create_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 4. refs_cancel_unit_transfer_reversal_pair: Cancel: REAL_ESTATE.UNIT_TRANSFER.CANCEL (JE_REVIEW) is the authority, as for the forward pair.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 4 in refs_cancel_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 3. refs_post_unit_transfer_reversal_pair: Post: REAL_ESTATE.UNIT_TRANSFER.POST (POST) is the authority, as for the forward pair.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 3 in refs_post_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 2. refs_transition_unit_transfer_reversal_pair: Submit/review/approve: the action permission is the authority, as for the forward pair; REVERSE (REVERSAL) is the reverser's class.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 2 in refs_transition_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 1. refs_create_unit_transfer_reversal_pair: Create: REAL_ESTATE.UNIT_TRANSFER.REVERSE (REVERSAL) is the authority; GL.JE.REVERSE (JE_REVERSAL) and GL.JE.CREATE (DRAFT) are other classes that no REVERSAL grant can hold.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');
 PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'GL.JE.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'GL.JE.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'GL.JE.CREATE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'GL.JE.CREATE');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Down 445 requires the exact text of patch 1 in refs_create_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM runtime_actor_grant g WHERE g.revoked_at IS NULL AND g.permission='REPORT.SAVED_VIEW.VIEW' AND g.authority_class IN('DRAFT','REVIEW')) THEN
    RAISE EXCEPTION 'Cannot remove additive saved-view VIEW authority while live grants use it' USING ERRCODE='55006';
  END IF;
END $$;
DELETE FROM runtime_human_additive_permission_authority WHERE permission_code='REPORT.SAVED_VIEW.VIEW' AND authority_class IN('DRAFT','REVIEW');
ALTER TABLE runtime_human_additive_permission_authority
  DROP CONSTRAINT runtime_human_additive_permission_authority_check;
ALTER TABLE runtime_human_additive_permission_authority
  ADD CONSTRAINT runtime_human_additive_permission_authority_check CHECK(
    (permission_code='ATTACHMENT.CREATE' AND authority_class IN('DRAFT','PAYMENT','RECEIPT','ADJUSTMENT'))
    OR (permission_code='ACCOUNTING.SETTINGS.WORKFLOW.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
    OR (permission_code='RECURRING.SCHEDULE.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','REVIEW','SCHEDULE'))
    OR (permission_code='GROUP.CONSOLIDATION.CONFIG.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
    OR (permission_code='GROUP.INTERCOMPANY_ELIMINATION.VIEW' AND authority_class IN('DRAFT','SUBMIT','REVIEW','APPROVE','POST'))
    OR (permission_code='INTEGRATION.WEBHOOK.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE','JE_REVIEW'))
    OR (permission_code='REPORT.FORECAST.VIEW' AND authority_class IN('DRAFT','SUBMIT','APPROVE'))
  );

COMMIT;
