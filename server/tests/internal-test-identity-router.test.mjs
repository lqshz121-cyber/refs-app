import test from 'node:test';import assert from 'node:assert/strict';
import {internalTestWorkflowActors,routeInternalTestPrincipal,InternalTestIdentityRouteError} from '../runtime/internal-test-identity-router.mjs';
const roles=['READER','MAKER','EXPENSE_MAKER','PAYMENT_MAKER','RECEIPT_MAKER','SALES_RECEIPT_MAKER','REVERSAL_MAKER','ADJUSTMENT_MAKER','REFUND_MAKER','ALLOCATOR','SUBMITTER','REVIEWER','APPROVER','POSTER','RECONCILIATION_STARTER','CLEARER','UNMATCHER','REOPENER','PERIOD_CLOSER','PERIOD_REOPENER','CASH_TRANSFER_RECONCILER','RECURRING_RUNNER'];
const env=Object.fromEntries(roles.map((role,index)=>[`REFS_INTERNAL_TEST_${role}_ACTOR_ID`,`${role.toLowerCase()}-actor-${index}`]));
const actors=internalTestWorkflowActors(env),principal={trusted:true,internalTest:true,tenantId:'11111111-1111-4111-8111-111111111111',actorId:'entry'};
const entity='22222222-2222-4222-8222-222222222222',id='33333333-3333-4333-8333-433333333333';
const route=(method,path,body)=>routeInternalTestPrincipal({method,url:`https://internal.example${path}`,body,principal,actors});
test('internal full-test router retains distinct finite identities by workflow stage',()=>{
  assert.equal(route('GET',`/api/v1/entities/${entity}/journal-entries`).actorId,actors.reader);
  assert.equal(route('GET',`/api/v1/entities/${entity}/ap/expenses/options?periodId=${id}`).actorId,actors.expenseMaker);
  assert.equal(route('GET',`/api/v1/entities/${entity}/ap/expenses`).actorId,actors.reader);
  const routes=[
    [`/api/v1/entities/${entity}/ap/bills`,'maker'],[`/api/v1/entities/${entity}/ar/invoices`,'maker'],[`/api/v1/entities/${entity}/ap/bills/${id}/native-payments`,'paymentMaker'],[`/api/v1/entities/${entity}/ar/invoices/${id}/native-receipts`,'receiptMaker'],[`/api/v1/entities/${entity}/ap/expenses`,'expenseMaker'],[`/api/v1/entities/${entity}/ar/sales-receipts`,'salesReceiptMaker'],[`/api/v1/entities/${entity}/ap/vendor-credits`,'adjustmentMaker'],[`/api/v1/entities/${entity}/ar/credit-memos`,'adjustmentMaker'],[`/api/v1/entities/${entity}/ar/credit-memos/${id}/native-refunds`,'refundMaker'],[`/api/v1/entities/${entity}/ap/vendor-credits/${id}/allocations`,'allocator'],[`/api/v1/entities/${entity}/ar/credit-memos/${id}/allocations`,'allocator'],[`/api/v1/entities/${entity}/periods/${id}/close`,'periodCloser'],[`/api/v1/entities/${entity}/periods/${id}/reopen`,'periodReopener'],[`/api/v1/entities/${entity}/cash-transfers/${id}/bank-links`,'cashTransferReconciler'],[`/api/v1/entities/${entity}/bank/reconciliations`,'reconciliationStarter'],[`/api/v1/entities/${entity}/bank/reconciliations/${id}/transitions/sign_off`,'approver'],[`/api/v1/entities/${entity}/bank/transactions/${id}/matches/${id}/unmatch`,'unmatcher'],[`/api/v1/entities/${entity}/forecasts`,'maker'],[`/api/v1/entities/${entity}/recurring-schedules`,'maker'],[`/api/v1/entities/${entity}/recurring-schedules/run-due`,'recurringRunner'],[`/api/v1/entities/${entity}/report-saved-views`,'maker'],[`/api/v1/entities/${entity}/journal-entries/${id}/transitions/submit`,'submitter'],[`/api/v1/entities/${entity}/journal-entries/${id}/transitions/review`,'reviewer'],[`/api/v1/entities/${entity}/journal-entries/${id}/transitions/approve`,'approver'],[`/api/v1/entities/${entity}/journal-entries/${id}/post`,'poster']
  ];
  for(const [path,role] of routes)assert.equal(route('POST',path).actorId,actors[role],path);
  assert.equal(route('POST',`/api/v1/entities/${entity}/forecasts/${id}/transitions`,{action:'SUBMIT'}).actorId,actors.submitter);
  assert.equal(route('POST',`/api/v1/entities/${entity}/forecasts/${id}/transitions`,{action:'APPROVE'}).actorId,actors.approver);
  assert.equal(route('POST',`/api/v1/entities/${entity}/recurring-schedules/${id}/transitions`,{action:'PAUSE'}).actorId,actors.reviewer);
  assert.equal(new Set(Object.values(actors)).size,Object.keys(actors).length);
});
test('internal full-test router rejects unadmitted writes and invalid actor configuration',()=>{
  assert.throws(()=>route('POST',`/api/v1/entities/${entity}/unknown`),error=>error instanceof InternalTestIdentityRouteError&&error.code==='INTERNAL_TEST_COMMAND_NOT_ADMITTED');
  assert.throws(()=>internalTestWorkflowActors({...env,REFS_INTERNAL_TEST_POSTER_ACTOR_ID:env.REFS_INTERNAL_TEST_APPROVER_ACTOR_ID}),error=>error instanceof InternalTestIdentityRouteError&&error.code==='INTERNAL_TEST_ACTOR_CONFIG_INVALID');
});
