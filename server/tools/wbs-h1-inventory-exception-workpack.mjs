#!/usr/bin/env node
// H09: data-quality exception queue + human review workpack over the WBS H1
// import inventory read model (265).  Pure function over already-read pages:
// the operator exports `GET /entities/{id}/wbs/h1-import-inventory?limit=200&offset=N`
// pages (authenticated, read-only) to a JSON array and feeds them here.  The
// tool opens no network or database connection, posts nothing, and its output
// is a review queue with control totals — never an accounting action.
//
//   node server/tools/wbs-h1-inventory-exception-workpack.mjs pages.json [--queue-limit 50] [--large-abs 1000000]
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const WBS_H1_EXCEPTION_WORKPACK_SCHEMA='WBS_H1_EXCEPTION_WORKPACK_V1';
const MONTHS=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
const MONEY=/^-?(?:0|[1-9]\d{0,15})\.\d{4}$/;
const HASH=/^sha256:[0-9a-f]{64}$/;
const COUNT_KEYS=['source_record_count','controlled_test_posted_count','formal_mapping_posted_count','mapping_missing_count','mapping_ready_count','mapping_ambiguous_count'];
const cents=value=>{if(typeof value!=='string'||!MONEY.test(value))return null;const negative=value.startsWith('-');const [whole,fraction]=value.replace('-','').split('.');const n=BigInt(whole)*10000n+BigInt(fraction);return negative?-n:n;};
const money=value=>{const negative=value<0n;const abs=negative?-value:value;const whole=abs/10000n,fraction=abs%10000n;return `${negative?'-':''}${whole}.${String(fraction).padStart(4,'0')}`;};

