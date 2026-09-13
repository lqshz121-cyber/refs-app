BEGIN;

CREATE OR REPLACE FUNCTION refs_guard_unit_transfer_source_link_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE row_tenant uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;row_entity uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.entity_id ELSE NEW.entity_id END;row_journal uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.journal_entry_id ELSE NEW.journal_entry_id END;
BEGIN
 IF row_journal IS NOT NULL AND EXISTS(SELECT 1 FROM unit_transfer_pair p WHERE p.tenant_id=row_tenant AND(p.source_entity_id=row_entity AND p.source_journal_entry_id=row_journal OR p.target_entity_id=row_entity AND p.target_journal_entry_id=row_journal)) THEN RAISE EXCEPTION 'Unit Transfer Journal lineage is retained evidence and cannot be edited' USING ERRCODE='55000';END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;$$;

COMMIT;