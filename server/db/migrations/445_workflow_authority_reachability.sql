BEGIN;

-- R12 follow-up (found 2026-09-25 by widening CPD-7 to permissions chosen at run time, and by a scan
-- for commands that assert two non-READ authority classes unconditionally).
--
-- A human grant carries exactly one authority class per entity (274/414), so a command that asserts
-- permissions of two classes can never be run by a real user. Two families did:
--
--   Saved report views: create/update assert REPORT.SAVED_VIEW.CREATE/UPDATE (DRAFT) or .SHARE
--   (REVIEW), chosen by visibility, next to REPORT.SAVED_VIEW.VIEW (READ). Same fix as 412/441: VIEW
--   becomes additive to DRAFT and REVIEW only.
--
--   Unit Transfer paired reversal (371): create asserted REVERSE (REVERSAL) + GL.JE.REVERSE
--   (JE_REVERSAL) + GL.JE.CREATE (DRAFT); submit/review/approve asserted the action and REVERSE; post
--   asserted REVERSE and POST; cancel asserted CANCEL and REVERSE. The forward pair (370) asserts only
--   the step's own permission, and 371's own SoD checks (creator, original journal actors) already
--   separate the people. Each reversal step now asserts only its own permission. No permission is
--   added to any class, so no grant can do more than before; the steps simply become reachable.
--   Once reachable, every reversal step then failed on its outbox write: the source and target rows
--   carried the same payload hash, and outbox_event is unique on it. Each row now carries its
--   entity_id, as the forward pair's rows do.
--   The forward pair's cancel had the same two-rows-one-hash outbox collision.
--   Binding a reversal journal to its original at Post was then refused by the forward pair's
--   journal guard (370/408), which treats any journal pointing at a pair journal as a generic reversal;
--   paired reversal journals are left to the reversal-pair guard that 371 added for them.
--   Binding a reversal journal to its original at Post was then refused by the forward pair's
--   journal guard (370/408), which treats any journal pointing at a pair journal as a generic reversal;
--   paired reversal journals are left to the reversal-pair guard that 371 added for them.
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
    OR (permission_code='REPORT.SAVED_VIEW.VIEW' AND authority_class IN('DRAFT','REVIEW'))
  );
INSERT INTO runtime_human_additive_permission_authority(permission_code,authority_class) VALUES
  ('REPORT.SAVED_VIEW.VIEW','DRAFT'),
  ('REPORT.SAVED_VIEW.VIEW','REVIEW')
ON CONFLICT DO NOTHING;

