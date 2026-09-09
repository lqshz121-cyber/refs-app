import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const methods=['getAiPrepaidBalanceReconciliationSource','getAiFixedAssetDepreciationGapSource','getAiFixedAssetDepreciationSource','getAiFixedAssetPostedReconciliation','getAiFixedAssetDisposalGapSource','getAiFixedAssetPostDisposalDepreciation','getAiFixedAssetImpairmentAssessments','getAiFixedAssetImpairmentPostedReconciliation'];
for(const method of methods)test(method+' decodes PostgreSQL JSON values without changing money, ordering or evidence',async()=>{
 const kernel=Object.create(PostgresAccountingKernel.prototype),evidence=[{asset_tag:'second',amount:'1000000000000000.0001',source_payload_hash:'sha256:'+'a'.repeat(64),nested:{line_ids:['2','1']}},{asset_tag:'first',amount:'0.0000'}];
 let calls=0;
 kernel.inSession=async run=>run({query:async(sql,args)=>{calls++;assert.match(sql,/^SELECT refs_read_ai_\w+\(\$1,\$2,\$3\) AS data$/);assert.deepEqual(args,['tenant','entity','period']);return {rows:evidence.map(data=>({data}))};}});
 assert.deepEqual(await kernel[method]({tenantId:'tenant',entityId:'entity',accountingPeriodId:'period'}),evidence);assert.equal(calls,1);
 kernel.inSession=async run=>run({query:async()=>({rows:[]})});assert.deepEqual(await kernel[method]({tenantId:'tenant',entityId:'entity',accountingPeriodId:'period'}),[]);
});
