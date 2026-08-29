BEGIN;
REVOKE EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text) FROM refs_app;
DROP FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,integer,text,text,text);
ALTER FUNCTION refs_retain_ai_accounting_decision_batch_v256(uuid,uuid,uuid,jsonb,text,text) RENAME TO refs_retain_ai_accounting_decision_batch;
GRANT EXECUTE ON FUNCTION refs_retain_ai_accounting_decision_batch(uuid,uuid,uuid,jsonb,text,text) TO refs_app;
REVOKE EXECUTE ON FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer),refs_read_ai_loan_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer) FROM refs_app;
DROP FUNCTION refs_read_ai_loan_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer);
DROP FUNCTION refs_read_ai_invoice_decision_population_page(uuid,uuid,uuid,date,uuid,integer,uuid,integer);
COMMIT;
