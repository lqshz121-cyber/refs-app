BEGIN;

CREATE FUNCTION refs_list_wbs_property_rent_pickup(p_tenant uuid,p_entity uuid,p_limit integer DEFAULT 50)
RETURNS TABLE(
 wbs_property_rent_source_admission_id uuid,wbs_property_rent_review_evidence_id uuid,wbs_property_rent_draft_evidence_id uuid,
 source_document_id uuid,staging_item_id uuid,business_document_id uuid,journal_entry_id uuid,period_id uuid,mapping_snapshot_id uuid,mapping_snapshot_hash text,mapping_version bigint,
 source_version text,receipt_hash text,evidence_hash text,property_ref text,unit_ref text,lease_ref text,tenant_ref text,
 document_number text,accounting_date date,due_date date,currency char(3),gross_amount text,
 workflow_status text,revision bigint,admitted_by text,reviewed_by text,drafted_by text,reviewed_at timestamptz,drafted_at timestamptz,posted_at timestamptz,
 can_review boolean,can_create_draft boolean,can_post boolean
) LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
 IF refs_current_tenant() IS DISTINCT FROM p_tenant OR NOT refs_entity_allowed(p_entity) OR NOT (
  refs_entity_has_permission(p_entity,'WBS.PROPERTY.REVIEW') OR
  refs_entity_has_permission(p_entity,'WBS.PROPERTY.RENT.REVIEW') OR
  refs_entity_has_permission(p_entity,'WBS.PROPERTY.RENT.DRAFT')
 ) THEN RAISE EXCEPTION 'Property Rent pickup scope is forbidden' USING ERRCODE='42501';END IF;
 IF p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Property Rent pickup limit must be 1-50' USING ERRCODE='22023';END IF;
 RETURN QUERY
 SELECT a.wbs_property_rent_source_admission_id,r.wbs_property_rent_review_evidence_id,d.wbs_property_rent_draft_evidence_id,
  a.source_document_id,a.staging_item_id,d.business_document_id,d.journal_entry_id,r.period_id,r.mapping_snapshot_id,ms.snapshot_hash,ms.version,
  a.source_version,a.receipt_hash,a.evidence_hash,a.property_ref,a.unit_ref,a.lease_ref,a.tenant_ref,
  sd.document_no,sd.accounting_date,bd.due_date,sd.currency,to_char(sd.gross_amount,'FM9999999999999990.0000'),
  COALESCE(je.status::text,CASE WHEN r.wbs_property_rent_review_evidence_id IS NOT NULL THEN 'READY_FOR_DRAFT' ELSE 'PENDING_REVIEW' END),
  si.version,a.admitted_by,r.reviewed_by,d.created_by,r.created_at,d.created_at,je.posted_at,
  (r.wbs_property_rent_review_evidence_id IS NULL AND refs_current_actor()<>a.admitted_by AND refs_entity_has_permission(p_entity,'WBS.PROPERTY.RENT.REVIEW')),
  (r.wbs_property_rent_review_evidence_id IS NOT NULL AND d.wbs_property_rent_draft_evidence_id IS NULL AND refs_current_actor()<>r.reviewed_by AND refs_current_actor()<>a.admitted_by AND refs_entity_has_permission(p_entity,'WBS.PROPERTY.RENT.DRAFT') AND refs_entity_has_permission(p_entity,'AR.INVOICE.CREATE') AND refs_entity_has_permission(p_entity,'GL.JE.AUTO.CREATE')),
  false
 FROM wbs_property_rent_source_admission a
 JOIN source_document sd ON sd.tenant_id=a.tenant_id AND sd.entity_id=a.entity_id AND sd.source_document_id=a.source_document_id
 JOIN staging_item si ON si.tenant_id=a.tenant_id AND si.entity_id=a.entity_id AND si.staging_item_id=a.staging_item_id
 LEFT JOIN wbs_property_rent_review_evidence r ON r.tenant_id=a.tenant_id AND r.entity_id=a.entity_id AND r.wbs_property_rent_source_admission_id=a.wbs_property_rent_source_admission_id
 LEFT JOIN wbs_property_rent_draft_evidence d ON d.tenant_id=a.tenant_id AND d.entity_id=a.entity_id AND d.wbs_property_rent_review_evidence_id=r.wbs_property_rent_review_evidence_id
 LEFT JOIN mapping_snapshot ms ON ms.tenant_id=a.tenant_id AND ms.mapping_snapshot_id=r.mapping_snapshot_id
 LEFT JOIN business_document bd ON bd.tenant_id=a.tenant_id AND bd.entity_id=a.entity_id AND bd.business_document_id=d.business_document_id
 LEFT JOIN journal_entry je ON je.tenant_id=a.tenant_id AND je.entity_id=a.entity_id AND je.journal_entry_id=d.journal_entry_id
 WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
 ORDER BY a.admitted_at DESC,a.wbs_property_rent_source_admission_id DESC LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION refs_list_wbs_property_rent_pickup(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_list_wbs_property_rent_pickup(uuid,uuid,integer) TO refs_app;

COMMIT;
