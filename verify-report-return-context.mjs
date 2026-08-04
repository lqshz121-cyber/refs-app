import assert from 'node:assert/strict';
import { localReportReturnContext, localReportReturnScopeLabel } from './src/report-return-context.js';

const context = localReportReturnContext({tab:'GL Detail',fromP:'2026-07',toP:'2026-07',entityId:15,propertyId:11,projectId:21,loanId:'ALL',cashScope:'Operating',drillAccounts:['120200'],drillLabel:'AR control'});
assert.equal(context.state,'LOCAL_REPORT_RETURN_READY');
assert.deepEqual(context.drillAccounts,['120200']);
assert.equal(context.propertyId,'11');
assert.equal(context.projectId,'21');
assert.equal(context.entityId,'15');
assert.equal(context.cashScope,'Operating');
assert.equal(context.asOf,undefined, 'as-of is carried only when the caller explicitly requests an as-of report');
assert.equal(localReportReturnContext({tab:'Trial Balance',fromP:'2026-01',toP:'2026-07',asOf:true}).asOf,true);
assert.match(localReportReturnScopeLabel(context), /entity 15 .*11 \/ 21 \/ ALL.*cash Operating.*2026-07 ~ 2026-07/);
assert.equal(localReportReturnContext({fromP:'2026-08',toP:'2026-07'}).state,'LOCAL_REPORT_RETURN_SCOPE_MISSING');
console.log('report return context: local GL/TB scope survives a retained JE review');
