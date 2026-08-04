import assert from 'node:assert/strict';
import { localGLDrillState, localGLDrillAccountCodes, localGLRunningBalanceRows } from './src/gl-drill-state.js';

assert.deepEqual(localGLDrillState([], '482000 Interest income', '2026-01', '2026-07'), {count:0, isEmpty:true, emptyLabel:'No posted local activity for 482000 Interest income in 2026-01 to 2026-07.'});
assert.deepEqual(localGLDrillState([{je:'JE-1'}], '111000 Operating Cash'), {count:1, isEmpty:false, emptyLabel:'No posted local activity for 111000 Operating Cash.'});
assert.deepEqual(localGLDrillAccountCodes([{account_code:'111000'}, '120200', {account_code:'111000'}, {}]), ['111000','120200']);
assert.deepEqual(localGLRunningBalanceRows([{acct:'111000',date:'2026-07-02',je:'JE-2',dr:0,cr:30},{acct:'111000',date:'2026-07-01',je:'JE-1',dr:20,cr:0},{acct:'120200',date:'2026-07-01',je:'JE-3',dr:40,cr:0}], new Map([['111000',100]])).map(row=>[row.acct,row.je,row.runningBalance]), [['111000','JE-1',120],['111000','JE-2',90],['120200','JE-3',40]]);
console.log('GL drill state: scoped posted-activity empty state and running balance verified');
