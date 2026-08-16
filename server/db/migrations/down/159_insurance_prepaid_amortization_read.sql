BEGIN; -- 145 Insurance/Prepaid GET-only read contract
DROP FUNCTION refs_read_insurance_prepaid_amortization(uuid,uuid,uuid,integer);
COMMIT;
