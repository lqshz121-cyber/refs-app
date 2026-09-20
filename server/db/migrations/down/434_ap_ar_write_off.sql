BEGIN;

-- Conditional barrier, in the style of the other 43: a write-off that has been drafted or posted
-- is accounting evidence, and narrowing the adjustment_kind CHECK underneath it would either fail
-- on the constraint or, worse, orphan a posted adjustment from its own kind. Refuse instead.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM business_adjustment WHERE adjustment_kind IN ('AP_BILL_WRITE_OFF','AR_INVOICE_WRITE_OFF')) THEN
    RAISE EXCEPTION 'AP/AR write-off evidence is retained; migration 434 cannot be rolled back while write-off adjustments exist'
      USING ERRCODE='55006';
  END IF;
END $$;

DROP FUNCTION IF EXISTS refs_create_ap_ar_write_off(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text,text,text);
DROP FUNCTION IF EXISTS refs_ap_ar_write_off_hash(uuid,uuid,uuid,uuid,text,date,numeric,text,uuid[],text);

DROP TRIGGER IF EXISTS ap_ar_write_off_binding_append_only ON ap_ar_write_off_binding;
DROP POLICY IF EXISTS ap_ar_write_off_binding_scope ON ap_ar_write_off_binding;
DROP INDEX IF EXISTS ap_ar_write_off_binding_scope_idx;
DROP TABLE IF EXISTS ap_ar_write_off_binding;

ALTER TABLE business_adjustment DROP CONSTRAINT IF EXISTS business_adjustment_adjustment_kind_check;
ALTER TABLE business_adjustment ADD CONSTRAINT business_adjustment_adjustment_kind_check
  CHECK (adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL','AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL'));

ALTER TABLE business_adjustment DROP CONSTRAINT IF EXISTS business_adjustment_check;
ALTER TABLE business_adjustment ADD CONSTRAINT business_adjustment_check CHECK (
  (adjustment_kind IN ('AP_VENDOR_CREDIT','AR_CREDIT_MEMO') AND business_document_id IS NULL)
  OR (adjustment_kind = 'AP_BILL_VOID' AND business_document_id IS NOT NULL)
  OR (adjustment_kind = 'AR_REFUND' AND source_adjustment_id IS NOT NULL)
  OR (adjustment_kind IN ('AP_PAYMENT_REVERSAL','AR_RECEIPT_REVERSAL') AND source_occurrence_id IS NOT NULL)
);

DELETE FROM runtime_human_permission_authority WHERE permission_code IN
  ('AP.BILL.WRITE_OFF.CREATE','AP.BILL.WRITE_OFF.APPROVE','AR.INVOICE.WRITE_OFF.CREATE','AR.INVOICE.WRITE_OFF.APPROVE');
DELETE FROM permission_catalog WHERE permission_code IN
  ('AP.BILL.WRITE_OFF.CREATE','AP.BILL.WRITE_OFF.APPROVE','AR.INVOICE.WRITE_OFF.CREATE','AR.INVOICE.WRITE_OFF.APPROVE');

COMMIT;
