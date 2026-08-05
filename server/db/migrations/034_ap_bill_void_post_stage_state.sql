BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_post_journal(uuid,uuid,uuid,uuid,bigint,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF NOT FOUND THEN RAISE EXCEPTION ''Automatic journal staging state is not approved'' USING ERRCODE=''23514''; END IF;',
    'IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM business_adjustment ba JOIN source_link direct_link ON direct_link.tenant_id=ba.tenant_id AND direct_link.entity_id=ba.entity_id AND direct_link.journal_entry_id=p_journal AND direct_link.source_document_id IS NOT NULL AND direct_link.staging_item_id IS NULL WHERE ba.tenant_id=p_tenant AND ba.entity_id=p_entity AND ba.draft_journal_entry_id=p_journal AND ba.adjustment_kind=''AP_BILL_VOID'') THEN RAISE EXCEPTION ''Automatic journal staging state is not approved'' USING ERRCODE=''23514''; END IF;');
  IF fn=old THEN RAISE EXCEPTION 'AP bill void post staging guard not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
