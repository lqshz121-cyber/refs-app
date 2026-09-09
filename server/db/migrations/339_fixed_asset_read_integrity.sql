BEGIN;
CREATE INDEX fixed_asset_movement_page ON ledger_line(tenant_id,entity_id,(dimensions->>'fixed_asset_register_evidence_id'),ledger_line_id);
CREATE TABLE fixed_asset_read_cursor_key(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),secret bytea NOT NULL CHECK(octet_length(secret)=32));
INSERT INTO fixed_asset_read_cursor_key(secret) VALUES(gen_random_bytes(32));
REVOKE ALL ON fixed_asset_read_cursor_key FROM PUBLIC,refs_app;
CREATE OR REPLACE FUNCTION refs_read_fixed_asset_register(p_tenant uuid,p_entity uuid,p_as_of date,p_limit integer DEFAULT 50,p_after uuid DEFAULT NULL,p_asset uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.REGISTER.VIEW');
 IF p_as_of IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100 OR (p_asset IS NOT NULL AND p_after IS NOT NULL) THEN RAISE EXCEPTION 'Invalid fixed asset read date or pagination' USING ERRCODE='22023';END IF;
 WITH candidates AS MATERIALIZED(
  SELECT a.* FROM fixed_asset_register_evidence a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity
   AND a.placed_in_service_date<=p_as_of AND (p_after IS NULL OR a.fixed_asset_register_evidence_id>p_after) AND (p_asset IS NULL OR a.fixed_asset_register_evidence_id=p_asset)
  ORDER BY a.fixed_asset_register_evidence_id LIMIT p_limit+1
 ), page AS MATERIALIZED(SELECT * FROM candidates ORDER BY fixed_asset_register_evidence_id LIMIT p_limit),
 rows AS(
  SELECT a.fixed_asset_register_evidence_id,jsonb_build_object(
   'fixed_asset_register_evidence_id',a.fixed_asset_register_evidence_id,'tenant_id',a.tenant_id,'entity_id',a.entity_id,
   'asset_tag',a.asset_tag,'asset_class',a.asset_class,'currency',a.currency,'cost_basis',a.cost_basis::text,'salvage_value',a.salvage_value::text,
   'placed_in_service_date',a.placed_in_service_date,'useful_life_months',a.useful_life_months,'depreciation_method',a.depreciation_method,'depreciation_convention',a.depreciation_convention,
   'asset_account_code',a.asset_account_code,'accumulated_depreciation_account_code',a.accumulated_depreciation_account_code,'depreciation_expense_account_code',a.depreciation_expense_account_code,
   'capitalization_proposal_id',a.capitalization_proposal_id,'source_document_id',a.source_document_id,'source_payload_hash',a.source_payload_hash,
   'register_evidence_hash',a.register_evidence_hash,'reviewed_by',a.reviewed_by,'reviewed_at',a.reviewed_at,'member_trace',a.member_trace,
   'posted_cost_balance',balances.cost::numeric(20,4)::text,'accumulated_depreciation',balances.depreciation::numeric(20,4)::text,
   'accumulated_impairment',balances.impairment::numeric(20,4)::text,'net_book_value',(balances.cost-balances.depreciation-balances.impairment)::numeric(20,4)::text,
   'posted_ledger_line_count',balances.line_count,'as_of_date',p_as_of,
   'status',CASE WHEN reviewed.fixed_asset_disposal_evidence_id IS NOT NULL THEN 'DISPOSED_REVIEWED' WHEN posted.journal_entry_id IS NOT NULL THEN 'DISPOSAL_POSTED' WHEN balances.line_count=0 THEN 'REGISTERED' ELSE 'ACTIVE' END,
   'disposal_journal_entry_id',posted.journal_entry_id,'disposal_binding_id',posted.binding_id,'fixed_asset_disposal_evidence_id',reviewed.fixed_asset_disposal_evidence_id,
   'disposal_date',coalesce(reviewed.disposal_date,posted.journal_date),'disposal_source_document_id',coalesce(reviewed.disposal_source_document_id,posted.source_document_id),
   'disposal_source_payload_hash',coalesce(reviewed.disposal_source_payload_hash,posted.source_payload_hash),'disposal_source_document_version',posted.source_document_version,'disposal_source_link_id',posted.source_link_id
  ) row_data
  FROM page a
  LEFT JOIN LATERAL(
   SELECT coalesce(sum(l.debit_amount-l.credit_amount) FILTER(WHERE l.account_code=a.asset_account_code),0) cost,
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code=a.accumulated_depreciation_account_code),0) depreciation,
    coalesce(sum(l.credit_amount-l.debit_amount) FILTER(WHERE l.account_code IN(SELECT e.accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence e WHERE e.tenant_id=p_tenant AND e.entity_id=p_entity AND e.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id AND e.assessment_date<=p_as_of)),0) impairment,
    count(*) line_count
   FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
   JOIN accounting_period ap ON ap.tenant_id=j.tenant_id AND ap.entity_id=j.entity_id AND ap.period_id=j.period_id AND ap.ledger_code='PRIMARY'
   WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.currency=a.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=a.fixed_asset_register_evidence_id::text
  ) balances ON true
  LEFT JOIN LATERAL(
   SELECT p.journal_entry_id,p.binding_id,j.journal_date,b.source_document_id,b.source_payload_hash,b.source_document_version,b.source_link_id FROM fixed_asset_disposal_posting p
   JOIN journal_entry j ON j.tenant_id=p.tenant_id AND j.entity_id=p.entity_id AND j.journal_entry_id=p.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
   JOIN fixed_asset_disposal_source_binding b ON b.binding_id=p.binding_id
   WHERE p.tenant_id=p_tenant AND p.entity_id=p_entity AND p.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id
  ) posted ON true
  LEFT JOIN fixed_asset_disposal_evidence reviewed ON reviewed.tenant_id=p_tenant AND reviewed.entity_id=p_entity AND reviewed.fixed_asset_register_evidence_id=a.fixed_asset_register_evidence_id AND reviewed.disposal_date<=p_as_of
 )
 SELECT jsonb_build_object('schema_version','FIXED_ASSET_REGISTER_READ_V1','tenant_id',p_tenant,'entity_id',p_entity,'as_of_date',p_as_of,
  'basis','POSTED_PRIMARY_LEDGER','rows',coalesce((SELECT jsonb_agg(row_data ORDER BY fixed_asset_register_evidence_id) FROM rows),'[]'::jsonb),
  'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT fixed_asset_register_evidence_id FROM page ORDER BY fixed_asset_register_evidence_id DESC LIMIT 1) ELSE NULL END)
 INTO result;RETURN result;
END;$$;

REVOKE ALL ON FUNCTION refs_read_fixed_asset_register(uuid,uuid,date,integer,uuid,uuid) FROM refs_app;
CREATE FUNCTION refs_read_fixed_asset_register_v2(p_tenant uuid,p_entity uuid,p_as_of date,p_limit integer DEFAULT 50,p_cursor text DEFAULT NULL,p_asset uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE payload jsonb;secret_key bytea;encoded text;signature text;after_id uuid;result jsonb;last_id uuid;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.REGISTER.VIEW');
 SELECT secret INTO STRICT secret_key FROM fixed_asset_read_cursor_key WHERE singleton;
 IF p_cursor IS NOT NULL THEN
  IF p_asset IS NOT NULL OR length(p_cursor)>2048 OR p_cursor !~ '^[A-Za-z0-9+/=]+[.][a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid asset page cursor' USING ERRCODE='22023';END IF;
  encoded:=split_part(p_cursor,'.',1);signature:=split_part(p_cursor,'.',2);
  IF signature<>encode(hmac(convert_to(encoded,'UTF8'),secret_key,'sha256'),'hex') THEN RAISE EXCEPTION 'Asset page cursor integrity failed' USING ERRCODE='22023';END IF;
  BEGIN payload:=convert_from(decode(encoded,'base64'),'UTF8')::jsonb;after_id:=(payload->>'after')::uuid;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid asset page cursor payload' USING ERRCODE='22023';END;
  IF payload IS DISTINCT FROM jsonb_build_object('version',1,'tenant',p_tenant,'entity',p_entity,'as_of',p_as_of,'after',after_id)
   OR NOT EXISTS(SELECT 1 FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=after_id AND placed_in_service_date<=p_as_of) THEN RAISE EXCEPTION 'Asset cursor scope or date changed' USING ERRCODE='22023';END IF;
 END IF;
 result:=refs_read_fixed_asset_register(p_tenant,p_entity,p_as_of,p_limit,after_id,p_asset);
 last_id:=(result->>'next_cursor')::uuid;
 IF last_id IS NOT NULL THEN
  payload:=jsonb_build_object('version',1,'tenant',p_tenant,'entity',p_entity,'as_of',p_as_of,'after',last_id);
  encoded:=replace(encode(convert_to(payload::text,'UTF8'),'base64'),E'\n','');
  result:=jsonb_set(result,'{next_cursor}',to_jsonb(encoded||'.'||encode(hmac(convert_to(encoded,'UTF8'),secret_key,'sha256'),'hex')));
 END IF;
 RETURN result||jsonb_build_object('schema_version','FIXED_ASSET_REGISTER_READ_V2','population_basis','PLACED_IN_SERVICE_DATE');
END;$$;
REVOKE ALL ON FUNCTION refs_read_fixed_asset_register_v2(uuid,uuid,date,integer,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_register_v2(uuid,uuid,date,integer,text,uuid) TO refs_app;

CREATE FUNCTION refs_asset_trace_cursor(p_payload jsonb) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE encoded text;key_value bytea;
BEGIN SELECT secret INTO STRICT key_value FROM fixed_asset_read_cursor_key WHERE singleton;encoded:=replace(encode(convert_to(p_payload::text,'UTF8'),'base64'),E'\n','');RETURN encoded||'.'||encode(hmac(convert_to(encoded,'UTF8'),key_value,'sha256'),'hex');END;$$;
CREATE FUNCTION refs_asset_trace_cursor_read(p_cursor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE key_value bytea;encoded text;payload jsonb;
BEGIN
 IF p_cursor IS NULL OR length(p_cursor)>2048 OR p_cursor !~ '^[A-Za-z0-9+/=]+[.][a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid asset trace cursor' USING ERRCODE='22023';END IF;
 SELECT secret INTO STRICT key_value FROM fixed_asset_read_cursor_key WHERE singleton;encoded:=split_part(p_cursor,'.',1);
 IF split_part(p_cursor,'.',2)<>encode(hmac(convert_to(encoded,'UTF8'),key_value,'sha256'),'hex') THEN RAISE EXCEPTION 'Invalid asset trace signature' USING ERRCODE='22023';END IF;
 BEGIN payload:=convert_from(decode(encoded,'base64'),'UTF8')::jsonb;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid asset trace cursor payload' USING ERRCODE='22023';END;RETURN payload;
END;$$;
REVOKE ALL ON FUNCTION refs_asset_trace_cursor(jsonb),refs_asset_trace_cursor_read(text) FROM PUBLIC,refs_app;
CREATE FUNCTION refs_read_fixed_asset_movements(p_tenant uuid,p_entity uuid,p_asset uuid,p_as_of date,p_limit integer DEFAULT 50,p_cursor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE asset fixed_asset_register_evidence;payload jsonb;after_id uuid;result jsonb;last_id uuid;
BEGIN
 PERFORM refs_assert_scope(p_tenant,p_entity,'FIXED_ASSET.REGISTER.VIEW');
 IF p_as_of IS NULL OR p_limit IS NULL OR p_limit<1 OR p_limit>100 THEN RAISE EXCEPTION 'Invalid asset movement read arguments' USING ERRCODE='22023';END IF;
 SELECT * INTO asset FROM fixed_asset_register_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND placed_in_service_date<=p_as_of;
 IF NOT FOUND THEN RAISE EXCEPTION 'Scoped effective asset is missing' USING ERRCODE='P0002';END IF;
 IF p_cursor IS NOT NULL THEN
  payload:=refs_asset_trace_cursor_read(p_cursor);BEGIN after_id:=(payload->>'after')::uuid;EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid movement ordering key' USING ERRCODE='22023';END;
  IF payload IS DISTINCT FROM jsonb_build_object('version',1,'kind','ASSET_MOVEMENTS','tenant',p_tenant,'entity',p_entity,'asset',p_asset,'as_of',p_as_of,'after',after_id)
   OR NOT EXISTS(SELECT 1 FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of JOIN accounting_period p ON p.tenant_id=j.tenant_id AND p.entity_id=j.entity_id AND p.period_id=j.period_id AND p.ledger_code='PRIMARY' WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.ledger_line_id=after_id AND l.currency=asset.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text) THEN RAISE EXCEPTION 'Asset movement cursor scope changed' USING ERRCODE='22023';END IF;
 END IF;
 WITH candidates AS MATERIALIZED(
  SELECT l.*,j.journal_number,j.journal_date,j.journal_type,j.posted_by
  FROM ledger_line l JOIN journal_entry j ON j.tenant_id=l.tenant_id AND j.entity_id=l.entity_id AND j.journal_entry_id=l.journal_entry_id AND j.status='POSTED' AND j.journal_date<=p_as_of
  JOIN accounting_period p ON p.tenant_id=j.tenant_id AND p.entity_id=j.entity_id AND p.period_id=j.period_id AND p.ledger_code='PRIMARY'
  WHERE l.tenant_id=p_tenant AND l.entity_id=p_entity AND l.currency=asset.currency AND l.dimensions->>'fixed_asset_register_evidence_id'=p_asset::text AND (after_id IS NULL OR l.ledger_line_id>after_id)
  ORDER BY l.ledger_line_id LIMIT p_limit+1
 ),page AS MATERIALIZED(SELECT * FROM candidates ORDER BY ledger_line_id LIMIT p_limit),journal_totals AS MATERIALIZED(
 SELECT jl.journal_entry_id,sum(jl.debit_amount)::text total_debit,sum(jl.credit_amount)::text total_credit,count(*) line_count FROM ledger_line jl JOIN (SELECT DISTINCT journal_entry_id FROM page) selected USING(journal_entry_id) WHERE jl.tenant_id=p_tenant AND jl.entity_id=p_entity GROUP BY jl.journal_entry_id
 ),rows AS(
 SELECT l.ledger_line_id,jsonb_build_object('ledger_line_id',l.ledger_line_id,'journal_line_id',l.journal_line_id,'journal_entry_id',l.journal_entry_id,'posting_batch_id',l.posting_batch_id,'accounting_period_id',l.period_id,
  'tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'as_of_date',p_as_of,'journal_number',l.journal_number,'journal_date',l.journal_date,'journal_type',l.journal_type,'journal_status','POSTED','posted_at',l.posted_at,'posted_by',l.posted_by,
  'journal_total_debit',totals.total_debit,'journal_total_credit',totals.total_credit,'journal_ledger_line_count',totals.line_count,
  'account_code',l.account_code,'currency',l.currency,'debit_amount',l.debit_amount::text,'credit_amount',l.credit_amount::text,'dimensions',l.dimensions,
  'account_role',CASE WHEN l.account_code=asset.asset_account_code THEN 'ASSET_COST' WHEN l.account_code=asset.accumulated_depreciation_account_code THEN 'ACCUMULATED_DEPRECIATION' WHEN l.account_code IN(SELECT accumulated_impairment_account_code FROM fixed_asset_impairment_assessment_evidence WHERE tenant_id=p_tenant AND entity_id=p_entity AND fixed_asset_register_evidence_id=p_asset AND assessment_date<=p_as_of) THEN 'ACCUMULATED_IMPAIRMENT' ELSE 'OTHER' END,
  'impairment_assessment_reference',l.dimensions->>'fixed_asset_impairment_assessment_evidence_id','impairment_assessment_evidence_id',assessment.fixed_asset_impairment_assessment_evidence_id,'valuation_source_document_id',assessment.valuation_source_document_id,'valuation_source_payload_hash',assessment.valuation_source_payload_hash,'impairment_assessment_hash',assessment.impairment_assessment_hash,'assessment_lineage_status',CASE WHEN assessment.fixed_asset_impairment_assessment_evidence_id IS NOT NULL THEN 'EXACT_RETAINED_ASSESSMENT' WHEN l.dimensions->>'fixed_asset_impairment_assessment_evidence_id' IS NOT NULL THEN 'BLOCKED_UNRESOLVED_REFERENCE' ELSE 'NOT_REFERENCED' END,
  'source_binding_status',CASE WHEN binding.binding_id IS NOT NULL AND sl.source_link_id IS NOT NULL THEN 'EXACT_DISPOSAL_SOURCE' ELSE 'BLOCKED_MISSING_EXACT_SOURCE_BINDING' END,
  'source_document_id',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_document_id END,'source_payload_hash',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_payload_hash END,'source_document_version',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.source_document_version END,'source_link_id',sl.source_link_id,'disposal_binding_id',CASE WHEN sl.source_link_id IS NOT NULL THEN binding.binding_id END,
  'posting_audit_event_id',audit.audit_event_id,'posting_audit_event_count',coalesce(audit.event_count,0),
  'ledger_lineage_status',CASE WHEN ledger_trace.link_count=1 THEN 'EXACT' WHEN ledger_trace.link_count>1 THEN 'BLOCKED_AMBIGUOUS' ELSE 'BLOCKED_MISSING' END,'ledger_source_link_id',CASE WHEN ledger_trace.link_count=1 THEN ledger_trace.source_link_id END,'ledger_source_link_count',coalesce(ledger_trace.link_count,0)
 ) row_data
 FROM page l JOIN journal_totals totals ON totals.journal_entry_id=l.journal_entry_id
 LEFT JOIN fixed_asset_disposal_source_binding binding ON binding.tenant_id=p_tenant AND binding.entity_id=p_entity AND binding.fixed_asset_register_evidence_id=p_asset AND binding.journal_entry_id=l.journal_entry_id
 LEFT JOIN source_link sl ON sl.source_link_id=binding.source_link_id AND sl.tenant_id=p_tenant AND sl.entity_id=p_entity AND sl.link_type='SOURCE_TO_JE' AND sl.source_document_id=binding.source_document_id AND sl.journal_entry_id=l.journal_entry_id
 LEFT JOIN fixed_asset_impairment_assessment_evidence assessment ON assessment.tenant_id=p_tenant AND assessment.entity_id=p_entity AND assessment.fixed_asset_register_evidence_id=p_asset AND assessment.fixed_asset_impairment_assessment_evidence_id::text=l.dimensions->>'fixed_asset_impairment_assessment_evidence_id'
 LEFT JOIN LATERAL(SELECT link.source_link_id,count(*) OVER() link_count FROM source_link link WHERE link.tenant_id=p_tenant AND link.entity_id=p_entity AND link.link_type='JE_LINE_TO_LEDGER' AND link.journal_entry_id=l.journal_entry_id AND link.journal_line_id=l.journal_line_id AND link.posting_batch_id=l.posting_batch_id AND link.ledger_line_id=l.ledger_line_id ORDER BY link.source_link_id LIMIT 1) ledger_trace ON true
 LEFT JOIN LATERAL(SELECT a.audit_event_id,count(*) OVER() event_count FROM audit_event a WHERE a.tenant_id=p_tenant AND a.entity_id=p_entity AND a.object_id=l.journal_entry_id AND a.event_type='JOURNAL_POSTED' ORDER BY a.audit_event_id LIMIT 1) audit ON true
 ) SELECT jsonb_build_object('schema_version','FIXED_ASSET_MOVEMENTS_V1','tenant_id',p_tenant,'entity_id',p_entity,'fixed_asset_register_evidence_id',p_asset,'as_of_date',p_as_of,'basis','POSTED_PRIMARY_LEDGER','rows',coalesce((SELECT jsonb_agg(row_data ORDER BY ledger_line_id) FROM rows),'[]'::jsonb),'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>p_limit THEN (SELECT ledger_line_id FROM page ORDER BY ledger_line_id DESC LIMIT 1) ELSE NULL END) INTO result;
 last_id:=(result->>'next_cursor')::uuid;
 IF last_id IS NOT NULL THEN result:=jsonb_set(result,'{next_cursor}',to_jsonb(refs_asset_trace_cursor(jsonb_build_object('version',1,'kind','ASSET_MOVEMENTS','tenant',p_tenant,'entity',p_entity,'asset',p_asset,'as_of',p_as_of,'after',last_id))));END IF;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION refs_read_fixed_asset_movements(uuid,uuid,uuid,date,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_fixed_asset_movements(uuid,uuid,uuid,date,integer,text) TO refs_app;

COMMIT;
