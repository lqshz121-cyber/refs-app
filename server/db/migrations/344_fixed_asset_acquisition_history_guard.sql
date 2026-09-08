BEGIN;
-- Stabilize the upgrade population while validating retained Posted history.
LOCK TABLE journal_entry,fixed_asset_register_evidence IN SHARE MODE;
DO $$ BEGIN
 IF EXISTS(
  SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED'
  WHERE l.debit_amount>0 AND EXISTS(SELECT 1 FROM fixed_asset_register_evidence a WHERE a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.asset_account_code=l.account_code)
  AND NOT EXISTS(
   SELECT 1 FROM fixed_asset_register_evidence a JOIN fixed_asset_acquisition_binding b ON b.tenant_id=a.tenant_id AND b.entity_id=a.entity_id AND b.asset_id=a.fixed_asset_register_evidence_id
   JOIN fixed_asset_acquisition_posting p ON p.tenant_id=b.tenant_id AND p.entity_id=b.entity_id AND p.asset_id=b.asset_id AND p.binding_id=b.binding_id AND p.journal_entry_id=b.journal_entry_id
   JOIN source_link sl ON sl.source_link_id=b.source_link_id AND sl.tenant_id=b.tenant_id AND sl.entity_id=b.entity_id AND sl.source_document_id=b.source_document_id AND sl.source_document_line_id=b.source_document_line_id AND sl.journal_entry_id=b.journal_entry_id AND sl.link_type='SOURCE_TO_JE'
   WHERE a.tenant_id=l.tenant_id AND a.entity_id=l.entity_id AND a.asset_account_code=l.account_code AND a.fixed_asset_register_evidence_id::text=l.dimensions->>'fixed_asset_register_evidence_id'
    AND b.journal_entry_id=l.journal_entry_id AND b.attachment_ids IS NOT NULL AND b.attachment_snapshot_hash IS NOT NULL
    AND b.journal_snapshot_hash=refs_asset_acquisition_journal_snapshot(j.tenant_id,j.entity_id,j.journal_entry_id)
  )
 ) THEN RAISE EXCEPTION 'Posted asset cost history lacks exact acquisition evidence; review original records before upgrade' USING ERRCODE='55006';END IF;
END;$$;
COMMIT;
