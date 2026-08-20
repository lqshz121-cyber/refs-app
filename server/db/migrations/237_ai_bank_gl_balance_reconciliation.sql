BEGIN;
CREATE FUNCTION refs_read_ai_bank_gl_balance_reconciliation(p_tenant uuid,p_entity uuid,p_period uuid) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN');
  RETURN QUERY
  SELECT jsonb_build_object(
    'evidence_status','SIGNED_STATEMENT_AND_POSTED_GL','period_id',p_period,'reconciliation_id',r.reconciliation_id,'wbs_bank_statement_receipt_id',s.wbs_bank_statement_receipt_id,
    'bank_account_ref',r.bank_account_ref,'statement_start_date',s.statement_start_date,'statement_ending_date',r.statement_ending_date,'currency',r.currency,
    'statement_opening_balance',to_char(r.statement_opening_balance,'FM999999999999990.0000'),'statement_ending_balance',to_char(r.statement_ending_balance,'FM999999999999990.0000'),
    'book_ending_balance',to_char(r.book_ending_balance,'FM999999999999990.0000'),'difference',to_char(r.difference,'FM999999999999990.0000'),
    'statement_payload_hash',s.statement_payload_hash,'admission_hash',s.admission_hash,'signature_algorithm',s.signature_algorithm,'signature_verified',s.signature_verified,'admission_status',s.admission_status,
    'reconciliation_status',r.status,'reconciliation_version',r.version,
    'journal_entry_ids',COALESCE(gl.journal_entry_ids,ARRAY[]::uuid[]),'journal_line_ids',COALESCE(gl.journal_line_ids,ARRAY[]::uuid[]),'ledger_line_ids',COALESCE(gl.ledger_line_ids,ARRAY[]::uuid[])
  )
  FROM reconciliation r
  JOIN accounting_period p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id AND p.period_id=p_period AND r.statement_ending_date BETWEEN p.starts_on AND p.ends_on
  JOIN wbs_bank_statement_receipt s ON s.tenant_id=r.tenant_id AND s.entity_id=r.entity_id AND s.wbs_bank_statement_receipt_id=r.wbs_bank_statement_receipt_id AND s.signature_verified AND s.admission_status='ADMITTED'
  LEFT JOIN LATERAL(
    SELECT array_agg(DISTINCT ll.journal_entry_id ORDER BY ll.journal_entry_id) journal_entry_ids,array_agg(DISTINCT ll.journal_line_id ORDER BY ll.journal_line_id) journal_line_ids,array_agg(DISTINCT ll.ledger_line_id ORDER BY ll.ledger_line_id) ledger_line_ids
    FROM ledger_line ll JOIN journal_line jl ON jl.tenant_id=ll.tenant_id AND jl.entity_id=ll.entity_id AND jl.journal_entry_id=ll.journal_entry_id AND jl.journal_line_id=ll.journal_line_id
    JOIN journal_entry je ON je.tenant_id=ll.tenant_id AND je.entity_id=ll.entity_id AND je.journal_entry_id=ll.journal_entry_id
    WHERE ll.tenant_id=r.tenant_id AND ll.entity_id=r.entity_id AND jl.member_ref=r.bank_account_ref AND je.status='POSTED' AND je.currency=r.currency AND je.journal_date<=r.statement_ending_date
  ) gl ON true
  WHERE r.tenant_id=p_tenant AND r.entity_id=p_entity
  ORDER BY r.statement_ending_date,r.bank_account_ref COLLATE "C",r.reconciliation_id;
END;$$;
REVOKE EXECUTE ON FUNCTION refs_read_ai_bank_gl_balance_reconciliation(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refs_read_ai_bank_gl_balance_reconciliation(uuid,uuid,uuid) TO refs_app;
COMMIT;
