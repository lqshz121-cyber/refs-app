BEGIN;

-- A later provider-signed delivery is independent authority.  When it contains
-- the exact same provider row as an existing operator-retained exception,
-- record that equivalence in the same transaction.  The unsigned exception is
-- never promoted; Review and Draft continue to consume only wbs_inbound_row.
ALTER FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text)
  RENAME TO refs_admit_wbs_provider_signed_payables_111;

CREATE FUNCTION refs_admit_wbs_provider_signed_payables(
  p_tenant uuid,p_entity uuid,p_delivery jsonb,p_snapshot jsonb,p_groups jsonb,
  p_idempotency_key text,p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb; candidate record; link_hash text; link_result jsonb;
DECLARE linked_count integer:=0; link_key text;
BEGIN
  result:=refs_admit_wbs_provider_signed_payables_111(
    p_tenant,p_entity,p_delivery,p_snapshot,p_groups,p_idempotency_key,p_request_hash
  );

  FOR candidate IN
    SELECT DISTINCT ON (signed_row.wbs_inbound_row_id)
      operator_row.wbs_operator_payable_evidence_row_id AS operator_row_id,
      signed_row.wbs_inbound_row_id AS signed_row_id
    FROM wbs_inbound_receipt inbound_receipt
    JOIN wbs_inbound_row signed_row
      ON signed_row.tenant_id=inbound_receipt.tenant_id
     AND signed_row.entity_id=inbound_receipt.entity_id
     AND signed_row.receipt_id=inbound_receipt.receipt_id
    JOIN wbs_operator_payable_evidence_provider_hash provider_hash
      ON provider_hash.tenant_id=signed_row.tenant_id
     AND provider_hash.entity_id=signed_row.entity_id
     AND provider_hash.provider_row_hash=signed_row.normalized->>'upstream_mcp_row_hash'
    JOIN wbs_operator_payable_evidence_row operator_row
      ON operator_row.tenant_id=provider_hash.tenant_id
     AND operator_row.entity_id=provider_hash.entity_id
     AND operator_row.wbs_operator_payable_evidence_row_id=provider_hash.wbs_operator_payable_evidence_row_id
     AND operator_row.source_record_id=signed_row.source_record_id
    JOIN wbs_operator_payable_attestation operator_attestation
      ON operator_attestation.tenant_id=operator_row.tenant_id
     AND operator_attestation.entity_id=operator_row.entity_id
     AND operator_attestation.wbs_operator_payable_attestation_id=operator_row.wbs_operator_payable_attestation_id
     AND operator_attestation.provider_content_hash=signed_row.normalized->>'upstream_mcp_content_hash'
     AND jsonb_array_length(operator_attestation.company_codes)=1
     AND operator_attestation.company_codes->>0=signed_row.normalized->>'company_key'
    WHERE inbound_receipt.tenant_id=p_tenant AND inbound_receipt.entity_id=p_entity
      AND inbound_receipt.import_batch_id=(result->>'import_batch_id')::uuid
      AND operator_row.evidence_status='EXCEPTION_REVIEW_REQUIRED'
      AND NOT EXISTS(
        SELECT 1 FROM wbs_operator_signed_source_link existing
        WHERE existing.tenant_id=p_tenant AND existing.entity_id=p_entity
          AND (existing.wbs_operator_payable_evidence_row_id=operator_row.wbs_operator_payable_evidence_row_id
            OR existing.wbs_inbound_row_id=signed_row.wbs_inbound_row_id)
      )
    ORDER BY signed_row.wbs_inbound_row_id,operator_attestation.attested_at DESC,
      operator_row.wbs_operator_payable_evidence_row_id
  LOOP
    link_hash:=refs_wbs_operator_signed_source_link_hash(
      p_tenant,p_entity,candidate.operator_row_id,candidate.signed_row_id
    );
    link_key:='wbs-auto-bridge:'||substr(replace(link_hash,'sha256:',''),1,48);
    link_result:=refs_link_wbs_operator_evidence_to_signed_source(
      p_tenant,p_entity,candidate.operator_row_id,candidate.signed_row_id,link_key,link_hash
    );
    IF link_result->>'wbs_operator_signed_source_link_id' IS NOT NULL THEN
      linked_count:=linked_count+1;
    END IF;
  END LOOP;

  RETURN result||jsonb_build_object('linked_operator_exception_count',linked_count);
END;
$$;

REVOKE ALL ON FUNCTION refs_admit_wbs_provider_signed_payables_111(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC,refs_app;
REVOKE ALL ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_admit_wbs_provider_signed_payables(uuid,uuid,jsonb,jsonb,jsonb,text,text) TO refs_app;

COMMIT;
