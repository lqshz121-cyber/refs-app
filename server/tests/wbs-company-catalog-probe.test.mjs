import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {assertArtifactHasNoNamesOrSecrets,classifyCompanyName,deidentifyCompanyRow,diffAgainstPlaceholders,probeWbsCompanyCatalog} from '../tools/wbs-company-catalog-probe.mjs';

const fakeClient=pages=>{const calls=[];return {calls,initialize:async()=>{calls.push('initialize');},listTools:async()=>{calls.push('listTools');},readView:async({toolName,args})=>{calls.push({toolName,args});const index=args.cursor?Number(args.cursor.replace('c',''))+1:0;return pages[index];}};};

test('classifies provider names without fabricating labels',()=>{
  assert.equal(classifyCompanyName('Wan Pacific LLC').status,'NAME_OK');
  assert.equal(classifyCompanyName('').status,'NAME_MISSING');
  assert.equal(classifyCompanyName(undefined).status,'NAME_MISSING');
  assert.equal(classifyCompanyName('Ïã¸Ûº£ÐÅ').status,'NAME_ENCODING_SUSPECT');
  assert.equal(classifyCompanyName('Some � Co').status,'NAME_ENCODING_SUSPECT');
  assert.equal(classifyCompanyName('WBS WYHX').status,'NAME_IS_PLACEHOLDER');
  assert.equal(classifyCompanyName('ab').status,'NAME_CONTROL_CHARS');
  assert.equal(classifyCompanyName('x'.repeat(201)).status,'NAME_TOO_LONG');
});

test('de-identified rows carry only code, hash, length, status and page position',()=>{
  const result=deidentifyCompanyRow({company_code:' wbpa ',company_name:'Wan Pacific LLC (Consolidated)',pb_guid:'pb-1',pay_amount:'1'},{page:1,ordinal:0});
  assert.equal(result.ok,true);
  assert.equal(result.company.company_code,'WBPA');
  assert.equal(result.company.consolidation_node,true);
  assert.match(result.company.name_sha256,/^sha256:[0-9a-f]{64}$/);
  assert.equal(result.company.name_length,'Wan Pacific LLC (Consolidated)'.length);
  assert.equal(JSON.stringify(result.company).includes('Wan Pacific'),false);
  assert.equal(JSON.stringify(result.company).includes('pb-1'),false);
  assert.deepEqual(deidentifyCompanyRow({company_code:'bad code',company_name:'x'},{page:1,ordinal:2}).anomaly.code,'COMPANY_CODE_INVALID');
  assert.deepEqual(deidentifyCompanyRow({company_code:'OK',company_name:'x',authorization:'Bearer t'},{page:1,ordinal:3}).anomaly.code,'ROW_CREDENTIAL_LIKE_KEY');
});

