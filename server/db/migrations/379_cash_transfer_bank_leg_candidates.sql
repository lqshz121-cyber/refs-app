BEGIN;
REVOKE ALL ON cash_transfer, cash_transfer_bank_account_control, bank_source FROM refs_app;
DO $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='cash_transfer'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='cash_transfer_bank_account_control'::regclass AND relrowsecurity)
    OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='bank_source'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Cash Transfer bank-leg candidates require RLS on retained transfer, control, and bank evidence' USING ERRCODE='55000';
 END IF;
 IF has_table_privilege('refs_app','cash_transfer','SELECT') OR has_table_privilege('refs_app','cash_transfer_bank_account_control','SELECT') OR has_table_privilege('refs_app','bank_source','SELECT') THEN
  RAISE EXCEPTION 'refs_app must not retain direct Cash Transfer bank-leg candidate table access' USING ERRCODE='55000';
 END IF;
END $$;

CREATE FUNCTION refs_read_cash_transfer_bank_leg_candidates(
 p_tenant uuid,p_entity uuid,p_transfer uuid,p_leg text,p_limit integer,p_after_external_line text,p_after_bank_source uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE t cash_transfer;bank_ref text;expected_amount numeric(20,4);items jsonb;more boolean;next_cursor jsonb;
BEGIN
 IF p_leg NOT IN('SOURCE','DESTINATION') OR p_limit NOT BETWEEN 1 AND 100 OR num_nonnulls(p_after_external_line,p_after_bank_source) NOT IN(0,2)
    OR p_after_external_line IS NOT NULL AND (p_after_external_line<>btrim(p_after_external_line) OR length(p_after_external_line) NOT BETWEEN 1 AND 256) THEN
  RAISE EXCEPTION 'Invalid Cash Transfer bank-leg candidate cursor' USING ERRCODE='22023';
 END IF;
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.VIEW');
 PERFORM refs_assert_scope(p_tenant,p_entity,'CASH.TRANSFER.RECONCILE');
 PERFORM refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW');
 SELECT * INTO t FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR SHARE;
 IF NOT FOUND OR t.status<>'POSTED' THEN RAISE EXCEPTION 'Cash Transfer bank-leg candidates require one posted retained transfer' USING ERRCODE='P0002'; END IF;
 SELECT c.bank_member_ref INTO bank_ref FROM cash_transfer_bank_account_control c
  WHERE c.tenant_id=p_tenant AND c.entity_id=p_entity AND c.cash_transfer_bank_account_control_id=(CASE p_leg WHEN 'SOURCE' THEN t.from_bank_account_control_id ELSE t.to_bank_account_control_id END)
  FOR SHARE;
 IF bank_ref IS NULL OR bank_ref IS DISTINCT FROM (CASE p_leg WHEN 'SOURCE' THEN t.from_bank_member_ref ELSE t.to_bank_member_ref END) THEN
  RAISE EXCEPTION 'Cash Transfer controlled bank evidence is unavailable' USING ERRCODE='55000';
 END IF;
 expected_amount:=CASE p_leg WHEN 'SOURCE' THEN -t.amount ELSE t.amount END;
 WITH candidates AS (
  SELECT b.bank_source_id,b.external_bank_line_id,b.transaction_date,b.currency,b.amount
  FROM bank_source b
  WHERE b.tenant_id=p_tenant AND b.entity_id=p_entity AND b.bank_account_ref=bank_ref
    AND b.transaction_date=t.transfer_date AND b.currency=t.currency AND b.amount=expected_amount
    AND NOT EXISTS(SELECT 1 FROM cash_transfer_bank_link existing_leg WHERE existing_leg.tenant_id=p_tenant AND existing_leg.entity_id=p_entity AND existing_leg.cash_transfer_id=t.cash_transfer_id AND existing_leg.leg=p_leg AND existing_leg.status<>'RETIRED')
    AND NOT EXISTS(SELECT 1 FROM cash_transfer_bank_link l WHERE l.tenant_id=b.tenant_id AND l.entity_id=b.entity_id AND l.bank_source_id=b.bank_source_id AND l.status='ACTIVE')
    AND (p_after_external_line IS NULL OR (b.external_bank_line_id,b.bank_source_id)<(p_after_external_line,p_after_bank_source))
  ORDER BY b.external_bank_line_id DESC,b.bank_source_id DESC LIMIT p_limit+1
 ), numbered AS (
  SELECT candidates.*,row_number() OVER(ORDER BY external_bank_line_id DESC,bank_source_id DESC) rn FROM candidates
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('bank_source_id',bank_source_id,'external_bank_line_id',external_bank_line_id,'transaction_date',transaction_date,'currency',currency,'amount',amount::text) ORDER BY external_bank_line_id DESC,bank_source_id DESC) FILTER(WHERE rn<=p_limit),'[]'::jsonb),
   count(*)>p_limit,
   (array_agg(jsonb_build_object('external_bank_line_id',external_bank_line_id,'bank_source_id',bank_source_id) ORDER BY external_bank_line_id DESC,bank_source_id DESC) FILTER(WHERE rn=p_limit))[1]
 INTO items,more,next_cursor FROM numbered;
 IF NOT more THEN next_cursor:=NULL; END IF;
 RETURN jsonb_build_object('schema_version','CASH_TRANSFER_BANK_LEG_CANDIDATES_V1','entity_id',p_entity,'cash_transfer_id',p_transfer,'leg',p_leg,'transfer_date',t.transfer_date,'currency',t.currency,'amount',expected_amount::text,'rows',items,'limit',p_limit,'has_more',more,'next_cursor',next_cursor);
END;$$;
REVOKE ALL ON FUNCTION refs_read_cash_transfer_bank_leg_candidates(uuid,uuid,uuid,text,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_bank_leg_candidates(uuid,uuid,uuid,text,integer,text,uuid) TO refs_app;
COMMIT;
