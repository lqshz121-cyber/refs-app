BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM wbs_property_rent_review_evidence) OR EXISTS(SELECT 1 FROM wbs_property_rent_draft_evidence) THEN
  RAISE EXCEPTION 'Cannot remove retained WBS Property Rent review or Draft evidence';
 END IF;
END $$;
REVOKE EXECUTE ON FUNCTION refs_review_wbs_property_rent_hash(uuid,uuid,uuid,uuid,bigint,text,text),refs_review_wbs_property_rent(uuid,uuid,uuid,uuid,bigint,text,text,text,text),refs_create_wbs_property_rent_draft_hash(uuid,uuid,uuid,bigint,text,text),refs_create_wbs_property_rent_draft(uuid,uuid,uuid,bigint,text,text,text,text) FROM refs_app;
DROP FUNCTION refs_create_wbs_property_rent_draft(uuid,uuid,uuid,bigint,text,text,text,text);
DROP FUNCTION refs_create_wbs_property_rent_draft_hash(uuid,uuid,uuid,bigint,text,text);
DROP FUNCTION refs_review_wbs_property_rent(uuid,uuid,uuid,uuid,bigint,text,text,text,text);
DROP FUNCTION refs_review_wbs_property_rent_hash(uuid,uuid,uuid,uuid,bigint,text,text);
DROP TABLE wbs_property_rent_draft_evidence;
DROP TABLE wbs_property_rent_review_evidence;
UPDATE permission_catalog SET active=false,effective_to=clock_timestamp(),version=version+1 WHERE permission_code IN('WBS.PROPERTY.RENT.REVIEW','WBS.PROPERTY.RENT.DRAFT');
COMMIT;
