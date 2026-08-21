BEGIN;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM ai_vendor_invoice_amount_anomaly_finding) THEN RAISE EXCEPTION 'Cannot remove retained vendor anomaly findings'; END IF; END $$;
DROP FUNCTION refs_materialize_ai_vendor_invoice_anomaly_batch(uuid,uuid,uuid,jsonb,text,text);
DROP FUNCTION refs_ai_vendor_invoice_anomaly_batch_hash(uuid,uuid,uuid,jsonb);
DROP TABLE ai_vendor_invoice_amount_anomaly_finding;
COMMIT;
