import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomInt} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildMappingReviewWorkpack} from '../tools/wbs-h1-mapping-review-workpack.mjs';

const sha=v=>`sha256:${createHash('sha256').update(String(v)).digest('hex')}`;
const money=c=>`${c<0?'-':''}${Math.trunc(Math.abs(c)/10000)}.${String(Math.abs(c)%10000).padStart(4,'0')}`;
const rule=(detail,decision,account,projects)=>({rule_id:sha(`r${detail}`),wbs_setting_id:'1',detail,decision,account_code:account,account_name:account?`Account ${account}`:'',project_codes:projects,selection_mode:'COST_CODE',effective_from:'2026-01-01',effective_to:'2026-12-31',source_setting_hash:sha(`s${detail}`),supplementary:{}});
const settings={schema_version:'WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1',company_code:'WBTS',currency:'USD',period_id:'p1',period_code:'2026-01',status:'EXCEPTION',proposal_hash:sha('settings'),ready_rule_count:1,blocked_rule_count:0,exception_count:3,source_setting_count:4,accounting_authority:'NONE',can_create_draft:false,can_review:false,can_approve:false,can_post:false,
  rules:[rule('CC-READY','READY_FOR_HUMAN_REVIEW','291001',['WBTSAAA']),rule('CC-WIDE','ACCOUNT_NOT_READY','700418',['WBTS']),rule('CC-NOACCT','MAPPING_MISSING',null,[]),rule('CC-OTHERPROJ','ACCOUNT_NOT_READY','651000',['WBTSZZZ'])]};
function row(cost,project,codes,amountCents,period='2026-01'){return {source_record_hash:sha(`${cost}-${project}-${amountCents}-${Math.random()}`),wbs_uuid:'u',accounting_date:`${period}-10`,amount:money(amountCents),project_code:project,cost_code:cost,vendor_no:'V',status:'EXCEPTION',exception_codes:codes,debit_setting_id:null,debit_setting_hash:null,credit_setting_id:null,credit_setting_hash:null,proposed_lines:[],report_impact:{},proposal_hash:sha('p'),can_create_draft:false,can_review:false,can_approve:false,can_post:false};}
function page(rows,period='2026-01'){return {schema_version:'WBS_H1_PAYABLE_ACCOUNTING_PROPOSAL_V1',company_code:'WBTS',currency:'USD',period_id:`pid-${period}`,period_code:period,period_start:`${period}-01`,period_end:`${period}-28`,settings_proposal_hash:sha('settings'),settings_decision_hash:null,settings_outcome:'NOT_DECIDED',source_record_count:rows.length,ready_count:0,exception_count:rows.length,limit:200,offset:0,rows,source_mode:'REAL_WBS_STAGED',accounting_authority:'PROPOSAL_ONLY',can_create_draft:false,can_review:false,can_approve:false,can_post:false};}

test('classifies each exception row into the decision a Controller must take and separates suggestable from must-decide',()=>{
  const rows=[
    ...Array.from({length:5},()=>row('CC-WIDE','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],randomInt(100,99999))),
    ...Array.from({length:3},()=>row('CC-NOACCT','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],randomInt(100,99999))),
    row('CC-OTHERPROJ','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],5000),
    row('CC-UNKNOWN','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],7000),
    row('CC-READY','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','VENDOR_MEMBER_NOT_READY'],-900000),
    row('CC-READY','WBTSAAA',['SETTINGS_NOT_APPROVED'],123456)
  ];
  const pack=buildMappingReviewWorkpack({settings,payablePages:[page(rows)]});
  assert.equal(pack.control.complete,true);assert.equal(pack.exception_rows,12);
  assert.equal(pack.class_totals.RULE_SCOPE_COMPANY_WIDE.rows,5);
  assert.equal(pack.class_totals.COA_ACCOUNT_TO_CREATE.rows,5,'company-wide rule with a missing account becomes an account-creation suggestion');
  assert.equal(pack.class_totals.RULE_WITHOUT_ACCOUNT.rows,3);
  assert.equal(pack.class_totals.RULE_PROJECT_MISMATCH.rows,1);
  assert.equal(pack.class_totals.NO_RULE.rows,1);
  assert.equal(pack.class_totals.CREDIT_RULE_MISSING.rows,11);
  assert.equal(pack.class_totals.VENDOR_MEMBER_MISSING.rows,1);
  assert.equal(pack.class_totals.SETTINGS_APPROVAL_PENDING.rows,1);
  assert.deepEqual(pack.accounts_to_create.map(a=>[a.account_code,a.rows,a.cost_codes]),[['700418',5,['CC-WIDE']]]);
  const wide=pack.review_queue.find(q=>q.cost_code==='CC-WIDE');
  assert.equal(wide.decision_class,'COA_ACCOUNT_TO_CREATE');assert.equal(wide.company_wide_rule,true);assert.equal(wide.auto_suggestable,true);assert.equal(wide.must_decide,false);
  const noacct=pack.review_queue.find(q=>q.cost_code==='CC-NOACCT');assert.equal(noacct.must_decide,true);assert.equal(noacct.auto_suggestable,false);
  assert.equal(pack.settings.rules_scoped_to_company_code,1);assert.equal(pack.settings.rules_without_project_scope,1);
  assert.equal(pack.can_post,false);assert.equal(pack.auto_post,false);assert.equal(pack.accounting_authority,'NONE');
  // control totals: sum of all row amounts in integer cents equals the declared amount
  const expected=rows.reduce((a,r)=>a+Math.round(Number(r.amount)*10000),0);assert.equal(pack.control.source_amount,money(expected));
});

test('multi-period pages aggregate per period and a scope-drifted page is reported and excluded',()=>{
  const p1=page([row('CC-WIDE','WBTSAAA',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],1000)],'2026-01');
  const p2=page([row('CC-WIDE','WBTSBBB',['SETTINGS_NOT_APPROVED','CREDIT_MAPPING_MISSING','DEBIT_MAPPING_MISSING'],2000,'2026-02')],'2026-02');
  const drift={...page([row('CC-WIDE','WBTSAAA',['SETTINGS_NOT_APPROVED'],1)]),company_code:'OTHR'};
  const pack=buildMappingReviewWorkpack({settings,payablePages:[p1,p2,drift]});
  assert.deepEqual(pack.periods.map(p=>p.period_code),['2026-01','2026-02']);
  assert.deepEqual(pack.control.page_errors,[{page:2,code:'PAGE_SCOPE_DRIFT'}]);assert.equal(pack.control.complete,false);
  const item=pack.review_queue.find(q=>q.cost_code==='CC-WIDE');assert.deepEqual(item.periods,['2026-01','2026-02']);assert.equal(item.projects,2);
});

test('input validation and no-network/no-write source guard',()=>{
  assert.throws(()=>buildMappingReviewWorkpack({settings:{schema_version:'X'},payablePages:[page([])]}),/WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1/);
  assert.throws(()=>buildMappingReviewWorkpack({settings,payablePages:[]}),/non-empty/);
  const source=readFileSync(fileURLToPath(new URL('../tools/wbs-h1-mapping-review-workpack.mjs',import.meta.url)),'utf8');
  assert.doesNotMatch(source,/fetch\(|createPool|DATABASE_URL|INSERT |UPDATE |postJournal|https?:\/\//);
});
