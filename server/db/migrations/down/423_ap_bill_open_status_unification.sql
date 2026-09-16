-- Reverses 423 text-for-text. Any bill already voided through the widened
-- predicate keeps its posted ledger; this only narrows future commands.
BEGIN;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_create_ap_bill_void(uuid,uuid,uuid,uuid,bigint,text,date,text,text,text)'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'IF bill.source_document_id IS NOT NULL THEN
    INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
      VALUES(p_tenant,p_entity,''SOURCE_TO_JE'',bill.source_document_id,journal_id,actor);
  ELSE
    INSERT INTO source_link(tenant_id,entity_id,link_type,journal_entry_id,attachment_id,created_by)
      SELECT p_tenant,p_entity,''JE_ATTACHMENT'',journal_id,attachment_id,actor FROM source_link
        WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=original.journal_entry_id AND link_type=''JE_ATTACHMENT'' AND attachment_id IS NOT NULL;
  END IF;',
    'INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by)
    VALUES(p_tenant,p_entity,''SOURCE_TO_JE'',bill.source_document_id,journal_id,actor);');
  IF fn=old THEN RAISE EXCEPTION '423 down void command: expected text not found' USING ERRCODE='55000'; END IF;
  old:=fn;
  fn:=replace(fn,
    'btrim(p_journal_number),CASE WHEN bill.source_document_id IS NULL THEN original.journal_type ELSE ''AUTO'' END,''DRAFT'',p_journal_date,bill.currency,''Void AP bill ''',
    'btrim(p_journal_number),''AUTO'',''DRAFT'',p_journal_date,bill.currency,''Void AP bill ''');
  IF fn=old THEN RAISE EXCEPTION '423 down void command: expected text not found' USING ERRCODE='55000'; END IF;
  old:=fn;
  fn:=replace(fn,
    'IF bill.source_document_id IS NULL AND NOT EXISTS (SELECT 1 FROM source_link WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=bill.posted_journal_entry_id AND link_type=''JE_ATTACHMENT'' AND attachment_id IS NOT NULL) THEN
    RAISE EXCEPTION ''Only fully-open posted AP bills with source trace or attachment evidence can be voided'' USING ERRCODE=''23514'';
  END IF;
  IF EXISTS (SELECT 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill AND status=''ACTIVE'') THEN',
    'IF EXISTS (SELECT 1 FROM business_allocation WHERE tenant_id=p_tenant AND entity_id=p_entity AND business_document_id=p_bill AND status=''ACTIVE'') THEN');
  IF fn=old THEN RAISE EXCEPTION '423 down void command: expected text not found' USING ERRCODE='55000'; END IF;
  old:=fn;
  fn:=replace(fn,
    'bill.status NOT IN (''APPROVED'',''OPEN'') OR bill.open_balance<>bill.gross_amount OR bill.posted_journal_entry_id IS NULL THEN',
    'bill.status<>''APPROVED'' OR bill.open_balance<>bill.gross_amount OR bill.source_document_id IS NULL OR bill.posted_journal_entry_id IS NULL THEN');
  IF fn=old THEN RAISE EXCEPTION '423 down void command: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_ar_posted_adjustment()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'bill.status NOT IN (''APPROVED'',''OPEN'') OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency',
    'bill.status<>''APPROVED'' OR bill.open_balance<>bill.gross_amount OR bill.currency<>adj.currency');
  IF fn=old THEN RAISE EXCEPTION '423 down void reducer: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
DO $$
DECLARE fn text; old text;
BEGIN
  SELECT pg_get_functiondef('refs_apply_ap_payment_reversal_posted()'::regprocedure) INTO fn;
  old:=fn;
  fn:=replace(fn,
    'THEN ''OPEN'' ELSE ''PARTIALLY_PAID'' END',
    'THEN ''APPROVED'' ELSE ''PARTIALLY_PAID'' END');
  IF fn=old THEN RAISE EXCEPTION '423 down payment reversal reducer: expected text not found' USING ERRCODE='55000'; END IF;
  EXECUTE fn;
END $$;
COMMIT;
