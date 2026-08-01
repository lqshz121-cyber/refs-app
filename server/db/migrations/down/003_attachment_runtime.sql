BEGIN;
DROP TRIGGER IF EXISTS attachment_evidence_immutable ON attachment;
DROP FUNCTION IF EXISTS refs_protect_attachment_evidence();
DROP FUNCTION IF EXISTS refs_finalize_attachment(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text,text,text);
DROP FUNCTION IF EXISTS refs_attachment_finalize_hash(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text);
DROP FUNCTION IF EXISTS refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text);
DROP FUNCTION IF EXISTS refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_request_attachment_finalize(uuid,uuid,uuid,text,text);
DROP FUNCTION IF EXISTS refs_attachment_finalize_request_hash(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_complete_attachment_cleanup(uuid,uuid,uuid,uuid,boolean,text);
DROP FUNCTION IF EXISTS refs_claim_expired_attachments(uuid,uuid,integer);
GRANT SELECT ON attachment TO refs_app;
DELETE FROM runtime_actor_grant WHERE permission IN ('ATTACHMENT.CREATE','ATTACHMENT.FINALIZE','ATTACHMENT.CLEANUP');
DELETE FROM permission_catalog WHERE permission_code IN ('ATTACHMENT.CREATE','ATTACHMENT.FINALIZE','ATTACHMENT.CLEANUP');
DROP POLICY IF EXISTS attachment_scope_policy ON attachment;
CREATE POLICY attachment_tenant_policy ON attachment USING (tenant_id=refs_current_tenant()) WITH CHECK (tenant_id=refs_current_tenant());
ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_verified_entity_ck,DROP CONSTRAINT IF EXISTS attachment_reservation_window_ck,
  DROP CONSTRAINT IF EXISTS attachment_entity_fk,DROP COLUMN IF EXISTS cleaned_at,DROP COLUMN IF EXISTS cleanup_claimed_by,DROP COLUMN IF EXISTS cleanup_claim_token,DROP COLUMN IF EXISTS cleanup_claimed_at,DROP COLUMN IF EXISTS cleanup_attempts,DROP COLUMN IF EXISTS cleanup_status,
  DROP COLUMN IF EXISTS upload_expires_at,DROP COLUMN IF EXISTS reserved_at,DROP COLUMN IF EXISTS entity_id;
COMMIT;
