BEGIN;

-- Cost GL cannot be reconciled from a partial report. This guard is at the
-- persistence boundary so direct SQL or a future adapter cannot bypass it.
CREATE OR REPLACE FUNCTION refs_validate_wbs_control_metric_cardinality()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE item_count integer; distinct_key_count integer;
BEGIN
  SELECT count(*), count(DISTINCT item->>'metric_key')
    INTO item_count, distinct_key_count
    FROM jsonb_array_elements(NEW.metrics) item;
  IF item_count=0 OR item_count<>distinct_key_count
     OR EXISTS(
       SELECT 1 FROM jsonb_array_elements(NEW.metrics) item
       WHERE jsonb_typeof(item)<>'object'
          OR coalesce(item->>'metric_key','') !~ '^[A-Z][A-Z0-9_]{1,95}$'
          OR coalesce(item->>'amount','') !~ '^-?(0|[1-9][0-9]*)([.][0-9]{1,4})?$'
     ) THEN
    RAISE EXCEPTION 'WBS control metrics must contain unique canonical keys and four-decimal amounts' USING ERRCODE='22023';
  END IF;
  IF NEW.source_type='COST_GENERAL_LEDGER' AND item_count<>14 THEN
    RAISE EXCEPTION 'WBS Cost General Ledger requires exactly fourteen metrics' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER wbs_control_metric_snapshot_metric_cardinality
  BEFORE INSERT OR UPDATE OF source_type,metrics ON wbs_control_metric_snapshot
  FOR EACH ROW EXECUTE FUNCTION refs_validate_wbs_control_metric_cardinality();

REVOKE ALL ON FUNCTION refs_validate_wbs_control_metric_cardinality() FROM PUBLIC,refs_app;

COMMIT;
