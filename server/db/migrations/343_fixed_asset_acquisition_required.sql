BEGIN;
-- Every asset cost debit follows the same rule, including legacy manual routes.
-- The earlier acquisition_post_guard validates the immutable financial/source
-- snapshots and inserts the asset's unique posting marker in this transaction.
CREATE FUNCTION refs_require_asset_acquisition_on_post() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;
BEGIN
 IF EXISTS(SELECT 1 FROM journal_line l WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.journal_entry_id=NEW.journal_entry_id AND l.debit_amount>0
  AND EXISTS(SELECT 1 FROM fixed_asset_register_evidence a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.asset_account_code=l.account_code)
  AND NOT EXISTS(SELECT 1 FROM fixed_asset_register_evidence a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND a.asset_account_code=l.account_code AND a.fixed_asset_register_evidence_id::text=l.dimensions->>'fixed_asset_register_evidence_id'))
 THEN RAISE EXCEPTION 'Registered asset cost account requires an exact asset dimension' USING ERRCODE='23514';END IF;
 FOR asset IN SELECT a.* FROM fixed_asset_register_evidence a WHERE a.tenant_id=NEW.tenant_id AND a.entity_id=NEW.entity_id AND EXISTS(
  SELECT 1 FROM journal_line l WHERE l.tenant_id=NEW.tenant_id AND l.entity_id=NEW.entity_id AND l.journal_entry_id=NEW.journal_entry_id
  AND l.dimensions->>'fixed_asset_register_evidence_id'=a.fixed_asset_register_evidence_id::text AND l.account_code=a.asset_account_code AND l.debit_amount>0)
 ORDER BY a.fixed_asset_register_evidence_id FOR UPDATE OF a
 LOOP
  IF NOT EXISTS(SELECT 1 FROM fixed_asset_acquisition_binding b JOIN fixed_asset_acquisition_posting p ON p.tenant_id=b.tenant_id AND p.entity_id=b.entity_id AND p.asset_id=b.asset_id AND p.binding_id=b.binding_id AND p.journal_entry_id=b.journal_entry_id
   WHERE b.tenant_id=NEW.tenant_id AND b.entity_id=NEW.entity_id AND b.asset_id=asset.fixed_asset_register_evidence_id AND b.journal_entry_id=NEW.journal_entry_id)
  THEN RAISE EXCEPTION 'Asset cost debit requires an exact native acquisition binding and unique posting' USING ERRCODE='23514';END IF;
 END LOOP;
 RETURN NEW;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_require_asset_acquisition_on_post() FROM PUBLIC,refs_app;
CREATE TRIGGER fixed_asset_acquisition_required_guard BEFORE UPDATE OF status ON journal_entry FOR EACH ROW WHEN(NEW.status='POSTED' AND OLD.status<>'POSTED') EXECUTE FUNCTION refs_require_asset_acquisition_on_post();
COMMIT;
