import assert from 'node:assert/strict';
import test from 'node:test';
import {analyzeAttestedConstructionLoanDrawCwip,constructionLoanCwipPopulationHash,validateConstructionLoanCwipPopulationAttestation} from '../runtime/ai-construction-loan-cwip-population-attestation.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),entity=id(2),period=id(3),sha=n=>`sha256:${String(n).repeat(64).slice(0,64)}`;
const policy={setting_snapshot_id:id(50),setting_snapshot_hash:sha('a'),policy_version:1,minimum_excess_draw:'100.0000'};
const loan={period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',account_code:'251500',account_name:'Construction loan payable',mapping_status:'MAPPED_CONSTRUCTION_LOAN_ACCOUNT',activity_status:'CURRENT_PERIOD_ACTIVITY',current_activity_line_count:1,classification:'CONSTRUCTION_LOAN',opposite_classification:'NOT_CWIP',classification_basis:'APPROVED_CONSTRUCTION_LOAN_ACCOUNT_MAPPING_SNAPSHOT_EXACT',opening_balance:'0.0000',period_draws:'500.0000',period_repayments:'0.0000',closing_balance:'500.0000',mapping_snapshot_id:id(4),mapping_version:'1',mapping_snapshot_hash:sha('b'),opposite_mapping_snapshot_id:id(16),opposite_mapping_version:'1',opposite_mapping_snapshot_hash:sha('d'),journal_entry_ids:[id(5)],journal_line_ids:[id(6)],ledger_line_ids:[id(7)],posting_batch_ids:[id(14)],source_document_ids:[id(8)],lineage_complete:true};
const cwip={period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',account_code:'164100',account_name:'Construction work in progress',mapping_status:'MAPPED_CWIP_ACCOUNT',activity_status:'CURRENT_PERIOD_ACTIVITY',current_activity_line_count:1,classification:'CWIP',opposite_classification:'NOT_CONSTRUCTION_LOAN',classification_basis:'APPROVED_CWIP_ACCOUNT_MAPPING_SNAPSHOT_EXACT',opening_balance:'0.0000',period_debit:'300.0000',period_credit:'0.0000',closing_balance:'300.0000',mapping_snapshot_id:id(9),mapping_version:'1',mapping_snapshot_hash:sha('c'),opposite_mapping_snapshot_id:id(17),opposite_mapping_version:'1',opposite_mapping_snapshot_hash:sha('e'),journal_entry_ids:[id(10)],journal_line_ids:[id(11)],ledger_line_ids:[id(12)],posting_batch_ids:[id(15)],source_document_ids:[id(13)],lineage_complete:true};
const seal=core=>({...core,population_hash:constructionLoanCwipPopulationHash(core)});
const base=(overrides={})=>seal({schema_version:'AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1',tenant_id:tenant,entity_id:entity,accounting_period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',status:'COMPLETE',applicable:true,counts:{eligible_count:2,mapped_count:2,missing_count:0,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:2,zero_activity_count:0,loan_row_count:1,cwip_row_count:1,non_target_count:0,unclassified_count:0,population_count:2},loan_rows:[loan],cwip_rows:[cwip],non_target_rows:[],unclassified_rows:[],population_watermark:'2026-07-31T12:00:00.000Z',...overrides});

test('consumes one complete atomic population and retains four disabled actions',()=>{
  const result=analyzeAttestedConstructionLoanDrawCwip(base(),{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy});
  assert.equal(result.finding_count,1);assert.equal(result.findings[0].unexplained_excess_draw,'200.0000');assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('keeps an approved zero-activity CWIP target in the complete population',()=>{
  const zeroCwip={...cwip,activity_status:'ZERO_CURRENT_PERIOD_ACTIVITY',current_activity_line_count:0,period_debit:'0.0000',period_credit:'0.0000',closing_balance:'0.0000',journal_entry_ids:[],journal_line_ids:[],ledger_line_ids:[],posting_batch_ids:[],source_document_ids:[]};
  const core={...base(),counts:{...base().counts,current_activity_line_count:1,zero_activity_count:1},cwip_rows:[zeroCwip]};delete core.population_hash;
  const result=analyzeAttestedConstructionLoanDrawCwip(seal(core),{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy});
  assert.equal(result.finding_count,1);assert.equal(result.findings[0].period_cwip_net_additions,'0.0000');assert.equal(result.findings[0].unexplained_excess_draw,'500.0000');
});

test('keeps a zero-current-activity CWIP target with complete prior-period lineage in the finding',()=>{
  const historicalCwip={...cwip,activity_status:'ZERO_CURRENT_PERIOD_ACTIVITY',current_activity_line_count:0,period_debit:'0.0000',period_credit:'0.0000',opening_balance:'300.0000',closing_balance:'300.0000'};
  const core={...base(),counts:{...base().counts,current_activity_line_count:1,zero_activity_count:1},cwip_rows:[historicalCwip]};delete core.population_hash;
  const result=analyzeAttestedConstructionLoanDrawCwip(seal(core),{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy});
  assert.equal(result.finding_count,1);assert.equal(result.findings[0].period_cwip_net_additions,'0.0000');assert.deepEqual(result.findings[0].source_document_ids,[id(8),id(13)]);
});

test('rejects resealed zero-activity amounts and inconsistent MONEY4 rollforwards',()=>{
  const zeroCwip={...cwip,activity_status:'ZERO_CURRENT_PERIOD_ACTIVITY',current_activity_line_count:0,period_debit:'0.0000',period_credit:'0.0000',closing_balance:'0.0000',journal_entry_ids:[],journal_line_ids:[],ledger_line_ids:[],posting_batch_ids:[],source_document_ids:[]};
  const invalidRows=[
    {...zeroCwip,period_debit:'300.0000',closing_balance:'300.0000'},
    {...zeroCwip,period_debit:'300.0000',period_credit:'300.0000'},
    {...zeroCwip,opening_balance:'300.0000',closing_balance:'300.0000'},
    {...cwip,closing_balance:'299.9999'},
    {...cwip,period_debit:'-300.0000',closing_balance:'-300.0000'}
  ];
  for(const invalid of invalidRows){
    const core={...base(),cwip_rows:[invalid],counts:{...base().counts,current_activity_line_count:1+invalid.current_activity_line_count,zero_activity_count:invalid.current_activity_line_count===0?1:0}};delete core.population_hash;
    assert.throws(()=>validateConstructionLoanCwipPopulationAttestation(seal(core),{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID');
  }
});

test('counts ambiguous mappings separately from required mappings before refusing analysis',()=>{
  const unclassified={period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',account_code:'111000',account_name:'Ambiguous account',mapping_status:'BLOCKED_MAPPING_AMBIGUOUS',activity_status:'ZERO_CURRENT_PERIOD_ACTIVITY',current_activity_line_count:0,journal_entry_ids:[],journal_line_ids:[],ledger_line_ids:[],posting_batch_ids:[],source_document_ids:[],lineage_complete:true};
  const core={...base(),status:'INCOMPLETE',unclassified_rows:[unclassified],counts:{...base().counts,eligible_count:3,ambiguous_count:1,zero_activity_count:1,unclassified_count:1,population_count:3}};delete core.population_hash;
  const attestation=seal(core);
  assert.equal(validateConstructionLoanCwipPopulationAttestation(attestation,{tenantId:tenant,entityId:entity,accountingPeriodId:period}).counts.missing_count,0);
  assert.throws(()=>analyzeAttestedConstructionLoanDrawCwip(attestation,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy}),error=>error.code==='AI_LOAN_DRAW_CWIP_POPULATION_INCOMPLETE');
});

test('only an exact COMPLETE not-applicable attestation permits empty populations',()=>{
  const empty=seal({schema_version:'AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1',tenant_id:tenant,entity_id:entity,accounting_period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',status:'COMPLETE',applicable:false,counts:{eligible_count:0,mapped_count:0,missing_count:0,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:0,zero_activity_count:0,loan_row_count:0,cwip_row_count:0,non_target_count:0,unclassified_count:0,population_count:0},loan_rows:[],cwip_rows:[],non_target_rows:[],unclassified_rows:[],population_watermark:null});
  const result=analyzeAttestedConstructionLoanDrawCwip(empty,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy});
  assert.equal(result.finding_count,0);assert.equal(result.scanned_loan_account_count,0);assert.equal(result.scanned_cwip_account_count,0);
});

test('two explicit negative classifications exclude ordinary posted accounts without hiding them',()=>{
  const nonTarget={period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',account_code:'111000',account_name:'Cash',mapping_status:'EXPLICIT_NON_LOAN_CWIP_TARGET',activity_status:'CURRENT_PERIOD_ACTIVITY',current_activity_line_count:1,loan_classification:'NOT_CONSTRUCTION_LOAN',cwip_classification:'NOT_CWIP',loan_mapping_snapshot_id:id(30),loan_mapping_version:'1',loan_mapping_snapshot_hash:sha('1'),cwip_mapping_snapshot_id:id(31),cwip_mapping_version:'1',cwip_mapping_snapshot_hash:sha('2'),journal_entry_ids:[id(32)],journal_line_ids:[id(33)],ledger_line_ids:[id(34)],posting_batch_ids:[id(35)],source_document_ids:[id(36)],lineage_complete:true};
  const attestation=seal({schema_version:'AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1',tenant_id:tenant,entity_id:entity,accounting_period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',status:'COMPLETE',applicable:false,counts:{eligible_count:0,mapped_count:0,missing_count:0,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:0,zero_activity_count:0,loan_row_count:0,cwip_row_count:0,non_target_count:1,unclassified_count:0,population_count:1},loan_rows:[],cwip_rows:[],non_target_rows:[nonTarget],unclassified_rows:[],population_watermark:null});
  const result=analyzeAttestedConstructionLoanDrawCwip(attestation,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy});
  assert.equal(result.finding_count,0);
  const forged={...attestation,non_target_rows:[{...nonTarget,cwip_mapping_snapshot_id:null}]};delete forged.population_hash;
  forged.population_hash=constructionLoanCwipPopulationHash(forged);
  assert.throws(()=>validateConstructionLoanCwipPopulationAttestation(forged,{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID');
});

test('an unmapped posted-ledger account remains visible and cannot attest not applicable',()=>{
  const unclassified={period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',account_code:'111000',account_name:'Cash',mapping_status:'BLOCKED_MAPPING_REQUIRED',activity_status:'CURRENT_PERIOD_ACTIVITY',current_activity_line_count:1,journal_entry_ids:[id(20)],journal_line_ids:[id(21)],ledger_line_ids:[id(22)],posting_batch_ids:[id(24)],source_document_ids:[id(23)],lineage_complete:true};
  const incomplete=seal({schema_version:'AI_CONSTRUCTION_LOAN_CWIP_POPULATION_ATTESTATION_V1',tenant_id:tenant,entity_id:entity,accounting_period_id:period,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',status:'INCOMPLETE',applicable:true,counts:{eligible_count:1,mapped_count:0,missing_count:3,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:1,zero_activity_count:0,loan_row_count:0,cwip_row_count:0,non_target_count:0,unclassified_count:1,population_count:1},loan_rows:[],cwip_rows:[],non_target_rows:[],unclassified_rows:[unclassified],population_watermark:'2026-07-31T12:00:00.000Z'});
  assert.throws(()=>analyzeAttestedConstructionLoanDrawCwip(incomplete,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy}),error=>error.code==='AI_LOAN_DRAW_CWIP_POPULATION_INCOMPLETE');
});

test('fails closed for single-sided, ambiguous, missing-lineage, scope, count, status, and hash drift',()=>{
  const cases=[];
  const singleCore={...base(),status:'INCOMPLETE',counts:{eligible_count:1,mapped_count:1,missing_count:1,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:1,zero_activity_count:0,loan_row_count:1,cwip_row_count:0,non_target_count:0,unclassified_count:0,population_count:1},cwip_rows:[]};delete singleCore.population_hash;cases.push(seal(singleCore));
  for(const value of cases)assert.throws(()=>analyzeAttestedConstructionLoanDrawCwip(value,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy}),error=>error.code==='AI_LOAN_DRAW_CWIP_POPULATION_INCOMPLETE');
  const mutations=[
    value=>({...value,entity_id:id(99)}),
    value=>({...value,period_code:'2026-13'}),
    value=>({...value,period_start:'2026-02-30'}),
    value=>({...value,currency:'EUR'}),
    value=>({...value,loan_rows:[{...loan,period_code:'2026-06'}]}),
    value=>({...value,cwip_rows:[{...cwip,currency:'EUR'}]}),
    value=>({...value,counts:{...value.counts,population_count:3}}),
    value=>({...value,status:'INCOMPLETE'}),
    value=>({...value,population_watermark:null}),
    value=>({...value,population_hash:sha('f')}),
    value=>({...value,cwip_rows:[{...cwip,lineage_complete:false,source_document_ids:[]}],counts:{...value.counts,invalid_lineage_count:1},status:'INCOMPLETE'})
  ];
  for(const mutate of mutations)assert.throws(()=>validateConstructionLoanCwipPopulationAttestation(mutate(base()),{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID');
});

test('rejects more than 500 mapped rows and closes empty-population watermark semantics',()=>{
  const loans=Array.from({length:501},(_,index)=>({...loan,account_code:`L${String(index).padStart(4,'0')}`,mapping_snapshot_id:id(1000+index),journal_entry_ids:[id(2000+index)],journal_line_ids:[id(3000+index)],ledger_line_ids:[id(4000+index)],posting_batch_ids:[id(5000+index)],source_document_ids:[id(6000+index)]}));
  const oversizedCore={...base(),status:'INCOMPLETE',counts:{eligible_count:502,mapped_count:502,missing_count:0,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:502,zero_activity_count:0,loan_row_count:501,cwip_row_count:1,non_target_count:0,unclassified_count:0,population_count:502},loan_rows:loans};delete oversizedCore.population_hash;
  const oversized=seal(oversizedCore);
  assert.throws(()=>analyzeAttestedConstructionLoanDrawCwip(oversized,{tenantId:tenant,entityId:entity,accountingPeriodId:period,policy}),error=>error.code==='AI_LOAN_DRAW_CWIP_POPULATION_INCOMPLETE');
  const emptyCore={...base(),status:'COMPLETE',applicable:false,counts:{eligible_count:0,mapped_count:0,missing_count:0,ambiguous_count:0,invalid_lineage_count:0,current_activity_line_count:0,zero_activity_count:0,loan_row_count:0,cwip_row_count:0,non_target_count:0,unclassified_count:0,population_count:0},loan_rows:[],cwip_rows:[],non_target_rows:[],unclassified_rows:[],population_watermark:'2026-07-31T12:00:00.000Z'};delete emptyCore.population_hash;
  assert.throws(()=>validateConstructionLoanCwipPopulationAttestation(seal(emptyCore),{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID');
});

test('cannot relabel prior-period evidence or a nonempty population as not applicable',()=>{
  const quietLoan={...loan,period_draws:'0.0000',period_repayments:'0.0000'};
  const quietCwip={...cwip,period_debit:'0.0000',period_credit:'0.0000'};
  const forged={...base(),applicable:false,loan_rows:[quietLoan],cwip_rows:[quietCwip]};delete forged.population_hash;
  forged.population_hash=constructionLoanCwipPopulationHash(forged);
  assert.throws(()=>validateConstructionLoanCwipPopulationAttestation(forged,{tenantId:tenant,entityId:entity,accountingPeriodId:period}),error=>error.code==='AI_LOAN_DRAW_CWIP_ATTESTATION_INVALID');
});
