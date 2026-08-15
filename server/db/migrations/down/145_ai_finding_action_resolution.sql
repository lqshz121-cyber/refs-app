BEGIN;

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM ai_finding_action WHERE status='RESOLVED') THEN RAISE EXCEPTION 'Cannot remove retained AI finding resolution receipts' USING ERRCODE='55000'; END IF;
END $$;
DROP FUNCTION refs_read_ai_finding_actions(uuid,uuid,integer);
CREATE FUNCTION refs_read_ai_finding_actions(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 100)
RETURNS TABLE(ai_finding_action_id uuid,finding_kind text,finding_id uuid,finding_hash text,owner text,due_date text,revision integer,assigned_by text,assigned_at timestamptz,can_create_draft boolean,can_review boolean,can_approve boolean,can_post boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$ BEGIN PERFORM refs_assert_scope(p_tenant,p_entity,'AI.FINDING.ASSIGN'); IF p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'AI finding action limit must be between 1 and 100' USING ERRCODE='22023'; END IF; RETURN QUERY SELECT a.ai_finding_action_id,a.finding_kind,a.finding_id,a.finding_hash,a.owner,to_char(a.due_date,'YYYY-MM-DD'),a.revision,a.assigned_by,a.assigned_at,false,false,false,false FROM ai_finding_action a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity ORDER BY a.assigned_at DESC,a.ai_finding_action_id DESC LIMIT p_limit; END; $$;
DROP FUNCTION refs_resolve_ai_finding_action(uuid,uuid,uuid,text,text,integer,text,text);
DROP FUNCTION refs_resolve_ai_finding_action_hash(uuid,uuid,uuid,text,text,integer);
DROP TRIGGER ai_finding_action_resolved_immutable ON ai_finding_action;
DROP FUNCTION refs_reject_resolved_ai_finding_action_mutation();
ALTER TABLE ai_finding_action DROP CONSTRAINT ai_finding_action_resolution_complete,DROP COLUMN resolved_at,DROP COLUMN resolved_by,DROP COLUMN resolution_reason,DROP COLUMN status;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code='AI.FINDING.RESOLVE';

COMMIT;
