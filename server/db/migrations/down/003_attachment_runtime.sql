BEGIN;
DROP TRIGGER IF EXISTS attachment_evidence_immutable ON attachment;
DROP FUNCTION IF EXISTS refs_protect_attachment_evidence();
DROP FUNCTION IF EXISTS refs_finalize_attachment(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text,text,text);
DROP FUNCTION IF EXISTS refs_attachment_finalize_hash(uuid,uuid,uuid,text,bigint,text,text,text,boolean,text);
DROP FUNCTION IF EXISTS refs_reserve_attachment(uuid,uuid,text,text,bigint,text,text,text,text,text);
DROP FUNCTION IF EXISTS refs_attachment_reserve_hash(uuid,uuid,text,text,bigint,text,text,text);
DROP FUNCTION IF EXISTS refs_get_attachment_for_finalize(uuid,uuid,uuid);
GRANT SELECT ON attachment TO refs_app;
DELETE FROM runtime_actor_grant WHERE permission IN ('ATTACHMENT.CREATE','ATTACHMENT.FINALIZE');
DELETE FROM permission_catalog WHERE permission_code IN ('ATTACHMENT.CREATE','ATTACHMENT.FINALIZE');
DROP POLICY IF EXISTS attachment_scope_policy ON attachment;
CREATE POLICY attachment_tenant_policy ON attachment USING (tenant_id=refs_current_tenant()) WITH CHECK (tenant_id=refs_current_tenant());
ALTER TABLE attachment DROP CONSTRAINT IF EXISTS attachment_verified_entity_ck,DROP CONSTRAINT IF EXISTS attachment_reservation_window_ck,
  DROP CONSTRAINT IF EXISTS attachment_entity_fk,DROP COLUMN IF EXISTS upload_expires_at,DROP COLUMN IF EXISTS reserved_at,DROP COLUMN IF EXISTS entity_id;
COMMIT;
