import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
const operations=Object.values(contract.paths).flatMap(path=>path.post?[path.post]:[]);

test('accounting OpenAPI is 3.1, authenticated and operation ids match the runtime kernel surface',()=>{
  assert.equal(contract.openapi,'3.1.0');assert.deepEqual(contract.security,[{bearerAuth:[]}]);
  assert.deepEqual(operations.map(operation=>operation.operationId).sort(),['applyApVendorCredit','applyArCreditMemo','createApBill','createApBillVoid','createApPayment','createApPaymentReversal','createApVendorCredit','createArCreditMemo','createArInvoice','createArReceipt','createArReceiptReversal','createArRefund','createAutoJournal','createBankPaymentMatch','createJournalAdjustment','createManualJournal','finalizeAttachment','postJournal','recordWbsSnapshot','reserveAttachment','setReconciliationClearance','startReconciliation','transitionJournal','transitionReconciliation','unmatchBankPayment']);
});

test('every accounting command requires idempotency and every mutable existing resource requires If-Match',()=>{
  for(const operation of operations)assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IdempotencyKey'));
  for(const operation of operations.filter(item=>['transitionJournal','postJournal','createApBillVoid','createBankPaymentMatch','unmatchBankPayment','setReconciliationClearance','transitionReconciliation'].includes(item.operationId)))assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));
  assert.equal(contract.components.parameters.IfMatch.schema.pattern,'^\\\"[0-9]+\\\"$');
});

test('identity and server-computed request hash are absent from all public request schemas',()=>{
  const serialized=JSON.stringify(contract.components.requestBodies);
  for(const forbidden of ['actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash'])assert.equal(serialized.includes(`\"${forbidden}\"`),false);
});

test('all responses are no-store and use a structured success or problem envelope',()=>{
  assert.equal(contract.components.responses.CommandCreated.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.CommandCreated.headers.ETag.schema.pattern,'^\\"[0-9]+\\"$');
  assert.equal(contract.components.responses.CommandReplay.headers.ETag.schema.pattern,'^\\"[0-9]+\\"$');
  assert.equal(contract.components.responses.Problem.headers['Cache-Control'].schema.const,'no-store');
  assert.deepEqual(contract.components.responses.Problem.headers['Retry-After'].schema,{type:'integer',minimum:0});
  assert.match(contract.components.responses.Problem.description,/412/);
  assert.match(contract.components.responses.Problem.description,/503/);
  for(const operation of operations){assert.ok(operation.responses['200']);assert.ok(operation.responses['201']);assert.ok(operation.responses['503']);assert.ok(operation.responses.default);}
  for(const operation of operations.filter(item=>['transitionJournal','postJournal','createApBillVoid','createBankPaymentMatch','unmatchBankPayment','setReconciliationClearance','transitionReconciliation'].includes(item.operationId)))assert.equal(operation.responses['412'].$ref,'#/components/responses/PreconditionFailed');
  assert.equal(contract.components.responses.SerializationRetryExhausted.headers['Retry-After'].schema.minimum,0);
});

test('attachment create and replay responses use the exact attachment envelope',()=>{
  for(const path of ['/entities/{entityId}/attachments/reservations','/entities/{entityId}/attachments/{attachmentId}/finalize']){
    const responses=contract.paths[path].post.responses;
    assert.equal(responses['200'].$ref,'#/components/responses/AttachmentReplay');assert.equal(responses['201'].$ref,'#/components/responses/AttachmentCreated');
  }
  const result=contract.components.schemas.AttachmentResult;assert.equal(result.additionalProperties,false);
  assert.deepEqual(result.required,['attachment_id','entity_id','status','idempotent']);
});

