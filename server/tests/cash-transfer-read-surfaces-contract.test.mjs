import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/376_cash_transfer_read_surfaces.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/376_cash_transfer_read_surfaces.sql',import.meta.url),'utf8');

test('Cash Transfer server-side hashes are closed, canonical, and command-bound',()=>{
  const hashes=[
    ['refs_cash_transfer_control_create_hash','p_tenant uuid,p_entity uuid,p_bank text,p_account text,p_currency char(3),p_effective_from date,p_effective_to date',['tenant_id','entity_id','bank_member_ref','cash_account_code','currency','effective_from','effective_to']],
    ['refs_cash_transfer_control_approve_hash','p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint',['tenant_id','entity_id','control_id','expected_version']],
    ['refs_cash_transfer_control_retire_hash','p_tenant uuid,p_entity uuid,p_control uuid,p_expected_version bigint',['tenant_id','entity_id','control_id','expected_version','action','RETIRE']],
    ['refs_cash_transfer_bank_link_hash','p_tenant uuid,p_entity uuid,p_transfer uuid,p_leg text,p_bank_source uuid,p_expected_transfer_revision bigint',['tenant_id','entity_id','cash_transfer_id','leg','bank_source_id','expected_revision']],
  ];
  for(const [name,signature,fields] of hashes){
    const body=up.match(new RegExp('CREATE FUNCTION '+name+'\\([\\s\\S]*?\\$\\$;','i'))?.[0]??'';
    assert.notEqual(body,'',name+' must be present');
    assert.match(body,new RegExp(signature.replace(/[()]/g,'\\$&')),'exact server-side function signature is required');
    assert.match(body,/RETURNS text LANGUAGE sql IMMUTABLE/i);
    assert.match(body,/refs_jsonb_hash\(jsonb_build_object/i);
    for(const field of fields)assert.match(body,new RegExp("'"+field+"'"),name+' must bind '+field);
    assert.doesNotMatch(body,/refs_current_actor|idempotency|INSERT|UPDATE|DELETE|SELECT\s+.*\s+FROM/i,name+' must be a pure canonical command hash');
  }
});

test('Cash Transfer read surfaces are scope-bound, RLS-protected, and grant only execute',()=>{
  for(const table of ['cash_transfer','cash_transfer_bank_account_control','cash_transfer_bank_link']){
    assert.match(up,new RegExp("oid='"+table+"'::regclass AND relrowsecurity",'i'));
    assert.match(up,new RegExp("has_table_privilege\\('refs_app','"+table+"','SELECT'\\)",'i'));
  }
  assert.match(up,/refs_app must not retain direct Cash Transfer evidence read access/i);
  for(const fn of ['refs_read_cash_transfer_create_options','refs_read_cash_transfer_detail','refs_read_cash_transfer_register']){
    const body=up.match(new RegExp('CREATE FUNCTION '+fn+'\\([\\s\\S]*?END;\\$\\$;','i'))?.[0]??'';
    assert.notEqual(body,'',fn+' must be present');
    assert.match(body,/STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/i);
  }
  assert.match(up,/REVOKE ALL ON FUNCTION[\s\S]+refs_read_cash_transfer_register[\s\S]+FROM PUBLIC/i);
  assert.match(up,/GRANT EXECUTE ON FUNCTION[\s\S]+refs_read_cash_transfer_register[\s\S]+TO refs_app/i);
  assert.doesNotMatch(up,/GRANT\s+(?:SELECT|ALL)\s+ON\s+(?:TABLE\s+)?cash_transfer(?:\s|,)/i);
});

test('Cash Transfer create options expose only currently active exact controls',()=>{
  const options=up.match(/CREATE FUNCTION refs_read_cash_transfer_create_options\([\s\S]*?END;\$\$;/i)?.[0]??'';
  for(const scope of ['CASH.TRANSFER.CREATE','GL.JE.CREATE','GL.JE.VIEW'])assert.match(options,new RegExp("refs_assert_scope\\(p_tenant,p_entity,'"+scope.replace(/\./g,'\\.')+"'\\)"));
  assert.match(options,/period_id=p_period AND ledger_code='PRIMARY'[\s\S]+status='OPEN' AND p_transfer_date BETWEEN starts_on AND ends_on/i);
  assert.match(options,/c[.]status='APPROVED'[\s\S]+c[.]effective_from<=p_transfer_date[\s\S]+c[.]effective_to IS NULL OR c[.]effective_to>p_transfer_date/i);
  assert.match(options,/a[.]active AND a[.]requires_member AND a[.]required_member_type='BANK'/i);
  assert.match(options,/m[.]active AND m[.]member_type='BANK'/i);
  assert.match(options,/HAVING count\(\*\)>=2/i);
  assert.match(options,/'can_create_draft',eligible_currency_count>0/i);
  assert.doesNotMatch(options,/\b(?:INSERT|UPDATE|DELETE|refs_create_|refs_transition_|refs_post_)\b/i);
});

test('Cash Transfer detail retains exact journal, ledger, control, link, and clean attachment evidence',()=>{
  const detail=up.match(/CREATE FUNCTION refs_read_cash_transfer_detail\([\s\S]*?END;\$\$;/i)?.[0]??'';
  for(const scope of ['CASH.TRANSFER.VIEW','GL.JE.VIEW'])assert.match(detail,new RegExp("refs_assert_scope\\(p_tenant,p_entity,'"+scope.replace(/\./g,'\\.')+"'\\)"));
  assert.match(detail,/FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer/i);
  assert.match(detail,/FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=t[.]journal_entry_id/i);
  assert.match(detail,/FROM journal_line jl WHERE jl[.]tenant_id=p_tenant AND jl[.]entity_id=p_entity AND jl[.]journal_entry_id=t[.]journal_entry_id/i);
  assert.match(detail,/FROM ledger_line ll WHERE ll[.]tenant_id=p_tenant AND ll[.]entity_id=p_entity AND ll[.]journal_entry_id=t[.]journal_entry_id/i);
  assert.match(detail,/FROM cash_transfer_bank_link l JOIN bank_source b ON b[.]tenant_id=l[.]tenant_id AND b[.]bank_source_id=l[.]bank_source_id/i);
  assert.match(detail,/from_bank_account_control_id/i);
  assert.match(detail,/to_bank_account_control_id/i);
  for(const token of ["finalization_status='VERIFIED_CLEAN'","scan_status='CLEAN'",'verified_at IS NOT NULL','finalized_at IS NOT NULL','refs_cash_transfer_attachment_snapshot'])assert.ok(detail.includes(token),'detail must retain '+token);
  assert.match(detail,/jsonb_build_object\('attachment_id',a\.attachment_id,'verified_at',a\.verified_at,'finalized_at',a\.finalized_at\)/i);
  assert.doesNotMatch(detail,/storage_ref|content_hash|storage_version|bank_source_document_id/i,'Cash Transfer detail must not disclose attachment storage or hash internals');
  assert.match(detail,/'can_review'[\s\S]+actor IS DISTINCT FROM t[.]created_by/i);
  assert.match(detail,/'can_approve'[\s\S]+actor IS DISTINCT FROM t[.]reviewed_by/i);
  assert.match(detail,/'can_post'[\s\S]+actor IS DISTINCT FROM t[.]approved_by/i);
  assert.doesNotMatch(detail,/\b(?:INSERT|UPDATE|DELETE|refs_create_|refs_transition_|refs_post_)\b/i);
});

test('Cash Transfer register is bounded keyset pagination over scoped immutable detail',()=>{
  const register=up.match(/CREATE FUNCTION refs_read_cash_transfer_register\([\s\S]*?END;\$\$;/i)?.[0]??'';
  for(const scope of ['CASH.TRANSFER.VIEW','GL.JE.VIEW'])assert.match(register,new RegExp("refs_assert_scope\\(p_tenant,p_entity,'"+scope.replace(/\./g,'\\.')+"'\\)"));
  assert.match(register,/p_limit NOT BETWEEN 1 AND 100/i);
  assert.match(register,/num_nonnulls\(p_after_date,p_after_transfer\) NOT IN\(0,2\)/i);
  assert.match(register,/t[.]tenant_id=p_tenant AND t[.]entity_id=p_entity AND t[.]period_id=p_period/i);
  assert.match(register,/\(t[.]transfer_date,t[.]cash_transfer_id\)<\(p_after_date,p_after_transfer\)/i);
  assert.match(register,/ORDER BY t[.]transfer_date DESC,t[.]cash_transfer_id DESC LIMIT p_limit\+1/i);
  assert.match(register,/refs_read_cash_transfer_detail\(p_tenant,p_entity,c[.]cash_transfer_id\)/i);
  assert.match(register,/'has_more',more,'next_cursor',next_cursor/i);
  assert.doesNotMatch(register,/\b(?:INSERT|UPDATE|DELETE|refs_create_|refs_transition_|refs_post_)\b/i);
});

test('Cash Transfer read-surface rollback fails closed and removes every new function',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM cash_transfer\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_link\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_account_control\)/i);
  assert.match(down,/Cannot roll back Cash Transfer read surfaces while retained Cash Transfer, bank-link, or bank-control evidence exists/i);
  for(const fn of ['refs_read_cash_transfer_register','refs_read_cash_transfer_detail','refs_read_cash_transfer_create_options','refs_cash_transfer_bank_link_hash','refs_cash_transfer_control_retire_hash','refs_cash_transfer_control_approve_hash','refs_cash_transfer_control_create_hash']){
    assert.match(down,new RegExp('REVOKE EXECUTE ON FUNCTION[\\s\\S]+'+fn,'i'));
    assert.match(down,new RegExp('DROP FUNCTION '+fn+'\\(','i'));
  }
});
