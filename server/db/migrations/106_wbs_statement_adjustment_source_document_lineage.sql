BEGIN;

-- Keep the original adjustment workflow intact, but add an explicit immutable
-- source-document edge for the exact bank row it already binds.  Report and GL
-- readers deliberately follow source_link.source_document_id, so this closes
-- the WBS statement -> adjustment JE -> report drillback without inferring a
-- source document from a bank account or amount.
ALTER FUNCTION refs_create_reconciliation_adjustment_draft(
  uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text
) RENAME TO refs_create_reconciliation_adjustment_draft_105;

CREATE FUNCTION refs_create_reconciliation_adjustment_draft(
  p_tenant uuid,p_entity uuid,p_reconciliation uuid,p_bank_source uuid,p_expected_reconciliation_version bigint,
  p_period uuid,p_journal_number text,p_journal_date date,p_currency char(3),p_description text,
  p_lines jsonb,p_attachment_ids uuid[],p_reason text,p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE response jsonb; bank_document_id uuid; actor text:=refs_current_actor();
BEGIN
  response:=refs_create_reconciliation_adjustment_draft_105(
    p_tenant,p_entity,p_reconciliation,p_bank_source,p_expected_reconciliation_version,
    p_period,p_journal_number,p_journal_date,p_currency,p_description,
    p_lines,p_attachment_ids,p_reason,p_idempotency_key,p_request_hash
  );

  SELECT source_document_id INTO bank_document_id
  FROM bank_source
  WHERE tenant_id=p_tenant AND entity_id=p_entity AND bank_source_id=p_bank_source;
  IF bank_document_id IS NULL THEN
    RAISE EXCEPTION 'Reconciliation adjustment bank source must retain an immutable source document' USING ERRCODE='23514';
  END IF;

  INSERT INTO source_link(
    tenant_id,entity_id,link_type,source_document_id,reconciliation_id,journal_entry_id,bank_source_id,created_by
  ) VALUES(
    p_tenant,p_entity,'RECONCILIATION_ADJUSTMENT_SOURCE_DOCUMENT',bank_document_id,
    p_reconciliation,(response->>'journal_entry_id')::uuid,p_bank_source,actor
  ) ON CONFLICT DO NOTHING;
  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft_105(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_reconciliation_adjustment_draft(uuid,uuid,uuid,uuid,bigint,uuid,text,date,char,text,jsonb,uuid[],text,text,text) TO refs_app;

COMMIT;
