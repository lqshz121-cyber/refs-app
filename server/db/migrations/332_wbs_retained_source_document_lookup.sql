BEGIN;

-- The admitted-source review triggers resolve retained evidence by the exact
-- source document twice during each Payables row admission. Without this
-- access path, a bounded 500-row admission repeatedly scans the growing
-- retained population and can exceed the 10-second business statement limit.
CREATE INDEX wbs_final1_retained_source_document_lookup_idx
  ON wbs_final1_retained_source_row(tenant_id,entity_id,source_document_id);

COMMIT;
