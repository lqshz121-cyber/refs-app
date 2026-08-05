BEGIN;

REVOKE ALL ON business_document,payment_occurrence,business_adjustment,business_allocation,je_reversal_link FROM refs_app;

DROP TABLE IF EXISTS je_reversal_link;
DROP TABLE IF EXISTS business_allocation;
DROP TABLE IF EXISTS business_adjustment;
DROP TABLE IF EXISTS payment_occurrence;
DROP TABLE IF EXISTS business_document;

DELETE FROM permission_catalog
  WHERE permission_code IN (
    'AP.BILL.VOID.CREATE',
    'AP.BILL.VOID.APPROVE',
    'AP.VENDOR_CREDIT.CREATE',
    'AP.VENDOR_CREDIT.APPLY',
    'AP.PAYMENT.REVERSE',
    'AR.CREDIT_MEMO.CREATE',
    'AR.CREDIT_MEMO.APPLY',
    'AR.REFUND.CREATE',
    'AR.RECEIPT.REVERSE'
  );

COMMIT;
