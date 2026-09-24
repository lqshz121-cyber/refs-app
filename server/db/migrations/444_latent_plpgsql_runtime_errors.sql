BEGIN;

-- R12 follow-up (found 2026-09-25 by running plpgsql_check over every PL/pgSQL function at head 443).
--
-- Each defect below is a statement that compiles when the function is created but fails every time
-- it runs, so no deploy step notices and the feature behind it has never worked. None of these
-- functions had a PostgreSQL test that reached the statement. Each patch is fail-closed: it refuses
-- unless the exact text it replaces is present exactly once, and it changes only that text.
-- Not patched (retained, unreachable from any live path): refs_set_reconciliation_clearance_385,
-- refs_create_native_expense_395/_403, refs_read_native_expense_create_options_395/_403,
-- refs_read_unit_transfer_pair_370, refs_read_ai_construction_loan_lender_balances (superseded by
-- refs_read_ai_construction_loan_lender_balance_population).

-- 1. refs_read_custom_report: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_custom_report(uuid,uuid,uuid,text,text,text,integer,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 1 in refs_read_custom_report' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 2. refs_read_custom_report: Custom report budget read: the local snapshot_hash and budget_snapshot.snapshot_hash collide (42702).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$bs.snapshot_hash=snapshot_hash$old$;
  new_text constant text:=$new$bs.snapshot_hash=patch444.snapshot_hash$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_custom_report(uuid,uuid,uuid,text,text,text,integer,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 2 in refs_read_custom_report' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 3. refs_materialize_ai_bank_duplicate_payment_batch: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_bank_duplicate_payment_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 3 in refs_materialize_ai_bank_duplicate_payment_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 4. refs_materialize_ai_bank_duplicate_payment_batch: AI finding replay lookup: "finding_hash=finding_hash" is ambiguous between the local and the column (42702); the replay check must compare the column with the local.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND finding_hash=finding_hash;$old$;
  new_text constant text:=$new$AND ai_bank_duplicate_payment_finding.finding_hash=patch444.finding_hash;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_bank_duplicate_payment_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 4 in refs_materialize_ai_bank_duplicate_payment_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 5. refs_materialize_ai_vendor_invoice_anomaly_batch: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_anomaly_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 5 in refs_materialize_ai_vendor_invoice_anomaly_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 6. refs_materialize_ai_vendor_invoice_anomaly_batch: AI finding replay lookup: "finding_hash=finding_hash" is ambiguous between the local and the column (42702); the replay check must compare the column with the local.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND finding_hash=finding_hash;$old$;
  new_text constant text:=$new$AND ai_vendor_invoice_amount_anomaly_finding.finding_hash=patch444.finding_hash;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_anomaly_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 6 in refs_materialize_ai_vendor_invoice_anomaly_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 7. refs_materialize_ai_vendor_invoice_frequency_anomaly_batch: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_frequency_anomaly_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 7 in refs_materialize_ai_vendor_invoice_frequency_anomaly_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 8. refs_materialize_ai_vendor_invoice_frequency_anomaly_batch: AI finding replay lookup: "finding_hash=finding_hash" is ambiguous between the local and the column (42702); the replay check must compare the column with the local.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND finding_hash=finding_hash;$old$;
  new_text constant text:=$new$AND ai_vendor_invoice_frequency_anomaly_finding.finding_hash=patch444.finding_hash;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_frequency_anomaly_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 8 in refs_materialize_ai_vendor_invoice_frequency_anomaly_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 9. refs_materialize_ai_vendor_invoice_amount_drop_batch: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_amount_drop_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 9 in refs_materialize_ai_vendor_invoice_amount_drop_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 10. refs_materialize_ai_vendor_invoice_amount_drop_batch: AI finding replay lookup: "finding_hash=finding_hash" is ambiguous between the local and the column (42702); the replay check must compare the column with the local.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND finding_hash=finding_hash;$old$;
  new_text constant text:=$new$AND ai_vendor_invoice_amount_drop_finding.finding_hash=patch444.finding_hash;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_amount_drop_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 10 in refs_materialize_ai_vendor_invoice_amount_drop_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 11. refs_materialize_ai_vendor_invoice_near_duplicate_batch: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_near_duplicate_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 11 in refs_materialize_ai_vendor_invoice_near_duplicate_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 12. refs_materialize_ai_vendor_invoice_near_duplicate_batch: AI finding replay lookup: "finding_hash=finding_hash" is ambiguous between the local and the column (42702); the replay check must compare the column with the local.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND finding_hash=finding_hash;$old$;
  new_text constant text:=$new$AND ai_vendor_invoice_near_duplicate_finding.finding_hash=patch444.finding_hash;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_materialize_ai_vendor_invoice_near_duplicate_batch(uuid,uuid,uuid,jsonb,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 12 in refs_materialize_ai_vendor_invoice_near_duplicate_batch' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 13. refs_read_ai_ap_aging_risk_source: AI source read: RETURNS TABLE output columns (tenant_id, entity_id, ...) collide with unqualified table columns (42702). No statement reads an output variable, so columns win.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
$old$;
  new_text constant text:=$new$AS $function$
#variable_conflict use_column
$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_ap_aging_risk_source(uuid,uuid,date)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 13 in refs_read_ai_ap_aging_risk_source' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 14. refs_read_ai_ap_aging_risk_source: AP aging source: the UNION is ordered by aging_date, which is not an output column name of the first branch (0A000); order by position (aging date, document id).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$ORDER BY aging_date,business_document_id;$old$;
  new_text constant text:=$new$ORDER BY 12,3;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_ap_aging_risk_source(uuid,uuid,date)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 14 in refs_read_ai_ap_aging_risk_source' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 15. refs_read_ai_balance_sheet_account_aging_source: AI source read: RETURNS TABLE output columns (tenant_id, entity_id, ...) collide with unqualified table columns (42702). No statement reads an output variable, so columns win.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
$old$;
  new_text constant text:=$new$AS $function$
#variable_conflict use_column
$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_balance_sheet_account_aging_source(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 15 in refs_read_ai_balance_sheet_account_aging_source' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 16. refs_read_ai_construction_loan_project_cost_source: AI source read: RETURNS TABLE output columns (tenant_id, entity_id, ...) collide with unqualified table columns (42702). No statement reads an output variable, so columns win.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
$old$;
  new_text constant text:=$new$AS $function$
#variable_conflict use_column
$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_construction_loan_project_cost_source(uuid,uuid,uuid)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 16 in refs_read_ai_construction_loan_project_cost_source' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 17. refs_read_ai_invoice_source_support_inputs: AI source read: RETURNS TABLE output columns (tenant_id, entity_id, ...) collide with unqualified table columns (42702). No statement reads an output variable, so columns win.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
$old$;
  new_text constant text:=$new$AS $function$
#variable_conflict use_column
$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 17 in refs_read_ai_invoice_source_support_inputs' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 18. refs_read_ai_vendor_accounting_treatment_history: Vendor treatment history: source_document has no counterparty_name (42703). The vendor name is the VENDOR member display name, falling back to party_ref as before.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$btrim(source.counterparty_name)$old$;
  new_text constant text:=$new$btrim((SELECT m.display_name FROM member_master m WHERE m.tenant_id=line.tenant_id AND m.entity_id=line.entity_id AND m.member_ref=btrim(line.party_ref) AND m.member_type='VENDOR'))$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_vendor_accounting_treatment_history(uuid,uuid,uuid,integer)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 18 in refs_read_ai_vendor_accounting_treatment_history' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 19. refs_read_ai_invoice_source_support_inputs: Invoice source support: same missing source_document.counterparty_name (42703), in the select list.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$btrim(source.counterparty_name)$old$;
  new_text constant text:=$new$btrim((SELECT m.display_name FROM member_master m WHERE m.tenant_id=p_tenant AND m.entity_id=evidence.entity_id AND m.member_ref=btrim(line.party_ref) AND m.member_type='VENDOR'))$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 19 in refs_read_ai_invoice_source_support_inputs' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 20. refs_read_ai_invoice_source_support_inputs: Invoice source support: and in the GROUP BY.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$line.party_ref,source.counterparty_name,source.document_no$old$;
  new_text constant text:=$new$line.party_ref,source.document_no$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_ai_invoice_source_support_inputs(uuid,uuid,uuid,integer)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 20 in refs_read_ai_invoice_source_support_inputs' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 21. refs_cancel_unit_transfer_pair: Labels the top-level block <<patch444>> so the next patch can qualify a local variable.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AS $function$
DECLARE$old$;
  new_text constant text:=$new$AS $function$
<<patch444>>
DECLARE$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 21 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 22. refs_cancel_unit_transfer_pair: Unit Transfer cancel: "SET cancelled_at=cancelled_at" is ambiguous (42702); the column takes the local timestamp.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$cancelled_at=cancelled_at,$old$;
  new_text constant text:=$new$cancelled_at=patch444.cancelled_at,$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_cancel_unit_transfer_pair(uuid,uuid,uuid,bigint,bigint,bigint,text,text,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 22 in refs_cancel_unit_transfer_pair' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 23. refs_validate_report_saved_view: Report saved view: jsonb_object_length() does not exist (42883), so no saved view could be created or updated.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$jsonb_object_length(p_filters)>30$old$;
  new_text constant text:=$new$(SELECT count(*) FROM jsonb_object_keys(p_filters))>30$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_validate_report_saved_view(uuid,uuid,text,text,uuid,jsonb,text)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 23 in refs_validate_report_saved_view' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 24. refs_read_settlement_bank_account_pairs: Settlement bank-account pairs: ORDER BY an output alias with COLLATE is an expression, so the alias does not resolve (42703).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$ORDER BY pair_ref COLLATE "C"
    LIMIT p_limit+1$old$;
  new_text constant text:=$new$ORDER BY encode(convert_to(jsonb_build_array(m.member_ref,a.account_code,c.currency)::text,'UTF8'),'base64') COLLATE "C"
    LIMIT p_limit+1$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_read_settlement_bank_account_pairs(uuid,uuid,text,text,text,integer,uuid,date)'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 24 in refs_read_settlement_bank_account_pairs' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 25. refs_guard_unit_transfer_paired_reversal_journal_transition: Unit Transfer reversal Journal guard: gate operation (text) compared with journal_status (42883), so a reversal pair could never transition.
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$AND operation=NEW.status RETURNING$old$;
  new_text constant text:=$new$AND operation=NEW.status::text RETURNING$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_guard_unit_transfer_paired_reversal_journal_transition()'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 25 in refs_guard_unit_transfer_paired_reversal_journal_transition' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

-- 26. refs_validate_wbs_autorec_reversal_je: AutoRec reversal check: unused record variables ol/rl shadow the journal_line aliases of the same names ("record rl is not assigned yet", 55000).
DO $migration$
DECLARE
  definition text;
  old_text constant text:=$old$DECLARE original journal_entry; ol record; rl record;$old$;
  new_text constant text:=$new$DECLARE original journal_entry;$new$;
BEGIN
  SELECT pg_get_functiondef('public.refs_validate_wbs_autorec_reversal_je()'::regprocedure) INTO definition;
  IF position(old_text IN definition)=0 OR position(old_text IN substr(definition,position(old_text IN definition)+1))>0 THEN
    RAISE EXCEPTION 'Migration 444 requires the exact text of patch 26 in refs_validate_wbs_autorec_reversal_je' USING ERRCODE='55000';
  END IF;
  EXECUTE replace(definition,old_text,new_text);
END
$migration$;

COMMIT;
