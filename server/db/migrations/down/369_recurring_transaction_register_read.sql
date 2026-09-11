BEGIN;
DROP FUNCTION IF EXISTS refs_read_recurring_transaction_detail(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS refs_read_recurring_transaction_register(uuid,uuid,text,text,uuid,integer);
DROP FUNCTION IF EXISTS refs_project_recurring_transaction_row(uuid,uuid,uuid,boolean);
DROP FUNCTION IF EXISTS refs_recurring_date(text);
DROP FUNCTION IF EXISTS refs_recurring_interval(text);
DROP FUNCTION IF EXISTS refs_recurring_status(text);
DO $migration$
DECLARE definition text;
BEGIN
  SELECT pg_get_functiondef(
    'public.refs_retain_wbs_final1_source_evidence(uuid,uuid,jsonb,jsonb,jsonb,text,text)'::regprocedure
  ) INTO definition;
  IF position(
    'OR NULLIF(btrim(row_value#>>''{raw_row,service_period_start}''),'''') IS DISTINCT FROM NULLIF(normalized->>''servicePeriodStart'','''') OR NULLIF(btrim(row_value#>>''{raw_row,service_period_end}''),'''') IS DISTINCT FROM NULLIF(normalized->>''servicePeriodEnd'','''') OR NULLIF(btrim(row_value#>>''{raw_row,recurring_obligation_id}''),'''') IS DISTINCT FROM NULLIF(normalized->>''recurringObligationId'','''') OR NULLIF(btrim(row_value#>>''{raw_row,contract_id}''),'''') IS DISTINCT FROM NULLIF(normalized->>''contractId'','''') OR NULLIF(btrim(row_value#>>''{raw_row,charge_code}''),'''') IS DISTINCT FROM NULLIF(normalized->>''chargeCode'','''') OR NULLIF(btrim(row_value#>>''{raw_row,service_frequency}''),'''') IS DISTINCT FROM NULLIF(normalized->>''serviceFrequency'','''') OR NULLIF(btrim(row_value#>>''{raw_row,obligation_status}''),'''') IS DISTINCT FROM NULLIF(normalized->>''obligationStatus'','''')' IN definition
  )>0 THEN
    definition:=replace(
      definition,
      'OR NULLIF(btrim(row_value#>>''{raw_row,service_period_start}''),'''') IS DISTINCT FROM NULLIF(normalized->>''servicePeriodStart'','''') OR NULLIF(btrim(row_value#>>''{raw_row,service_period_end}''),'''') IS DISTINCT FROM NULLIF(normalized->>''servicePeriodEnd'','''') OR NULLIF(btrim(row_value#>>''{raw_row,recurring_obligation_id}''),'''') IS DISTINCT FROM NULLIF(normalized->>''recurringObligationId'','''') OR NULLIF(btrim(row_value#>>''{raw_row,contract_id}''),'''') IS DISTINCT FROM NULLIF(normalized->>''contractId'','''') OR NULLIF(btrim(row_value#>>''{raw_row,charge_code}''),'''') IS DISTINCT FROM NULLIF(normalized->>''chargeCode'','''') OR NULLIF(btrim(row_value#>>''{raw_row,service_frequency}''),'''') IS DISTINCT FROM NULLIF(normalized->>''serviceFrequency'','''') OR NULLIF(btrim(row_value#>>''{raw_row,obligation_status}''),'''') IS DISTINCT FROM NULLIF(normalized->>''obligationStatus'','''')',
      'OR (row_value->''raw_row''->''service_period_start'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_period_end'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''recurring_obligation_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''contract_id'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''charge_code'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''service_frequency'') IS DISTINCT FROM ''null''::jsonb OR (row_value->''raw_row''->''obligation_status'') IS DISTINCT FROM ''null''::jsonb'
    );
  ELSIF position('(row_value->''raw_row''->''recurring_obligation_id'') IS DISTINCT FROM ''null''::jsonb' IN definition)=0 THEN
    RAISE EXCEPTION 'Unexpected Final-1 recurring source validation definition on rollback' USING ERRCODE='22023';
  END IF;
  EXECUTE definition;
END
$migration$;
COMMIT;
