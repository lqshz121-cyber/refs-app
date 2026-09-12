BEGIN;
CREATE FUNCTION refs_create_cash_transfer_from_public_dto(
 p_tenant uuid,p_entity uuid,p_period uuid,p_date date,p_number text,p_currency char(3),p_from_account text,p_from_bank text,p_to_account text,p_to_bank text,p_amount numeric,p_attachments uuid[],p_reason text,p_idempotency_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE snapshot_hash text;request_hash text;attachments uuid[];
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.CREATE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.CREATE');
 IF refs_current_actor() IS NULL OR length(coalesce(p_idempotency_key,'')) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'Invalid Cash Transfer public create command' USING ERRCODE='22023'; END IF;
 SELECT ARRAY(SELECT id FROM unnest(COALESCE(p_attachments,'{}'::uuid[])) id ORDER BY id) INTO attachments;
 IF cardinality(attachments)<>cardinality(COALESCE(p_attachments,'{}'::uuid[])) OR cardinality(attachments)<>cardinality(ARRAY(SELECT DISTINCT id FROM unnest(COALESCE(p_attachments,'{}'::uuid[])) id)) THEN RAISE EXCEPTION 'Cash Transfer attachments must be unique canonical identifiers' USING ERRCODE='22023'; END IF;
 snapshot_hash:=refs_cash_transfer_attachment_snapshot(p_tenant,p_entity,attachments);
 IF snapshot_hash IS NULL THEN RAISE EXCEPTION 'Cash Transfer requires exact verified-clean retained attachment evidence' USING ERRCODE='23514'; END IF;
 request_hash:=refs_create_cash_transfer_hash(p_tenant,p_entity,p_period,p_date,p_currency,p_from_account,p_from_bank,p_to_account,p_to_bank,p_amount,p_number,attachments,snapshot_hash,p_reason);
 RETURN refs_create_cash_transfer(p_tenant,p_entity,p_period,p_date,p_currency,p_from_account,p_from_bank,p_to_account,p_to_bank,p_amount,p_number,attachments,snapshot_hash,p_reason,p_idempotency_key,request_hash);
END;$$;
REVOKE ALL ON FUNCTION refs_create_cash_transfer_from_public_dto(uuid,uuid,uuid,date,text,char(3),text,text,text,text,numeric,uuid[],text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_create_cash_transfer_from_public_dto(uuid,uuid,uuid,date,text,char(3),text,text,text,text,numeric,uuid[],text,text) TO refs_app;
COMMIT;