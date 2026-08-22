BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_mapping_source_stage)
     OR EXISTS(SELECT 1 FROM wbs_h1_accounting_setting_stage) THEN
    RAISE EXCEPTION 'REFUSE DATA LOSS: WBS H1 mapping stage contains retained evidence' USING ERRCODE='55000';
  END IF;
END $$;

DROP TABLE wbs_h1_accounting_setting_stage;
DROP TABLE wbs_h1_payable_mapping_source_stage;

COMMIT;
