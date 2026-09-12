import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {buildJournalUploadCsv,validJournalUploadRows} from '../runtime/journal-upload-export.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';
import {exportAuthoritativeJournalUploadFile} from '../../src/accounting-api.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',periodId='33333333-3333-4333-8333-333333333333',journalId='44444444-4444-4444-8444-444444444444';
const line=(lineNo,debit,credit)=>({journal_entry_id:journalId,journal_number:'JE-UPLOAD-1',journal_type:'MANUAL',status:'APPROVED',journal_date:'2026-07-18',currency:'USD',description:'Approved upload preparation',revision:2,created_at:'2026-07-18T00:00:00.000Z',posted_at:null,line_no:lineNo,journal_line_id:lineNo===1?'55555555-5555-4555-8555-555555555555':'66666666-6666-4666-8666-666666666666',account_code:lineNo===1?'610000':'111000',debit_amount:debit,credit_amount:credit,member_ref:lineNo===1?'VENDOR-1':'BANK-1',line_description:lineNo===1?'Vendor expense':'Bank payment',dimensions:{},source_document_ids:[]});
const rows=[line(1,'25.0000','0.0000'),line(2,'0.0000','25.0000')];
const config={tenantId,entityId,periodId,baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};

test('journal upload export is manifest-bound and accepts only balanced approved rows',async()=>{
  const name='397_journal_upload_export_read.sql',entry=MIGRATION_MANIFEST.find(row=>row.name===name);
  const up=await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'),down=await readFile(new URL('../db/migrations/down/'+name,import.meta.url),'utf8');
  assert.equal(entry?.up,digest(up.replace(/\r\n/g,'\n')));assert.equal(entry?.down,digest(down.replace(/\r\n/g,'\n')));
  for(const token of ["refs_assert_scope(p_tenant,p_entity,'GL.JE.VIEW')","j.status='APPROVED'",'Journal upload population is saturated','source_document_id IS NOT NULL','sl.journal_line_id=l.journal_line_id','sl.journal_entry_id=j.journal_entry_id'])assert.ok(up.includes(token),token);
  assert.equal(validJournalUploadRows(rows),true);
  assert.equal(validJournalUploadRows(rows.map(row=>({...row,posted_at:'not-a-date'}))),false);
  assert.equal(validJournalUploadRows(rows.map(row=>({...row,journal_date:'2026-02-30'}))),false);
  assert.equal(validJournalUploadRows([...rows,{...line(2,'0.0000','24.9999')}]),false);
  assert.equal(validJournalUploadRows(rows.map(row=>({...row,status:'POSTED'}))),false);
});

test('journal upload CSV is deterministic, balanced, and content-hash bound',()=>{
  const artifact=buildJournalUploadCsv({rows,entityId,periodId});
  assert.ok(artifact);assert.equal(artifact.format,'CSV');assert.equal(artifact.row_count,2);assert.equal(artifact.journal_entry_ids.length,1);
  assert.equal(artifact.content,'JournalNumber,JournalDate,JournalType,AccountCode,Currency,Debit,Credit,Description,MemberRef,SourceDocumentIds\r\nJE-UPLOAD-1,2026-07-18,MANUAL,610000,USD,25.0000,0.0000,Vendor expense,VENDOR-1,\r\nJE-UPLOAD-1,2026-07-18,MANUAL,111000,USD,0.0000,25.0000,Bank payment,BANK-1,\r\n');
  assert.equal(artifact.content_hash,`sha256:${digest(artifact.content)}`);
  assert.equal(buildJournalUploadCsv({rows:[rows[0]],entityId,periodId}),null);
});

test('HTTP export is read-only, exact-query, scoped and hash bound',async()=>{
  const calls=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readJournalUploadRows:async args=>(calls.push(args),rows)})});
  const path=`/api/v1/entities/${entityId}/journal-entries/export?periodId=${periodId}&format=csv`;
  const response=await api({method:'GET',url:path,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(response.headers['content-type'],'text/csv; charset=utf-8');assert.equal(response.headers['x-journal-upload-row-count'],'2');assert.match(response.headers['x-journal-upload-export-hash'],/^sha256:[a-f0-9]{64}$/);assert.equal(response.headers.etag,`"${response.headers['x-journal-upload-export-hash']}"`);assert.match(response.rawBody,/JE-UPLOAD-1/);assert.deepEqual(calls,[{tenantId,entityId,periodId}]);
  assert.equal((await api({method:'GET',url:path+'&x=1',headers:{},body:null})).status,400);
  assert.equal((await api({method:'GET',url:path,headers:{'idempotency-key':'forbidden'},body:null})).status,400);
  assert.equal((await api({method:'GET',url:path,headers:{},body:{}})).status,400);
  const invalid=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readJournalUploadRows:async()=>rows.map(row=>({...row,status:'POSTED'}))})});
  assert.equal((await invalid({method:'GET',url:path,headers:{},body:null})).status,502);
});

test('browser accepts only a verified download hash and safe headers',async()=>{
  const artifact=buildJournalUploadCsv({rows,entityId,periodId});
  const good=await exportAuthoritativeJournalUploadFile({config,cryptoApi:webcrypto,fetcher:async()=>new Response(artifact.content,{status:200,headers:{'content-type':artifact.content_type,'content-disposition':`attachment; filename="${artifact.filename}"`,'x-journal-upload-export-hash':artifact.content_hash,'x-journal-upload-row-count':'2'}})});
  assert.equal(good.ok,true);assert.equal(good.data.contentHash,artifact.content_hash);
  const bad=await exportAuthoritativeJournalUploadFile({config,cryptoApi:webcrypto,fetcher:async()=>new Response(artifact.content+'x',{status:200,headers:{'content-type':artifact.content_type,'content-disposition':`attachment; filename="${artifact.filename}"`,'x-journal-upload-export-hash':artifact.content_hash,'x-journal-upload-row-count':'2'}})});
  assert.equal(bad.ok,false);assert.equal(bad.code,'JOURNAL_UPLOAD_EXPORT_PROTOCOL');
});
