BEGIN;

ALTER TABLE wbs_h1_payable_mapping_source_stage
  DROP CONSTRAINT wbs_h1_payable_mapping_source_stage_amount_check;

ALTER TABLE wbs_h1_payable_mapping_source_stage
  ADD CONSTRAINT wbs_h1_payable_mapping_source_stage_amount_check CHECK(amount <> 0);

COMMIT;
