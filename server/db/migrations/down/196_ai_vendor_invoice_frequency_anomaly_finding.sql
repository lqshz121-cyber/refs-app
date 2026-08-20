BEGIN;
DO $$BEGIN IF EXISTS(SELECT 1 FROM ai_vendor_invoice_frequency_anomaly_finding LIMIT 1) THEN RAISE EXCEPTION 'Cannot erase retained vendor frequency anomaly evidence' USING ERRCODE='55000';END IF;END$$;
REVOKE ALL ON FUNCTION refs_ai_vendor_invoice_frequency_anomaly_batch_hash(uuid,uuid,uuid,jsonb),refs_materialize_ai_vendor_invoice_frequency_anomaly_batch(uuid,uuid,uuid,jsonb,text,text) FROM refs_app;
DROP FUNCTION refs_materialize_ai_vendor_invoice_frequency_anomaly_batch(uuid,uuid,uuid,jsonb,text,text);DROP FUNCTION refs_ai_vendor_invoice_frequency_anomaly_batch_hash(uuid,uuid,uuid,jsonb);DROP TABLE ai_vendor_invoice_frequency_anomaly_source;DROP TABLE ai_vendor_invoice_frequency_anomaly_finding;
COMMIT;
