import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('COA and register SQL are entity-scoped, POSTED-only, fixed-decimal reads with no mutations',async()=>{
  const up=await readFile(new URL('../db/migrations/083_chart_of_accounts_register_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/083_chart_of_accounts_register_read.sql',import.meta.url),'utf8');
  const dateContractUp=await readFile(new URL('../db/migrations/089_coa_register_date_contract.sql',import.meta.url),'utf8');
  const dateContractDown=await readFile(new URL('../db/migrations/down/089_coa_register_date_contract.sql',import.meta.url),'utf8');
  for(const token of ['refs_list_chart_of_accounts',"'GL.REPORT.VIEW'",'refs_list_account_register',"'GL.JE.VIEW'",'refs_assert_scope',"j.status='POSTED'",'numeric\\(20,4\\)','PARTITION BY s.currency','source_document_ids','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|refs_transition_)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_list_account_register/);assert.match(down,/DROP FUNCTION IF EXISTS refs_list_chart_of_accounts/);
  for(const token of ['period_start text','period_end text','journal_date text',"to_char\\(selected_period.starts_on,'YYYY-MM-DD'\\)","to_char\\(selected_period.ends_on,'YYYY-MM-DD'\\)","to_char\\(s.journal_date,'YYYY-MM-DD'\\)",'REVOKE ALL','GRANT EXECUTE'])assert.match(dateContractUp,new RegExp(token));
  assert.doesNotMatch(dateContractUp,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|refs_transition_)\b/i);
  for(const token of ['period_start date','period_end date','journal_date date','REVOKE ALL','GRANT EXECUTE'])assert.match(dateContractDown,new RegExp(token));
});

test('repository and HTTP expose exact authenticated no-store COA and register GET contracts',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listChartOfAccounts({tenantId:'t',entityId:'e',periodId:'p'});await kernel.listAccountRegister({tenantId:'t',entityId:'e',periodId:'p',accountCode:'111000'});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_chart_of_accounts($1,$2,$3)',args:['t','e','p']},{sql:'SELECT * FROM refs_list_account_register($1,$2,$3,$4)',args:['t','e','p','111000']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),periodId=randomUUID(),journalEntryId=randomUUID(),journalLineId=randomUUID(),ledgerLineId=randomUUID(),scopes=[];
  const coaRow={period_id:periodId,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',account_code:'111000',account_name:'Cash',requires_member:true,required_member_type:'BANK',active:true,currency:'USD',opening_balance:'0.0000',period_debit:'100.0000',period_credit:'0.0000',ending_balance:'100.0000',posted_ledger_line_count:'1'};
  const registerRow={period_id:periodId,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',account_code:'111000',account_name:'Cash',currency:'USD',journal_date:'2026-07-15',journal_entry_id:journalEntryId,journal_number:'JE-001',journal_line_id:journalLineId,ledger_line_id:ledgerLineId,member_ref:'BANK-1',description:null,debit_amount:'100.0000',credit_amount:'0.0000',opening_balance:'0.0000',running_balance:'100.0000',source_document_ids:[]};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listChartOfAccounts:async scope=>{scopes.push(['coa',scope]);return [coaRow];},listAccountRegister:async scope=>{scopes.push(['register',scope]);return [registerRow];}})});
  const coa=`/api/v1/entities/${entityId}/general-ledger/chart-of-accounts?periodId=${periodId}`;
  const register=`/api/v1/entities/${entityId}/general-ledger/account-register?periodId=${periodId}&accountCode=111000`;
  const coaResponse=await api({method:'GET',url:coa,headers:{},body:null});const registerResponse=await api({method:'GET',url:register,headers:{},body:null});
  for(const response of [coaResponse,registerResponse]){assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');}
  assert.deepEqual(coaResponse.body.data,[coaRow]);assert.deepEqual(registerResponse.body.data,[registerRow]);
  assert.deepEqual(scopes,[['coa',{tenantId,entityId,periodId}],['register',{tenantId,entityId,periodId,accountCode:'111000'}]]);
  assert.equal((await api({method:'GET',url:`${register}&extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:register.replace('111000','invalid account'),headers:{},body:null})).body.code,'INVALID_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:coa,headers:{'idempotency-key':'not-allowed'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:register,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
