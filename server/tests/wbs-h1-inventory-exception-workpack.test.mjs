import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildExceptionWorkpack} from '../tools/wbs-h1-inventory-exception-workpack.mjs';

const sha=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
const money=c=>`${c<0?'-':''}${Math.trunc(Math.abs(c)/10000)}.${String(Math.abs(c)%10000).padStart(4,'0')}`;
// Build a synthetic but self-consistent inventory: random amounts, random month spread, declared totals derived from the rows.
function inventory({rows,pageSize=200,tamper=null}){
  const months=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'].map(period_code=>({period_code,source_record_count:0,source_amount:0,controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:0,mapping_ready_count:0,mapping_ambiguous_count:0}));
  const totals={source_record_count:0,source_amount:0,controlled_test_posted_count:0,formal_mapping_posted_count:0,mapping_missing_count:0,mapping_ready_count:0,mapping_ambiguous_count:0};
  for(const r of rows){const m=months.find(x=>x.period_code===r.accounting_date.slice(0,7));const c=Math.round(Number(r.amount)*10000);for(const t of [m,totals]){if(!t)continue;t.source_record_count++;t.source_amount+=c;if(r.import_state==='CONTROLLED_TEST_POSTED')t.controlled_test_posted_count++;if(r.import_state==='FORMAL_MAPPING_POSTED')t.formal_mapping_posted_count++;if(r.mapping_state==='MAPPING_MISSING')t.mapping_missing_count++;if(r.mapping_state==='MAPPING_READY_FOR_REVIEW')t.mapping_ready_count++;if(r.mapping_state==='MAPPING_AMBIGUOUS')t.mapping_ambiguous_count++;}}
  const fix=t=>({...t,source_amount:money(t.source_amount)});
  const declared=tamper?tamper(fix(totals)):fix(totals);
  const pages=[];for(let offset=0;offset<rows.length;offset+=pageSize)pages.push({schema_version:'WBS_H1_IMPORT_INVENTORY_V1',company_code:'WBTS',currency:'USD',date_from:'2026-01-01',date_to:'2026-06-30',limit:pageSize,offset,totals:declared,months:months.map(fix),rows:rows.slice(offset,offset+pageSize),source_mode:'REAL_WBS_STAGED',accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false});
  return pages;
}
function randomRows(n){
  const rows=[];for(let i=0;i<n;i++){const month=1+randomInt(0,6),day=1+randomInt(0,28);const cents=randomInt(100,50000000)*(randomInt(0,10)===0?-1:1);rows.push({source_record_hash:sha(`row-${i}-${cents}`),accounting_date:`2026-0${month}-${String(day).padStart(2,'0')}`,amount:money(cents),import_state:randomInt(0,20)===0?'SOURCE_STAGED':'CONTROLLED_TEST_POSTED',mapping_state:randomInt(0,10)<9?'MAPPING_MISSING':'MAPPING_READY_FOR_REVIEW',cost_code:'CC',vendor_no:'V',project_code:'P'});}
  return rows;
}

test('a self-consistent inventory reconciles: recomputed control totals and month totals equal the declared ones, exception counts match the population',()=>{
  const rows=randomRows(1234);
  const pack=buildExceptionWorkpack(inventory({rows}));
  assert.equal(pack.inventory_complete,true);assert.equal(pack.control.reconciled,true);assert.deepEqual(pack.control.mismatches,[]);assert.deepEqual(pack.month_mismatches,[]);
  assert.equal(pack.exception_counts.MAPPING_MISSING,rows.filter(r=>r.mapping_state==='MAPPING_MISSING').length);
  assert.equal(pack.exception_counts.SOURCE_STAGED_NO_DRAFT,rows.filter(r=>r.import_state==='SOURCE_STAGED').length);
  assert.equal(pack.exception_counts.DUPLICATE_SOURCE_HASH,0);assert.equal(pack.exception_counts.DATE_OUT_OF_H1,0);assert.equal(pack.exception_counts.ZERO_OR_INVALID_AMOUNT,0);
  assert.equal(pack.exception_counts.LARGE_NEGATIVE_AMOUNT,rows.filter(r=>Number(r.amount)<-1000000).length);
  assert.equal(pack.can_post,false);assert.equal(pack.auto_post,false);assert.equal(pack.accounting_authority,'NONE');
  assert.ok(pack.review_queue.length<=50);assert.ok(pack.review_queue.every(item=>!Object.hasOwn(item,'vendor_no')&&!Object.hasOwn(item,'cost_code')&&item.source_record_hash.length===23),'queue rows carry only hash prefix, date, amount, states');
});

test('tampered declared totals, duplicate hashes, out-of-H1 dates and zero amounts are surfaced and the pack is NOT reconciled',()=>{
  const rows=randomRows(300);
  rows.push({...rows[0]});                                                    // duplicate hash
  rows.push({...rows[1],source_record_hash:sha('late'),accounting_date:'2026-08-06'}); // outside H1
  rows.push({...rows[2],source_record_hash:sha('zero'),amount:'0.0000'});   // zero amount
  const pages=inventory({rows,tamper:t=>({...t,source_record_count:t.source_record_count-7})});
  const pack=buildExceptionWorkpack(pages);
  assert.equal(pack.control.reconciled,false);
  assert.ok(pack.control.mismatches.some(m=>m.key==='source_record_count'));
  assert.equal(pack.exception_counts.DUPLICATE_SOURCE_HASH,1);assert.equal(pack.exception_counts.DATE_OUT_OF_H1,1);assert.equal(pack.exception_counts.ZERO_OR_INVALID_AMOUNT,1);
  assert.ok(pack.review_queue.some(item=>item.code==='DUPLICATE_SOURCE_HASH'&&item.first_seen));
});

test('pages that drift in company or totals are flagged and a partial export is reported incomplete',()=>{
  const rows=randomRows(450);const pages=inventory({rows,pageSize:200});
  const drifted=[pages[0],{...pages[1],company_code:'OTHR'}];
  const pack=buildExceptionWorkpack(drifted);
  assert.equal(pack.inventory_complete,false);assert.deepEqual(pack.page_errors,[{page:1,code:'PAGE_SCOPE_DRIFT'}]);assert.equal(pack.control.reconciled,false);
  assert.throws(()=>buildExceptionWorkpack([]),/non-empty/);
  assert.throws(()=>buildExceptionWorkpack([{schema_version:'OTHER'}]),/not a WBS_H1_IMPORT_INVENTORY_V1/);
});

test('tool source opens no network or database connection and never posts',()=>{
  const source=readFileSync(fileURLToPath(new URL('../tools/wbs-h1-inventory-exception-workpack.mjs',import.meta.url)),'utf8');
  assert.doesNotMatch(source,/fetch\(|createPool|DATABASE_URL|postJournal|transition|https?:\/\//);
});
