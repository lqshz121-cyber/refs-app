import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/379_cash_transfer_bank_leg_candidates.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/379_cash_transfer_bank_leg_candidates.sql',import.meta.url),'utf8');
test('Cash Transfer bank-leg candidates derive exact posted, unlinked evidence without BANK.VIEW',()=>{
 const body=up.match(/CREATE FUNCTION refs_read_cash_transfer_bank_leg_candidates[\s\S]*?END;\$\$;/i)?.[0]??'';
 assert.match(body,/VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp/i);
 for(const scope of ['CASH.TRANSFER.VIEW','CASH.TRANSFER.RECONCILE','GL.JE.VIEW'])assert.match(body,new RegExp("refs_assert_scope\\(p_tenant,p_entity,'"+scope.replace(/\./g,'\\.')+"'\\)"));
 assert.doesNotMatch(body,/BANK\.VIEW/);
 assert.match(body,/t.status<>'POSTED'/);assert.match(body,/FOR SHARE/);
 for(const exact of ['b.transaction_date=t.transfer_date','b.currency=t.currency','b.amount=expected_amount','b.bank_account_ref=bank_ref'])assert.match(body,new RegExp(exact.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
 assert.match(body,/l.status='ACTIVE'/);assert.match(body,/LIMIT p_limit\+1/);assert.match(body,/num_nonnulls\(p_after_external_line,p_after_bank_source\) NOT IN\(0,2\)/);
 for(const secret of ['storage_ref','content_hash','source_document_id'])assert.doesNotMatch(body,new RegExp("'"+secret+"'"));
 assert.match(up,/REVOKE ALL ON FUNCTION refs_read_cash_transfer_bank_leg_candidates\(uuid,uuid,uuid,text,integer,text,uuid\) FROM PUBLIC/i);
 assert.match(up,/GRANT EXECUTE ON FUNCTION refs_read_cash_transfer_bank_leg_candidates\(uuid,uuid,uuid,text,integer,text,uuid\) TO refs_app/i);
});
test('Cash Transfer bank-leg candidate rollback fails closed',()=>{
 assert.match(down,/Cannot roll back Cash Transfer bank-leg candidates while retained Cash Transfer evidence exists/i);
 assert.match(down,/DROP FUNCTION refs_read_cash_transfer_bank_leg_candidates\(uuid,uuid,uuid,text,integer,text,uuid\)/i);
});
