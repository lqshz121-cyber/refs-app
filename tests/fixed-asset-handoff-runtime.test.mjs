import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {canResumeFixedAssetAcquisitionJournal,resolveFixedAssetAcquisitionJournalScope} from '../src/fixed-asset-acquisition-workflow.js';
const source=readFileSync(new URL('../src/authoritative-app.jsx',import.meta.url),'utf8'),start=source.indexOf('const openAssetJournalWorkflow=useCallback('),end=source.indexOf('const selectEntityScope=',start);assert.ok(start>0&&end>start);
const callback=source.slice(start,end),config={entityId:'company-a',periodId:'current-period'},target={entity_id:'company-a',period_id:'source-period'},receipt={journal_entry_id:'saved-journal',period_id:'source-period'};
function harness({status='DRAFT',catalog=[target],duringRead=()=>{},failed=false}={}){
 const reads=[],events=[],originRef={current:config};let current=true;
 const bindings={config,scopeCatalog:catalog,boundFetcher:()=>{},accountingReadGeneration:1,assetJournalOriginRef:originRef,useCallback:fn=>fn,canResumeFixedAssetAcquisitionJournal,resolveFixedAssetAcquisitionJournalScope,
  accountingReadGuard:{current:{begin:()=>()=>current}},readAuthoritativeJournalEntryDetail:async args=>{reads.push(args);await duringRead({invalidate:()=>{current=false;},changeCompany:()=>{originRef.current={entityId:'company-b',periodId:'other'};}});return failed?{ok:false,message:'Read failed'}:{ok:true,journal:{status}};},
  applyScope:scope=>events.push(['scope',scope]),setError:error=>events.push(['error',error]),setSharedAccountingLoaded:value=>events.push(['loaded',value]),setRoute:route=>events.push(['route',route]),setWorkflowJournalId:id=>events.push(['journal',id])};
 return {run:Function(...Object.keys(bindings),callback+';return openAssetJournalWorkflow;')(...Object.values(bindings)),reads,events};
}
test('actual asset handoff callback reads source period before changing complete workflow scope',async()=>{
 for(const status of ['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED']){const h=harness({status});await h.run(receipt);assert.equal(h.reads[0].config.periodId,'source-period');assert.equal(h.reads[0].config.entityId,'company-a');assert.deepEqual(h.events,[['scope',target],['loaded',false],['error',null],['route','journals'],['journal','saved-journal']]);}
 const saved=harness();await saved.run({journal_entry_id:'saved-journal'},'source-period');assert.equal(saved.reads[0].config.periodId,'source-period');
});
test('actual asset handoff ignores late results after company change or read invalidation',async()=>{
 for(const duringRead of [({invalidate})=>invalidate(),({changeCompany})=>changeCompany()]){const h=harness({duringRead});await h.run(receipt);assert.equal(h.reads.length,1);assert.deepEqual(h.events,[]);}
});
test('actual asset handoff never switches scope for missing scope, failed read or a Posted journal',async()=>{
 const foreign=harness({catalog:[{...target,entity_id:'company-b'}]});await foreign.run(receipt);assert.equal(foreign.reads.length,0);assert.equal(foreign.events[0][1].code,'ASSET_JOURNAL_SCOPE_UNCONFIRMED');
 for(const options of [{failed:true},{status:'POSTED'}]){const h=harness(options);await h.run(receipt);assert.ok(h.events.every(([kind])=>kind==='error'));assert.equal(h.events.length,1);}
});