export function buildExceptionWorkpack(pages,{queueLimit=50,largeAbs='1000000.0000'}={}){
  if(!Array.isArray(pages)||!pages.length)throw new Error('pages must be a non-empty array of inventory pages');
  if(!Number.isSafeInteger(queueLimit)||queueLimit<1||queueLimit>1000)throw new Error('queueLimit must be 1..1000');
  const largeCents=cents(largeAbs);if(largeCents===null||largeCents<0n)throw new Error('largeAbs must be a non-negative MONEY4 string');
  const first=pages[0];
  if(first?.schema_version!=='WBS_H1_IMPORT_INVENTORY_V1'||!first.totals||!Array.isArray(first.months))throw new Error('page 0 is not a WBS_H1_IMPORT_INVENTORY_V1 page');
  const companyCode=first.company_code,declared=first.totals;
  const rows=[];const pageErrors=[];
  pages.forEach((page,index)=>{
    if(page.schema_version!=='WBS_H1_IMPORT_INVENTORY_V1'||page.company_code!==companyCode){pageErrors.push({page:index,code:'PAGE_SCOPE_DRIFT'});return;}
    if(JSON.stringify(page.totals)!==JSON.stringify(declared)){pageErrors.push({page:index,code:'PAGE_TOTALS_DRIFT'});}
    if(!Array.isArray(page.rows)){pageErrors.push({page:index,code:'PAGE_ROWS_INVALID'});return;}
    page.rows.forEach((row,ordinal)=>rows.push({...row,_page:index,_ordinal:ordinal}));
  });
  const exceptions={MAPPING_MISSING:[],MAPPING_AMBIGUOUS:[],SOURCE_STAGED_NO_DRAFT:[],DUPLICATE_SOURCE_HASH:[],DATE_OUT_OF_H1:[],ZERO_OR_INVALID_AMOUNT:[],LARGE_NEGATIVE_AMOUNT:[],HASH_INVALID:[],FORMAL_POSTED_WITH_MAPPING_MISSING:[]};
  const seen=new Map();let sum=0n,valid=0;const byMonth=Object.fromEntries(MONTHS.map(m=>[m,{source_record_count:0,source_amount:0n,controlled_test_posted_count:0,mapping_missing_count:0,mapping_ready_count:0,mapping_ambiguous_count:0,formal_mapping_posted_count:0}]));
  const push=(code,row,extra={})=>exceptions[code].push({source_record_hash:typeof row.source_record_hash==='string'?row.source_record_hash.slice(0,23):null,accounting_date:row.accounting_date??null,amount:row.amount??null,import_state:row.import_state??null,mapping_state:row.mapping_state??null,page:row._page,ordinal:row._ordinal,...extra});
  for(const row of rows){
    const hashOk=HASH.test(row.source_record_hash||'');if(!hashOk)push('HASH_INVALID',row);
    if(hashOk){if(seen.has(row.source_record_hash))push('DUPLICATE_SOURCE_HASH',row,{first_seen:seen.get(row.source_record_hash)});else seen.set(row.source_record_hash,`${row._page}:${row._ordinal}`);}
    const c=cents(row.amount);
    if(c===null||c===0n)push('ZERO_OR_INVALID_AMOUNT',row);else{sum+=c;valid++;if(c<0n&&-c>largeCents)push('LARGE_NEGATIVE_AMOUNT',row);}
    const month=typeof row.accounting_date==='string'?row.accounting_date.slice(0,7):'';
    const inH1=MONTHS.includes(month)&&/^\d{4}-\d{2}-\d{2}$/.test(row.accounting_date)&&row.accounting_date>='2026-01-01'&&row.accounting_date<='2026-06-30';
    if(!inH1)push('DATE_OUT_OF_H1',row);
    if(row.mapping_state==='MAPPING_MISSING')push('MAPPING_MISSING',row);
    if(row.mapping_state==='MAPPING_AMBIGUOUS')push('MAPPING_AMBIGUOUS',row);
    if(row.import_state==='SOURCE_STAGED')push('SOURCE_STAGED_NO_DRAFT',row);
    if(row.import_state==='FORMAL_MAPPING_POSTED'&&row.mapping_state==='MAPPING_MISSING')push('FORMAL_POSTED_WITH_MAPPING_MISSING',row);
    if(inH1){const m=byMonth[month];m.source_record_count++;if(c!==null)m.source_amount+=c;if(row.import_state==='CONTROLLED_TEST_POSTED')m.controlled_test_posted_count++;if(row.import_state==='FORMAL_MAPPING_POSTED')m.formal_mapping_posted_count++;if(row.mapping_state==='MAPPING_MISSING')m.mapping_missing_count++;if(row.mapping_state==='MAPPING_READY_FOR_REVIEW')m.mapping_ready_count++;if(row.mapping_state==='MAPPING_AMBIGUOUS')m.mapping_ambiguous_count++;}
  }
  const recomputed={source_record_count:rows.length,source_amount:money(sum),controlled_test_posted_count:rows.filter(r=>r.import_state==='CONTROLLED_TEST_POSTED').length,formal_mapping_posted_count:rows.filter(r=>r.import_state==='FORMAL_MAPPING_POSTED').length,mapping_missing_count:exceptions.MAPPING_MISSING.length,mapping_ready_count:rows.filter(r=>r.mapping_state==='MAPPING_READY_FOR_REVIEW').length,mapping_ambiguous_count:exceptions.MAPPING_AMBIGUOUS.length};
  const controlMismatches=[];
  for(const key of [...COUNT_KEYS,'source_amount']){const d=declared[key],r=recomputed[key];if(key==='source_amount'?cents(String(d))!==cents(r):d!==r)controlMismatches.push({key,declared:d,recomputed:r});}
  const monthMismatches=[];
  for(const declaredMonth of first.months){const m=byMonth[declaredMonth.period_code];if(!m){monthMismatches.push({period_code:declaredMonth.period_code,key:'period_code',declared:declaredMonth.period_code,recomputed:null});continue;}
    for(const key of ['source_record_count','controlled_test_posted_count','formal_mapping_posted_count','mapping_missing_count','mapping_ready_count','mapping_ambiguous_count'])if(declaredMonth[key]!==m[key])monthMismatches.push({period_code:declaredMonth.period_code,key,declared:declaredMonth[key],recomputed:m[key]});
    if(cents(String(declaredMonth.source_amount))!==m.source_amount)monthMismatches.push({period_code:declaredMonth.period_code,key:'source_amount',declared:declaredMonth.source_amount,recomputed:money(m.source_amount)});}
  const complete=rows.length===declared.source_record_count;
  const queue=[];for(const [code,items] of Object.entries(exceptions))for(const item of items){if(queue.length>=queueLimit)break;if(code==='MAPPING_MISSING')continue;queue.push({code,...item});}
  // MAPPING_MISSING is the bulk population; it enters the queue only as a count + first N so a reviewer sees the shape without 1,000 rows.
  for(const item of exceptions.MAPPING_MISSING.slice(0,Math.max(0,queueLimit-queue.length)))queue.push({code:'MAPPING_MISSING',...item});
  return Object.freeze({
    schema_version:WBS_H1_EXCEPTION_WORKPACK_SCHEMA,company_code:companyCode,currency:first.currency,date_from:first.date_from,date_to:first.date_to,
    pages_read:pages.length,rows_read:rows.length,inventory_complete:complete,page_errors:pageErrors,
    control:{declared,recomputed,mismatches:controlMismatches,reconciled:complete&&controlMismatches.length===0&&monthMismatches.length===0&&pageErrors.length===0},
    months:MONTHS.map(m=>({period_code:m,...byMonth[m],source_amount:money(byMonth[m].source_amount)})),month_mismatches:monthMismatches,
    exception_counts:Object.fromEntries(Object.entries(exceptions).map(([k,v])=>[k,v.length])),
    review_queue:queue,review_queue_truncated:Object.values(exceptions).reduce((a,v)=>a+v.length,0)>queue.length,
    accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false,auto_post:false
  });
}

async function main(){
  const [file,...rest]=process.argv.slice(2);if(!file){process.stderr.write('usage: wbs-h1-inventory-exception-workpack.mjs pages.json [--queue-limit N] [--large-abs MONEY4]\n');process.exitCode=2;return;}
  const opts={};for(let i=0;i<rest.length;i++){if(rest[i]==='--queue-limit')opts.queueLimit=Number(rest[++i]);else if(rest[i]==='--large-abs')opts.largeAbs=rest[++i];else throw new Error(`Unknown argument ${rest[i]}`);}
  const pages=JSON.parse(readFileSync(file,'utf8'));
  const pack=buildExceptionWorkpack(Array.isArray(pages)?pages:[pages],opts);
  process.stdout.write(`${JSON.stringify(pack)}\n`);
  process.exitCode=pack.control.reconciled?0:3;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
