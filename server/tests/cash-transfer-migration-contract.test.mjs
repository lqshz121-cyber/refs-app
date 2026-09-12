import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/375_cash_transfer_authoritative.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/375_cash_transfer_authoritative.sql',import.meta.url),'utf8');

test('Cash Transfer owns one immutable same-entity aggregate and an explicit lifecycle',()=>{
  assert.match(up,/CREATE TABLE cash_transfer\b/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,entity_id\) REFERENCES entity\(tenant_id,entity_id\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,entity_id,period_id,journal_entry_id\) REFERENCES journal_entry\(tenant_id,entity_id,period_id,journal_entry_id\)/i);
  assert.match(up,/CHECK\(from_account_code<>to_account_code AND from_bank_member_ref<>to_bank_member_ref\)/i);
  assert.match(up,/CHECK\(amount>0 AND amount<10000000000000000\)/i);
  assert.match(up,/status IN\('DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED','CANCELLED'\)/i);
  assert.match(up,/CHECK\(\(status='POSTED'\)=\(posted_at IS NOT NULL\)\)/i);
  assert.match(up,/CHECK\(\(status='CANCELLED'\)=\(cancelled_at IS NOT NULL\)\)/i);
  assert.match(up,/CREATE UNIQUE INDEX cash_transfer_open_pair_uq[\s\S]+WHERE status NOT IN\('POSTED','CANCELLED'\)/i);
  assert.match(up,/CREATE TRIGGER cash_transfer_protect BEFORE UPDATE OR DELETE ON cash_transfer/i);
  assert.match(up,/Cash Transfer lifecycle evidence is immutable/i);
  assert.doesNotMatch(up,/unit_transfer|elimination|due_from|due_to/i,'same-entity cash movement must not borrow intercompany/unit-transfer state');
});

