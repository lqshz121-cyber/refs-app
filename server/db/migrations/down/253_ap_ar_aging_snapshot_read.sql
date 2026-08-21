BEGIN;
DROP FUNCTION IF EXISTS refs_list_ap_ar_aging_detail(uuid,uuid,text,uuid,date,text,text,char,integer,integer);
DROP FUNCTION IF EXISTS refs_read_ap_ar_aging_detail_scope(uuid,uuid,text,uuid,date,text,text,char);
DROP FUNCTION IF EXISTS refs_list_ap_ar_aging_summary(uuid,uuid,text,uuid,date);
DROP FUNCTION IF EXISTS refs_read_ap_ar_aging_snapshot_scope(uuid,uuid,text,uuid,date);
DROP FUNCTION IF EXISTS refs_ap_ar_aging_snapshot_rows(uuid,uuid,text,date);
DROP INDEX IF EXISTS business_adjustment_occurrence_history_idx;
DROP INDEX IF EXISTS business_allocation_aging_history_idx;
COMMIT;