test('WBS snapshot observations are scoped idempotent evidence only and production signatures fail closed',()=>{
  const operation=contract.paths['/entities/{entityId}/wbs/snapshots'].post;
  assert.equal(operation.operationId,'recordWbsSnapshot');assert.equal(operation.requestBody.$ref,'#/components/requestBodies/WbsSnapshot');
  assert.equal(operation.responses['422'].$ref,'#/components/responses/Problem');assert.equal(operation.responses['503'].$ref,'#/components/responses/SerializationRetryExhausted');
  assert.match(operation.description,/never writes WBS, source documents, journal entries or ledger lines/i);assert.match(operation.description,/detached Ed25519 signature/i);
  const body=contract.components.requestBodies.WbsSnapshot.content['application/json'].schema;
  assert.equal(body.additionalProperties,false);assert.deepEqual(body.required,['snapshot']);
});

test('AP and AR aging are no-store authenticated GETs with a required as-of date',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/aging','getApAging'],['/entities/{entityId}/ar/aging','getArAging']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.parameters[1].name,'asOf');assert.equal(operation.parameters[1].required,true);
    assert.equal(operation.responses['200'].$ref,'#/components/responses/ReadOk');
  }
  assert.equal(contract.components.responses.ReadOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.ArAgingRow.additionalProperties,false);
});

test('AP and AR control totals are no-store authenticated GETs',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/control-totals','getApControlTotal'],['/entities/{entityId}/ar/control-totals','getArControlTotal']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.responses['200'].$ref,'#/components/responses/ControlTotalOk');
  }
  assert.equal(contract.components.responses.ControlTotalOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.ControlTotalRow.additionalProperties,false);
});

test('AP Bill and AR Invoice list reads are authenticated no-store operations',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/bills','listApBills'],['/entities/{entityId}/ar/invoices','listArInvoices']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.responses['200'].$ref,'#/components/responses/BusinessDocumentReadOk');
  }
  const row=contract.components.schemas.BusinessDocumentReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.required,['business_document_id','document_number','counterparty_ref','counterparty_name','currency','accounting_date','gross_amount','open_balance','status','version','offset_account_code','description','journal_entry_id','journal_status','journal_revision','period_id']);
});

test('Journal Entry list read is authenticated, scoped and no-store',()=>{
  const operation=contract.paths['/entities/{entityId}/journal-entries'].get;
  assert.equal(operation.operationId,'listJournalEntries');assert.equal(operation.responses['200'].$ref,'#/components/responses/JournalEntryReadOk');
  const row=contract.components.schemas.JournalEntryReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.required,['journal_entry_id','journal_number','journal_type','status','journal_date','currency','revision','created_at','ledger_line_count']);
  assert.equal(contract.components.responses.JournalEntryReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('Journal Entry line read is a scoped no-store GET that never reuses the numeric write Money type',()=>{
  const operation=contract.paths['/entities/{entityId}/journal-entries/{journalEntryId}/lines'].get;
  assert.equal(operation.operationId,'getJournalEntryLines');
  assert.equal(operation.parameters[1].$ref,'#/components/parameters/JournalEntryId');
  assert.equal(operation.responses['200'].$ref,'#/components/responses/JournalEntryLineReadOk');
  assert.equal(contract.components.responses.JournalEntryLineReadOk.headers['Cache-Control'].schema.const,'no-store');
  const row=contract.components.schemas.JournalEntryLineReadRow;
  assert.equal(row.additionalProperties,false);
  assert.equal(row.properties.debit_amount.type,'string');
  assert.equal(row.properties.credit_amount.type,'string');
  assert.equal(row.properties.dimensions.type,'object');
  assert.equal(contract.components.schemas.JournalEntryLineReadEnvelope.properties.data.items.$ref,'#/components/schemas/JournalEntryLineReadRow');
});

test('bank transaction and reconciliation reads are scoped no-store evidence only',()=>{
  const transactions=contract.paths['/entities/{entityId}/bank/transactions'].get;
  assert.equal(transactions.operationId,'listBankTransactions');
  assert.equal(transactions.responses['200'].$ref,'#/components/responses/BankTransactionReadOk');
  assert.deepEqual(transactions.parameters.slice(1).map(parameter=>parameter.name),['bankAccountRef','from','through','limit']);
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='bankAccountRef').required,true);
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='bankAccountRef').schema.pattern,'^(?:\\S|\\S.*\\S)$');
  assert.equal(transactions.parameters.find(parameter=>parameter.name==='limit').schema.maximum,200);
  assert.match(transactions.description,/cannot match, clear, sign off, or post/i);
  const reconciliation=contract.paths['/entities/{entityId}/bank/reconciliation'].get;
  assert.equal(reconciliation.operationId,'getReconciliationSummary');
  assert.equal(reconciliation.responses['200'].$ref,'#/components/responses/ReconciliationSummaryOk');
  assert.equal(reconciliation.parameters.find(parameter=>parameter.name==='statementEndingDate').required,true);
  assert.equal(reconciliation.parameters.find(parameter=>parameter.name==='bankAccountRef').schema.pattern,'^(?:\\S|\\S.*\\S)$');
  assert.match(reconciliation.description,/cannot match, clear, reopen, sign off, or post/i);
  assert.match(reconciliation.description,/DRAFT, IN_REVIEW, or REOPENED/);assert.match(reconciliation.description,/prior RECONCILED/);assert.match(reconciliation.description,/not dynamically recomputed or returned/);
  assert.equal(contract.components.responses.BankTransactionReadOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.ReconciliationSummaryOk.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.schemas.BankTransactionReadRow.additionalProperties,false);
  assert.equal(contract.components.schemas.ReconciliationSummaryRow.additionalProperties,false);
});

