import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const fixtureUrl=new URL('./helpers/approved-ai-settings-fixture.mjs',import.meta.url).href;
const hashUrl=new URL('../runtime/request-hash.mjs',import.meta.url).href;
const periods=[
  {period_code:'2026-01',starts_on:'2026-01-01',ends_on:'2026-01-31'},
  {period_code:'2024-02',starts_on:'2024-02-01',ends_on:'2024-02-29'},
  {period_code:'2026-03',starts_on:'2026-03-01',ends_on:'2026-03-31'},
  {period_code:'2026-06',starts_on:'2026-06-01',ends_on:'2026-06-30'},
  {period_code:'2026-11',starts_on:'2026-11-01',ends_on:'2026-11-30'}
];

// Each child owns its TZ, so this test never changes the test runner's timezone.
// The fake pool models pg's local-midnight DATE decoding unless SQL casts to text.
// Hashes are deterministic stand-ins for refs_jsonb_hash, not a PostgreSQL test.
const probe=`
  import {installApprovedAiSettingsFixture} from ${JSON.stringify(fixtureUrl)};
  import {canonicalRequestHash} from ${JSON.stringify(hashUrl)};
  const periods=${JSON.stringify(periods)},results=[];
  const ids={tenantId:'11111111-1111-4111-8111-111111111111',entityId:'22222222-2222-4222-8222-222222222222',periodId:'33333333-3333-4333-8333-333333333333'};
  const localDate=value=>{const [year,month,day]=value.split('-').map(Number);return new Date(year,month-1,day);};
  for(const period of periods){
    const inserts=[];
    const pool={query:async(sql,params)=>{
      if(sql.startsWith('SELECT period_code')){
        return {rows:[{period_code:period.period_code,
          starts_on:sql.includes('starts_on::text AS starts_on')?period.starts_on:localDate(period.starts_on),
          ends_on:sql.includes('ends_on::text AS ends_on')?period.ends_on:localDate(period.ends_on)}]};
      }
      if(sql.startsWith('SELECT refs_jsonb_hash'))return {rows:[{value:canonicalRequestHash(JSON.parse(params[0]))}]};
      if(sql.startsWith('INSERT INTO account_master'))return {rows:[]};
      if(sql.startsWith('INSERT INTO setting_snapshot')){
        const parent=sql.includes("'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1'");
        inserts.push({id:params[0],family:parent?'AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1':params[3],version:params[parent?3:4],
          effective_from:params[parent?4:5],effective_to_bound:params[parent?5:6],
          snapshot:JSON.parse(params[parent?6:7]),hash:params[parent?7:8]});
        return {rows:[]};
      }
      throw new Error('Unexpected fixture query: '+sql);
    }};
    const result=await installApprovedAiSettingsFixture({pool,ids,companyCode:'WBPA'});
    results.push({period,inserts,result});
  }
  console.log(JSON.stringify(results));
`;

for(const timezone of ['Asia/Shanghai','UTC','America/Chicago']){
  test(`approved AI settings fixture preserves SQL dates and bound hashes in ${timezone}`,()=>{
    const child=spawnSync(process.execPath,['--input-type=module','-e',probe],{
      env:{...process.env,TZ:timezone},encoding:'utf8',timeout:30000,maxBuffer:1024*1024,windowsHide:true
    });
    assert.ifError(child.error);assert.equal(child.status,0,child.stderr);
    const results=JSON.parse(child.stdout);assert.equal(results.length,periods.length);
    for(const [index,{period,inserts,result}] of results.entries()){
      assert.deepEqual(period,periods[index]);assert.equal(inserts.length,11);
      for(const entry of inserts){
        assert.equal(entry.effective_from,period.starts_on,`${entry.family} effective_from`);
        assert.equal(entry.effective_to_bound,period.ends_on,`${entry.family} SQL end-date + 1 bound`);
        assert.equal(entry.hash,canonicalRequestHash(entry.snapshot),`${entry.family} snapshot/hash binding`);
      }
      const parent=inserts.find(entry=>entry.family==='AI_ACCOUNTING_ENTITY_PERIOD_SETTINGS_V1');
      assert.equal(parent.snapshot.period_start,period.starts_on);assert.equal(parent.snapshot.period_end,period.ends_on);
      assert.equal(parent.snapshot.period_code,period.period_code);
      assert.equal(result.settingsSnapshotId,parent.id);assert.equal(result.settingsSnapshotHash,parent.hash);
      for(const reference of Object.values(parent.snapshot).filter(value=>value&&typeof value==='object')){
        const childSnapshot=inserts.find(entry=>entry.id===reference.setting_snapshot_id);
        assert.ok(childSnapshot);assert.equal(reference.snapshot_hash,childSnapshot.hash);assert.equal(reference.version,childSnapshot.version);
      }
      const close=inserts.find(entry=>entry.family==='AI_ACCOUNTING_PERIOD_CLOSE_POLICY_V1').snapshot.settings;
      assert.equal(close.period_start,period.starts_on);
      for(const key of ['period_end','cutoff_date','accrual_cutoff_date','prepaid_boundary_date'])assert.equal(close[key],period.ends_on,key);
      const tax=inserts.find(entry=>entry.family==='AI_ACCOUNTING_TAX_V1').snapshot.settings;
      assert.equal(tax.coverage_start,period.starts_on);assert.equal(tax.coverage_end,period.ends_on);
    }
  });
}
