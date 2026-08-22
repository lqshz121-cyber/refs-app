BEGIN;

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM wbs_h1_payable_cost_code_stage) THEN
    RAISE EXCEPTION 'REFUSE DATA LOSS: WBS H1 payable cost-code evidence exists';
  END IF;
END $$;

DROP TABLE wbs_h1_payable_cost_code_stage;

COMMIT;