-- 1. refs_create_unit_transfer_reversal_pair: Create: REAL_ESTATE.UNIT_TRANSFER.REVERSE (REVERSAL) is the authority; GL.JE.REVERSE (JE_REVERSAL) and GL.JE.CREATE (DRAFT) are other classes that no REVERSAL grant can hold.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');
 PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'GL.JE.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'GL.JE.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'GL.JE.CREATE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'GL.JE.CREATE');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 1 in refs_create_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 2. refs_transition_unit_transfer_reversal_pair: Submit/review/approve: the action permission is the authority, as for the forward pair; REVERSE (REVERSAL) is the reverser's class.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.'||action);$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 2 in refs_transition_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 3. refs_post_unit_transfer_reversal_pair: Post: REAL_ESTATE.UNIT_TRANSFER.POST (POST) is the authority, as for the forward pair.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,original_pair.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');PERFORM refs_assert_scope(p_tenant,original_pair.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.POST');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 3 in refs_post_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 4. refs_cancel_unit_transfer_reversal_pair: Cancel: REAL_ESTATE.UNIT_TRANSFER.CANCEL (JE_REVIEW) is the authority, as for the forward pair.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.REVERSE');$old$;
  new_text constant text:=$new$PERFORM refs_assert_scope(p_tenant,r.source_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');PERFORM refs_assert_scope(p_tenant,r.target_entity_id,'REAL_ESTATE.UNIT_TRANSFER.CANCEL');$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 4 in refs_cancel_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 5. refs_create_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload,refs_jsonb_hash(payload)),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload||jsonb_build_object('entity_id',original_pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.source_entity_id))),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',reversal_id,'UNIT_TRANSFER_REVERSAL_DRAFT_CREATED',payload||jsonb_build_object('entity_id',original_pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.target_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_create_unit_transfer_reversal_pair(uuid,uuid,uuid,bigint,bigint,bigint,date,text,text,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 5 in refs_create_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 6. refs_transition_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload,refs_jsonb_hash(payload)),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload||jsonb_build_object('entity_id',r.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.source_entity_id))),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_'||action,payload||jsonb_build_object('entity_id',r.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.target_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_transition_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,text,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 6 in refs_transition_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 7. refs_post_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload,refs_jsonb_hash(payload)),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,original_pair.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload||jsonb_build_object('entity_id',original_pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.source_entity_id))),(p_tenant,original_pair.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair_id,'UNIT_TRANSFER_REVERSAL_POSTED',payload||jsonb_build_object('entity_id',original_pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',original_pair.target_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_post_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 7 in refs_post_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 8. refs_cancel_unit_transfer_reversal_pair: Outbox rows for the source and target entity carried the same payload hash (23505 on outbox_event unique key); each row now carries its entity_id, as 370 does.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload,refs_jsonb_hash(payload)),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$INSERT INTO outbox_event(tenant_id,entity_id,aggregate_type,aggregate_id,event_type,payload,payload_hash) VALUES(p_tenant,r.source_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload||jsonb_build_object('entity_id',r.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.source_entity_id))),(p_tenant,r.target_entity_id,'UNIT_TRANSFER_REVERSAL_PAIR',p_reversal_pair,'UNIT_TRANSFER_REVERSAL_CANCELLED',payload||jsonb_build_object('entity_id',r.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',r.target_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_reversal_pair(uuid,uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 8 in refs_cancel_unit_transfer_reversal_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 9. refs_guard_unit_transfer_journal_transition: Forward-pair journal guard: a paired reversal journal bound to its original is guarded by the reversal-pair guard, not refused as a generic reversal (0A000 at reversal Post).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$IF NOT FOUND THEN RETURN NEW;END IF;
 IF NEW.journal_entry_id NOT IN(pair.source_journal_entry_id,pair.target_journal_entry_id)$old$;
  new_text constant text:=$new$IF NOT FOUND THEN RETURN NEW;END IF;
 IF EXISTS(SELECT 1 FROM unit_transfer_reversal_pair rp WHERE rp.tenant_id=NEW.tenant_id AND NEW.journal_entry_id IN(rp.source_reversal_journal_entry_id,rp.target_reversal_journal_entry_id)) THEN RETURN NEW;END IF;
 IF NEW.journal_entry_id NOT IN(pair.source_journal_entry_id,pair.target_journal_entry_id)$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_guard_unit_transfer_journal_transition()'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 9 in refs_guard_unit_transfer_journal_transition' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 10. refs_cancel_unit_transfer_pair: Forward-pair cancel outbox row for the source entity: same payload hash as the other row (23505); carry entity_id as the post and transition rows do.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$VALUES(p_tenant,pair.source_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload||jsonb_build_object('entity_id',pair.source_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',pair.source_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 10 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 11. refs_cancel_unit_transfer_pair: Forward-pair cancel outbox row for the target entity: same payload hash as the other row (23505); carry entity_id as the post and transition rows do.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload,refs_jsonb_hash(payload));$old$;
  new_text constant text:=$new$VALUES(p_tenant,pair.target_entity_id,'UNIT_TRANSFER_PAIR',p_pair,'UNIT_TRANSFER_CANCELLED',payload||jsonb_build_object('entity_id',pair.target_entity_id),refs_jsonb_hash(payload||jsonb_build_object('entity_id',pair.target_entity_id)));$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 445 requires the exact text of patch 11 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

COMMIT;