test('probe walks bounded cursors, never writes, and emits control totals + anomalies',async()=>{
  const pages=[
    {record_count:3,content_sha256:'a'.repeat(64),rows:[{company_code:'WBPA',company_name:'Wan Pacific',pb_guid:'p1'},{company_code:'WBSM',company_name:'San Marcos',pb_guid:'p2'},{company_code:'WBPA',company_name:'Wan Pacific',pb_guid:'p3'}],cursor_next:'c0'},
    {record_count:2,content_sha256:'b'.repeat(64),rows:[{company_code:'WYHX',company_name:'Ïã¸Ûº£ÐÅ',pb_guid:'p4'},{company_code:'WBNN',company_name:'',pb_guid:'p5'}],cursor_next:null}
  ];
  const client=fakeClient(pages);
  const probe=await probeWbsCompanyCatalog({client,now:()=>new Date('2026-09-17T09:30:00Z')});
  assert.equal(client.calls[0],'initialize');assert.equal(client.calls[1],'listTools');
  assert.equal(client.calls.filter(call=>typeof call==='object').every(call=>call.toolName==='list_autorec_banks'&&call.args.limit===10),true);
  assert.equal(probe.read_only,true);assert.equal(probe.database_written,false);assert.equal(probe.wbs_written,false);
  assert.deepEqual(probe.control,{pages:2,provider_rows:5,unique_company_count:4,emitted_company_count:4,duplicate_company_rows:1,consolidation_node_count:0,name_status_counts:{NAME_OK:2,NAME_ENCODING_SUSPECT:1,NAME_MISSING:1},anomaly_count:0});
  assert.deepEqual(probe.companies.map(row=>row.company_code),['WBNN','WBPA','WBSM','WYHX']);
  assert.equal(probe.companies.find(row=>row.company_code==='WBNN').name_sha256,null);
  assert.match(probe.artifact_hash,/^sha256:[0-9a-f]{64}$/);
  assert.equal(assertArtifactHasNoNamesOrSecrets(probe),true);
  assert.equal(JSON.stringify(probe).includes('Wan Pacific'),false);
  assert.equal(JSON.stringify(probe).includes('San Marcos'),false);
  // same content, different clock → same artifact hash
  const again=await probeWbsCompanyCatalog({client:fakeClient(pages),now:()=>new Date('2026-09-18T00:00:00Z')});
  assert.equal(again.artifact_hash,probe.artifact_hash);
});

test('probe flags a name conflict for a repeated code and refuses cursor loops',async()=>{
  const conflict=await probeWbsCompanyCatalog({client:fakeClient([{record_count:2,rows:[{company_code:'WBPA',company_name:'One'},{company_code:'WBPA',company_name:'Two'}],cursor_next:null}])});
  assert.deepEqual(conflict.anomalies.map(item=>item.code),['COMPANY_NAME_CONFLICT']);
  const loopClient={initialize:async()=>{},listTools:async()=>{},readView:async()=>({record_count:1,rows:[{company_code:'WBPA',company_name:'One'}],cursor_next:'loop'})};
  await assert.rejects(probeWbsCompanyCatalog({client:loopClient}),/cursor is invalid/);
  await assert.rejects(probeWbsCompanyCatalog({client:fakeClient([{record_count:0,rows:[],cursor_next:null}])}),/catalog is empty/);
  const filtered=await probeWbsCompanyCatalog({client:fakeClient([{record_count:1,rows:[{company_code:'WBPA',company_name:'One'}],cursor_next:null}]),companyFilter:'WBSM'});
  assert.equal(filtered.control.emitted_company_count,0);
  assert.deepEqual(filtered.anomalies.map(item=>item.code),['COMPANY_FILTER_NOT_FOUND']);
});

test('placeholder diff separates resolvable, unresolved and missing codes',async()=>{
  const probe=await probeWbsCompanyCatalog({client:fakeClient([{record_count:2,rows:[{company_code:'WBPA',company_name:'Wan Pacific'},{company_code:'WYHX',company_name:'Ïã¸Ûº£ÐÅ'}],cursor_next:null}])});
  const diff=diffAgainstPlaceholders(probe,['WBPA','WYHX','ZZZZ','WBPA']);
  assert.equal(diff.placeholder_count,3);
  assert.deepEqual(diff.resolvable.map(row=>row.company_code),['WBPA']);
  assert.deepEqual(diff.unresolved.map(row=>[row.company_code,row.name_status]),[['WYHX','NAME_ENCODING_SUSPECT']]);
  assert.deepEqual(diff.missing_in_provider,['ZZZZ']);
});

test('tool source never imports a database pool or issues SQL',()=>{
  const source=readFileSync(fileURLToPath(new URL('../tools/wbs-company-catalog-probe.mjs',import.meta.url)),'utf8');
  assert.doesNotMatch(source,/createPool|MIGRATION_DATABASE_URL|DATABASE_URL|\bUPDATE\b|\bINSERT\b|pg\b/);
  assert.doesNotMatch(source,/process\.stdout\.write\([^)]*WBS_CF_ACCESS/);
});