test('Cash Transfer command hashes, idempotency receipts, locks, CAS, and SoD bind every state change',()=>{
  for(const fn of ['refs_create_cash_transfer_hash','refs_create_cash_transfer','refs_cash_transfer_transition_hash','refs_transition_cash_transfer','refs_post_cash_transfer_hash','refs_post_cash_transfer','refs_cancel_cash_transfer_hash','refs_cancel_cash_transfer'])assert.match(up,new RegExp(`CREATE FUNCTION ${fn}\\(`,'i'));
  for(const scope of ['CASH_TRANSFER:','CASH_TRANSFER_','CASH_TRANSFER_POST:','CASH_TRANSFER_CANCEL:'])assert.match(up,new RegExp(scope));
  assert.match(up,/p_request_hash IS DISTINCT FROM refs_create_cash_transfer_hash/i);
  assert.match(up,/p_request_hash IS DISTINCT FROM refs_cash_transfer_transition_hash/i);
  assert.match(up,/p_request_hash IS DISTINCT FROM refs_post_cash_transfer_hash/i);
  assert.match(up,/p_request_hash IS DISTINCT FROM refs_cancel_cash_transfer_hash/i);
  assert.match(up,/CREATE OR REPLACE FUNCTION refs_reserve_idempotency\(p_tenant uuid,p_scope text,p_key text,p_request_hash text,p_actor text\)/i);
  for(const scope of ['CASH_TRANSFER:%','CASH_TRANSFER_SUBMIT:%','CASH_TRANSFER_REVIEW:%','CASH_TRANSFER_APPROVE:%','CASH_TRANSFER_POST:%','CASH_TRANSFER_CANCEL:%'])assert.match(up,new RegExp(`p_scope NOT LIKE '${scope.replace(/[.%]/g,match=>match==='.'?'[.]':'%')}'`));
  assert.match(up,/CREATE FUNCTION refs_complete_cash_transfer_idempotency\(/i);
  for(const operation of ['CASH_TRANSFER:','CASH_TRANSFER_'+'||p_action||', 'CASH_TRANSFER_POST:','CASH_TRANSFER_CANCEL:'])assert.match(up,new RegExp(`idem:=refs_reserve_idempotency\\(p_tenant,'${operation.replace(/[.]/g,'[.]')}`));
  const commandBodies=up.slice(up.indexOf('CREATE FUNCTION refs_create_cash_transfer('),up.indexOf('CREATE FUNCTION refs_guard_cash_transfer_journal()'));
  assert.doesNotMatch(commandBodies,/INSERT INTO idempotency_receipt/i,'commands must use the centralized reservation helper');
  assert.doesNotMatch(commandBodies,/UPDATE idempotency_receipt/i,'commands must use the controlled completion helper');
  assert.equal((commandBodies.match(/PERFORM refs_complete_cash_transfer_idempotency\(/g)??[]).length,5,'each aggregate lifecycle command and controlled linker must complete its reserved receipt');
  assert.match(up,/idem[.]actor_id IS DISTINCT FROM actor OR idem[.]request_hash IS DISTINCT FROM p_request_hash/i);
  assert.match(up,/idem[.]status='SUCCEEDED'[\s\S]+idempotent/i);
  assert.match(up,/FROM cash_transfer WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_id=p_transfer FOR UPDATE/i);
  assert.match(up,/FROM journal_entry WHERE tenant_id=p_tenant AND entity_id=p_entity AND journal_entry_id=t[.]journal_entry_id FOR UPDATE/i);
  assert.match(up,/t[.]revision<>p_expected_revision OR j[.]revision<>p_expected_journal_revision/i);
  assert.match(up,/actor=t[.]created_by/i);
  assert.match(up,/actor IN\(t[.]created_by,t[.]reviewed_by\)/i);
  assert.match(up,/actor IN\(t[.]created_by,t[.]reviewed_by,t[.]approved_by\)/i);
  assert.match(up,/pg_advisory_xact_lock/i);
});

test('Cash Transfer locks an exact active bank-member-to-cash-GL control mapping for both legs',()=>{
  assert.match(up,/CREATE TABLE cash_transfer_bank_account_control/i);
  assert.match(up,/mapping_family text NOT NULL DEFAULT 'CASH_TRANSFER_BANK_ACCOUNT' CHECK\(mapping_family='CASH_TRANSFER_BANK_ACCOUNT'\)/i);
  assert.match(up,/UNIQUE\(tenant_id,entity_id,bank_member_ref,cash_account_code,currency,effective_from\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,from_bank_account_control_id\) REFERENCES cash_transfer_bank_account_control\(tenant_id,cash_transfer_bank_account_control_id\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,to_bank_account_control_id\) REFERENCES cash_transfer_bank_account_control\(tenant_id,cash_transfer_bank_account_control_id\)/i);
  for(const leg of ['from_control','to_control']){
    assert.match(up,new RegExp(`SELECT \\* INTO ${leg} FROM cash_transfer_bank_account_control[\\s\\S]+mapping_family='CASH_TRANSFER_BANK_ACCOUNT'[\\s\\S]+bank_member_ref=btrim\\(p_${leg==='from_control'?'from':'to'}_bank\\)[\\s\\S]+cash_account_code=btrim\\(p_${leg==='from_control'?'from':'to'}_account\\)[\\s\\S]+currency=p_currency[\\s\\S]+status='APPROVED'[\\s\\S]+effective_from<=p_date[\\s\\S]+effective_to IS NULL OR effective_to>p_date[\\s\\S]+FOR SHARE`,'i'));
  }
  assert.match(up,/from_control[.]cash_transfer_bank_account_control_id IS NULL OR to_control[.]cash_transfer_bank_account_control_id IS NULL/i);
  assert.match(up,/from_bank_account_control_id,to_bank_account_control_id/i);
  assert.match(up,/FROM account_master[\s\S]+active AND requires_member AND required_member_type='BANK' FOR SHARE/i);
  assert.match(up,/FROM member_master[\s\S]+active AND member_type='BANK' FOR SHARE/i);
  for(const leg of ['from','to'])assert.match(up,new RegExp(`SELECT \\* INTO ${leg}_control FROM cash_transfer_bank_account_control WHERE tenant_id=p_tenant AND entity_id=p_entity AND cash_transfer_bank_account_control_id=t\\.${leg}_bank_account_control_id[\\s\\S]+bank_member_ref=t\\.${leg}_bank_member_ref[\\s\\S]+cash_account_code=t\\.${leg}_account_code[\\s\\S]+currency=t\\.currency[\\s\\S]+status='APPROVED'[\\s\\S]+effective_from<=t\\.transfer_date[\\s\\S]+effective_to IS NULL OR effective_to>t\\.transfer_date[\\s\\S]+FOR SHARE`,'i'));
});

test('Cash Transfer bank-account controls have a controlled lifecycle and usable read options',()=>{
  assert.match(up,/status IN\('PENDING_APPROVAL','APPROVED','RETIRED'\)/i);
  assert.match(up,/version bigint NOT NULL DEFAULT 0 CHECK\(version>=0\)/i);
  assert.match(up,/CREATE FUNCTION refs_guard_cash_transfer_bank_account_control\(\) RETURNS trigger/i);
  assert.match(up,/CREATE TRIGGER cash_transfer_bank_account_control_guard BEFORE INSERT OR UPDATE ON cash_transfer_bank_account_control/i);
  assert.match(up,/pg_advisory_xact_lock[\s\S]+BANK:[\s\S]+pg_advisory_xact_lock[\s\S]+CASH:/i);
  assert.match(up,/status='APPROVED'[\s\S]+bank_member_ref=NEW[.]bank_member_ref OR c[.]cash_account_code=NEW[.]cash_account_code[\s\S]+effective_from<COALESCE\(NEW[.]effective_to,'infinity'::date\)[\s\S]+NEW[.]effective_from<COALESCE\(c[.]effective_to,'infinity'::date\)/i);
  assert.match(up,/Approved Cash Transfer bank-to-cash-GL controls cannot overlap/i);
  for(const permission of ['CASH.TRANSFER.CONFIGURE','CASH.TRANSFER.CONFIGURE.APPROVE'])assert.match(up,new RegExp(`refs_assert_scope\\(p_tenant,p_entity,'${permission.replace(/\\./g,'\\\\.')}'\\)`));
  for(const scope of ['CASH_TRANSFER_CONFIG_CREATE:','CASH_TRANSFER_CONFIG_APPROVE:'])assert.match(up,new RegExp(`refs_reserve_idempotency\\(p_tenant,'${scope}`));
  assert.match(up,/refs_reserve_idempotency\(p_tenant,'CASH_TRANSFER_CONFIG_RETIRE:'/i);
  assert.match(up,/cash_transfer_bank_account_control[\s\S]+FOR UPDATE[\s\S]+c[.]status<>'PENDING_APPROVAL' OR c[.]version<>p_expected_version OR actor=c[.]created_by/i);
  assert.match(up,/UPDATE cash_transfer_bank_account_control SET status='APPROVED'[\s\S]+version=version\+1/i);
  assert.match(up,/Cash Transfer bank-account control identity is immutable/i);
  assert.match(up,/Cash Transfer bank-account control lifecycle is invalid/i);
  assert.match(up,/CREATE FUNCTION refs_retire_cash_transfer_bank_account_control\([\s\S]+c[.]status<>'APPROVED' OR c[.]version<>p_expected_version OR actor IN\(c[.]created_by,c[.]approved_by\)[\s\S]+status='RETIRED',retired_by=actor,retired_at=clock_timestamp\(\),version=version\+1/i);
  assert.match(up,/CREATE FUNCTION refs_read_cash_transfer_bank_account_controls\([\s\S]+STABLE SECURITY DEFINER[\s\S]+refs_assert_scope\(p_tenant,p_entity,'CASH[.]TRANSFER[.]CONFIGURE'\)[\s\S]+p_as_of IS NULL OR effective_from<=p_as_of/i);
});

test('Cash Transfer scopes permissions and blocks direct base-table access',()=>{
  for(const permission of ['CASH.TRANSFER.VIEW','CASH.TRANSFER.CREATE','CASH.TRANSFER.SUBMIT','CASH.TRANSFER.REVIEW','CASH.TRANSFER.APPROVE','CASH.TRANSFER.CANCEL','CASH.TRANSFER.POST'])assert.match(up,new RegExp(`'${permission.replace(/\./g,'\\.')}'`));
  for(const pair of [['CASH.TRANSFER.CREATE','GL.JE.CREATE'],['CASH.TRANSFER.POST','GL.JE.POST'],['CASH.TRANSFER.CANCEL','GL.JE.REJECT']])for(const permission of pair)assert.match(up,new RegExp(`refs_assert_scope\\(p_tenant,p_entity,'${permission.replace(/\./g,'\\.')}'\\)`));
  for(const table of ['cash_transfer','cash_transfer_bank_link']){
    assert.match(up,new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,'i'));
    assert.match(up,new RegExp(`CREATE POLICY ${table}_scope[\\s\\S]+tenant_id=refs_current_tenant\\(\\)[\\s\\S]+refs_entity_allowed\\(entity_id\\)`,'i'));
    assert.match(up,new RegExp(`REVOKE ALL ON ${table} FROM PUBLIC,refs_app`,'i'));
  }
  assert.match(up,/REVOKE ALL ON cash_transfer_internal_gate FROM PUBLIC,refs_app/i);
  assert.match(up,/REVOKE ALL ON FUNCTION[\s\S]+FROM PUBLIC,refs_app/i);
  assert.match(up,/GRANT EXECUTE ON FUNCTION[\s\S]+TO refs_app/i);
});

test('Cash Transfer posts one journal atomically and preserves its retained evidence',()=>{
  assert.match(up,/CREATE TABLE cash_transfer_internal_gate/i);
  assert.match(up,/resource_kind IN\('TRANSFER','JOURNAL','BANK_LINK'\)/i);
  assert.match(up,/INSERT INTO cash_transfer_internal_gate VALUES\(pg_backend_pid\(\),txid_current\(\),p_tenant,p_transfer,'JOURNAL',t[.]journal_entry_id,'POSTED'\)/i);
  assert.match(up,/child:=refs_post_journal\(p_tenant,p_entity,t[.]period_id,t[.]journal_entry_id,p_expected_journal_revision,'cash-transfer:'/i);
  assert.doesNotMatch(up,/INSERT INTO ledger_line/i,'only refs_post_journal may materialize ledger lines');
  assert.match(up,/CREATE TRIGGER cash_transfer_journal_guard BEFORE UPDATE OR DELETE ON journal_entry/i);
  assert.match(up,/Cash Transfer journal must transition through its aggregate/i);
  assert.match(up,/Cash Transfer journal is retained evidence/i);
  assert.match(up,/INSERT INTO audit_event[\s\S]+'CASH_TRANSFER_DRAFT_CREATED'/i);
  assert.match(up,/INSERT INTO outbox_event[\s\S]+'CASH_TRANSFER_DRAFT_CREATED'/i);
  assert.ok((up.match(/INSERT INTO audit_event/g)??[]).length>=4);
  assert.ok((up.match(/INSERT INTO outbox_event/g)??[]).length>=4);
});

test('Cash Transfer bank links remain tenant/entity-bound, leg-complete, and non-duplicative',()=>{
  assert.match(up,/CREATE TABLE cash_transfer_bank_link/i);
  assert.match(up,/leg IN\('SOURCE','DESTINATION'\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,entity_id,cash_transfer_id\) REFERENCES cash_transfer\(tenant_id,entity_id,cash_transfer_id\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,bank_source_id\) REFERENCES bank_source\(tenant_id,bank_source_id\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,entity_id,journal_line_id\) REFERENCES journal_line\(tenant_id,entity_id,journal_line_id\)/i);
  assert.match(up,/FOREIGN KEY\(tenant_id,entity_id,ledger_line_id\) REFERENCES ledger_line\(tenant_id,entity_id,ledger_line_id\)/i);
  assert.match(up,/UNIQUE\(tenant_id,cash_transfer_id,leg\)/i);
  assert.match(up,/CREATE UNIQUE INDEX cash_transfer_bank_link_active_source_uq[\s\S]+WHERE status='ACTIVE'/i);
  assert.match(up,/status IN\('PENDING','ACTIVE','RETIRED'\)/i);
  assert.match(up,/CREATE FUNCTION refs_guard_cash_transfer_bank_link\(\) RETURNS trigger/i);
  assert.match(up,/CREATE TRIGGER cash_transfer_bank_link_guard BEFORE INSERT OR UPDATE OR DELETE ON cash_transfer_bank_link/i);
  assert.match(up,/b[.]entity_id IS DISTINCT FROM NEW[.]entity_id/i);
  assert.match(up,/t[.]status<>'POSTED'/i);
  assert.match(up,/expected_amount:=CASE NEW[.]leg WHEN 'SOURCE' THEN -t[.]amount ELSE t[.]amount END/i);
  assert.match(up,/b[.]bank_account_ref IS DISTINCT FROM expected_bank OR b[.]currency IS DISTINCT FROM t[.]currency OR b[.]amount IS DISTINCT FROM expected_amount/i);
  assert.match(up,/Active Cash Transfer bank-link must reference the exact posted cash Journal and Ledger line/i);
  assert.match(up,/Cash Transfer bank-link identity and linkage actor are immutable/i);
  assert.match(up,/Cash Transfer bank-link status transition is invalid/i);
  assert.match(up,/actor text:=refs_current_actor\(\)/i);
  assert.match(up,/Cash Transfer bank-link requires an authenticated server actor/i);
  assert.match(up,/NEW[.]linked_at:=clock_timestamp\(\)/i);
  assert.match(up,/NEW[.]retired_by:=refs_current_actor\(\);NEW[.]retired_at:=clock_timestamp\(\)/i);
  assert.match(up,/NEW[.]linked_by,NEW[.]linked_at\)\s+IS DISTINCT FROM\s+\(OLD[.]tenant_id/i);
  assert.match(up,/OLD[.]bank_source_id,OLD[.]linked_by,OLD[.]linked_at\)/i);
  assert.match(up,/Cash Transfer bank-link activation cannot retire evidence/i);
  assert.match(up,/resource_kind='BANK_LINK'/i);
});

test('Cash Transfer bank links are created only by an idempotent controlled linker',()=>{
  const linker=up.match(/CREATE FUNCTION refs_link_cash_transfer_bank_leg\([\s\S]*?END;\$\$;/i)?.[0]??'';
  assert.notEqual(linker,'','a controlled bank-link command is required');
  for(const permission of ['CASH.TRANSFER.RECONCILE','GL.JE.VIEW'])assert.match(linker,new RegExp(`refs_assert_scope\\(p_tenant,p_entity,'${permission.replace(/\\./g,'\\\\.')}'\\)`));
  assert.match(linker,/p_request_hash IS DISTINCT FROM expected/i);
  assert.match(linker,/refs_reserve_idempotency\(p_tenant,'CASH_TRANSFER_LINK:'/i);
  assert.match(linker,/idem[.]status='SUCCEEDED'[\s\S]+idempotent/i);
  assert.match(linker,/FROM cash_transfer[\s\S]+FOR UPDATE[\s\S]+t[.]status<>'POSTED' OR t[.]revision<>p_expected_transfer_revision/i);
  assert.match(linker,/FROM journal_line jl JOIN ledger_line ll[\s\S]+jl[.]journal_entry_id=t[.]journal_entry_id[\s\S]+jl[.]account_code=account[\s\S]+jl[.]member_ref=bank[\s\S]+FOR SHARE/i);
  assert.match(linker,/,'BANK_LINK',link_id,'PENDING'\)/i);
  assert.match(linker,/,'BANK_LINK',link_id,'ACTIVE'\)/i);
  assert.match(linker,/PERFORM refs_complete_cash_transfer_idempotency\(/i);
  assert.doesNotMatch(linker,/INSERT INTO idempotency_receipt|UPDATE idempotency_receipt/i);
});

test('Cash Transfer down migration fails closed when retained transfer or bank-link evidence exists',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM cash_transfer\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_link\) OR EXISTS\(SELECT 1 FROM cash_transfer_bank_account_control\)/i);
  assert.match(down,/Cannot roll back cash-transfer migration while retained transfer, bank-link, or bank-control evidence exists/i);
  for(const token of ['cash_transfer_protect','cash_transfer_journal_guard','cash_transfer_bank_link_guard','cash_transfer_bank_account_control_guard','refs_protect_cash_transfer','refs_guard_cash_transfer_journal','refs_guard_cash_transfer_bank_link','refs_guard_cash_transfer_bank_account_control','refs_complete_cash_transfer_idempotency','refs_cancel_cash_transfer','refs_link_cash_transfer_bank_leg','refs_post_cash_transfer','refs_transition_cash_transfer','refs_create_cash_transfer','refs_read_cash_transfer_bank_account_controls','refs_retire_cash_transfer_bank_account_control','refs_approve_cash_transfer_bank_account_control','refs_create_cash_transfer_bank_account_control','cash_transfer_internal_gate','cash_transfer_bank_link','cash_transfer_bank_account_control','cash_transfer'])assert.match(down,new RegExp(token));
  assert.match(down,/DELETE FROM runtime_human_permission_authority WHERE permission_code LIKE 'CASH[.]TRANSFER[.]%'/i);
  assert.match(down,/DELETE FROM permission_catalog WHERE permission_code LIKE 'CASH[.]TRANSFER[.]%'/i);
});
