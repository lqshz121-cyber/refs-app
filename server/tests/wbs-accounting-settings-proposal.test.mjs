import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {buildWbsAccountingSettingsProposal,normalizeWbsAccountingSettingEvidence} from '../runtime/wbs-accounting-settings-proposal.mjs';

const base={id:90782,company_code:'WBFL',type:'Debit',category:'Payable',business_type:4,detail:'0LD067',pj_code:null,journal_code:'164100',account:'CWIP - Land',supplementary:'Project',start_date:'2026-01-01T00:00:00',end_date:'2026-12-31T00:00:00'};

test('normalizes one exact WBS setting into immutable, source-hash-bound evidence',()=>{
  const row=normalizeWbsAccountingSettingEvidence(base);
  assert.equal(row.wbs_setting_id,'90782');assert.equal(row.account_code,'164100');assert.equal(row.supplementary,'Project');assert.match(row.source_setting_hash,/^sha256:[0-9a-f]{64}$/);assert.ok(Object.isFrozen(row));
});

test('builds exact-account WBFL Settings proposal without granting workflow authority',()=>{
  const proposal=buildWbsAccountingSettingsProposal({rows:[base,{...base,id:104353,detail:'3GN831',journal_code:'164200',account:'CWIP - Building'}],companyCode:'WBFL',periodStart:'2026-01-01',periodEnd:'2026-06-30'});
  assert.equal(proposal.status,'READY_FOR_HUMAN_REVIEW');assert.equal(proposal.rule_count,2);assert.deepEqual(proposal.rules.map(row=>row.account_code),['164100','164200']);assert.ok(proposal.rules.every(row=>row.selection_mode==='COST_CODE'&&row.decision==='MAPPED'));assert.deepEqual(proposal.action_flags,{can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false});assert.match(proposal.proposal_hash,/^sha256:[0-9a-f]{64}$/);
});

test('a blank WBS default remains an explicit blocked rule while exact Payable cost codes can be reviewed',()=>{
  const proposal=buildWbsAccountingSettingsProposal({rows:[{...base,id:1,detail:'',journal_code:null,account:null},base],companyCode:'WBFL',periodStart:'2026-01-01',periodEnd:'2026-06-30',categories:['Payable']});
  assert.equal(proposal.status,'READY_FOR_HUMAN_REVIEW');assert.deepEqual(proposal.included_categories,['Payable']);assert.equal(proposal.rules.find(row=>row.wbs_setting_id==='1').selection_mode,'BLOCKED_DEFAULT');assert.equal(proposal.rules.find(row=>row.wbs_setting_id==='1').decision,'BLOCKED');assert.equal(proposal.exceptions.length,0);
});

test('missing and conflicting WBS account mappings remain auditable exceptions with zero authority',()=>{
  const proposal=buildWbsAccountingSettingsProposal({rows:[{...base,id:1,journal_code:null,account:null},{...base,id:2,journal_code:'164100'},{...base,id:3,journal_code:'164200'}],companyCode:'WBFL',periodStart:'2026-01-01',periodEnd:'2026-06-30'});
  assert.equal(proposal.status,'EXCEPTION');assert.ok(proposal.exceptions.some(row=>row.code==='WBS_SETTING_ACCOUNT_UNMAPPED'));assert.ok(proposal.exceptions.some(row=>row.code==='WBS_SETTING_EFFECTIVE_MAPPING_AMBIGUOUS'));assert.equal(proposal.action_flags.can_create_draft,false);assert.equal(proposal.action_flags.can_post,false);
});

test('rejects mixed company, malformed account, invalid calendar date, and out-of-scope input',()=>{
  for(const rows of [[{...base,company_code:'OTHER'}],[{...base,journal_code:'bad account'}],[{...base,start_date:'2026-02-30'}]])assert.throws(()=>buildWbsAccountingSettingsProposal({rows,companyCode:'WBFL',periodStart:'2026-01-01',periodEnd:'2026-06-30'}),/invalid|mixes companies/i);
});

test('cost-GL account choices are source-account confirmations, not falsely collapsed into one selector',()=>{
  const rows=['164100','164200','164300'].map((account,index)=>({...base,id:10+index,category:'Cost General Ledger',type:'Direct(Debit)',detail:'',journal_code:account,account:`CWIP ${account}`}));
  const proposal=buildWbsAccountingSettingsProposal({rows,companyCode:'WBFL',periodStart:'2026-01-01',periodEnd:'2026-06-30'});
  assert.equal(proposal.status,'READY_FOR_HUMAN_REVIEW');assert.equal(proposal.exceptions.length,0);assert.ok(proposal.rules.every(row=>row.selection_mode==='SOURCE_ACCOUNT_CONFIRMATION'));
});

test('frozen WBFL H1 Payable proposal is canonical, exact-account, blocked-by-default and action-free',async()=>{
  const proposal=JSON.parse(await readFile(new URL('../../outputs/WBFL-2026-H1-WBS-PAYABLE-SETTINGS-PROPOSAL.json',import.meta.url),'utf8')),hash=proposal.proposal_hash,{proposal_hash,...core}=proposal;
  assert.equal(hash,canonicalRequestHash(core));assert.equal(proposal.status,'READY_FOR_HUMAN_REVIEW');assert.equal(proposal.exceptions.length,0);assert.deepEqual(proposal.rules.filter(row=>row.selection_mode==='COST_CODE').map(row=>[row.detail,row.account_code,row.supplementary]),[['0LD067','164100','Project'],['3GN831','164200','Project']]);assert.equal(proposal.rules.find(row=>row.selection_mode==='BLOCKED_DEFAULT').decision,'BLOCKED');assert.ok(Object.values(proposal.action_flags).every(value=>value===false));
});
