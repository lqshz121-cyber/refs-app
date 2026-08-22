BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_mapping_source_stage WHERE amount < 0) THEN
    RAISE EXCEPTION 'REFUSE DATA LOSS: signed WBS H1 payable mapping facts exist';
  END IF;
END $$;

ALTER TABLE wbs_h1_payable_mapping_source_stage
  DROP CONSTRAINT wbs_h1_payable_mapping_source_stage_amount_check;

ALTER TABLE wbs_h1_payable_mapping_source_stage
  ADD CONSTRAINT wbs_h1_payable_mapping_source_stage_amount_check CHECK(amount > 0);

COMMIT;