test('financial statements are an authenticated period-scoped POSTED evidence read',()=>{
  const operation=contract.paths['/entities/{entityId}/reports/financial-statements'].get;
  assert.equal(operation.operationId,'getFinancialStatements');
  assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId').required,true);
  assert.equal(operation.responses['200'].$ref,'#/components/responses/FinancialStatementReadOk');
  assert.match(operation.description,/cannot create, adjust, post, export, or persist/i);
  const row=contract.components.schemas.FinancialStatementReadRow;
  assert.equal(row.additionalProperties,false);
  assert.deepEqual(row.properties.statement_type.enum,['TRIAL_BALANCE','BALANCE_SHEET','INCOME_STATEMENT','CASH_FLOW']);
  assert.equal(row.properties.classification_basis.const,'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER');
  for(const key of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.equal(row.properties[key].items.$ref,'#/components/schemas/Uuid');
  assert.equal(contract.components.responses.FinancialStatementReadOk.headers['Cache-Control'].schema.const,'no-store');
});

test('AP and AR adjustment list reads expose only the authoritative scoped adjustment envelope',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/adjustments','listApAdjustments'],['/entities/{entityId}/ar/adjustments','listArAdjustments']]){
    const operation=contract.paths[path].get;
    assert.equal(operation.operationId,operationId);assert.equal(operation.responses['200'].$ref,'#/components/responses/BusinessAdjustmentReadOk');
  }
  const row=contract.components.schemas.BusinessAdjustmentReadRow;
  assert.equal(row.additionalProperties,false);assert.deepEqual(row.required,['business_adjustment_id','adjustment_kind','amount','currency','accounting_date','period_id','reason','status','version','created_at']);
});

test('AP Bill and AR Invoice create commands are Draft-only and require a canonical business document body',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/bills','createApBill'],['/entities/{entityId}/ar/invoices','createArInvoice']]){
    const operation=contract.paths[path].post;
    assert.equal(operation.operationId,operationId);assert.equal(operation.requestBody.$ref,'#/components/requestBodies/BusinessDocument');
    assert.equal(operation.responses['201'].$ref,'#/components/responses/CommandCreated');
  }
  const schema=contract.components.requestBodies.BusinessDocument.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['periodId','documentNumber','counterpartyRef','counterpartyName','currency','accountingDate','amount','offsetAccountCode','attachmentIds']);
});
