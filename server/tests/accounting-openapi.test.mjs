import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
const operations=Object.values(contract.paths).flatMap(path=>path.post?[path.post]:[]);

test('accounting OpenAPI is 3.1, authenticated and operation ids match the runtime kernel surface',()=>{
  assert.equal(contract.openapi,'3.1.0');assert.deepEqual(contract.security,[{bearerAuth:[]}]);
  assert.deepEqual(operations.map(operation=>operation.operationId).sort(),['applyApVendorCredit','applyArCreditMemo','createApBill','createApBillVoid','createApPayment','createApPaymentReversal','createApVendorCredit','createArCreditMemo','createArInvoice','createArReceipt','createArReceiptReversal','createArRefund','createAutoJournal','createJournalAdjustment','createManualJournal','finalizeAttachment','postJournal','reserveAttachment','transitionJournal']);
});

test('every accounting command requires idempotency and every mutable existing resource requires If-Match',()=>{
  for(const operation of operations)assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IdempotencyKey'));
  for(const operation of operations.filter(item=>['transitionJournal','postJournal','createApBillVoid'].includes(item.operationId)))assert.ok(operation.parameters.some(parameter=>parameter.$ref==='#/components/parameters/IfMatch'));
  assert.equal(contract.components.parameters.IfMatch.schema.pattern,'^\\\"?[0-9]+\\\"?$');
});

test('identity and server-computed request hash are absent from all public request schemas',()=>{
  const serialized=JSON.stringify(contract.components.requestBodies);
  for(const forbidden of ['actorId','actor_id','tenantId','tenant_id','entityId','entity_id','requestHash','request_hash'])assert.equal(serialized.includes(`\"${forbidden}\"`),false);
});

test('all responses are no-store and use a structured success or problem envelope',()=>{
  assert.equal(contract.components.responses.CommandCreated.headers['Cache-Control'].schema.const,'no-store');
  assert.equal(contract.components.responses.Problem.headers['Cache-Control'].schema.const,'no-store');
  for(const operation of operations){assert.ok(operation.responses['200']);assert.ok(operation.responses['201']);assert.ok(operation.responses.default);}
});

test('attachment create and replay responses use the exact attachment envelope',()=>{
  for(const path of ['/entities/{entityId}/attachments/reservations','/entities/{entityId}/attachments/{attachmentId}/finalize']){
    const responses=contract.paths[path].post.responses;
    assert.equal(responses['200'].$ref,'#/components/responses/AttachmentReplay');assert.equal(responses['201'].$ref,'#/components/responses/AttachmentCreated');
  }
  const result=contract.components.schemas.AttachmentResult;assert.equal(result.additionalProperties,false);
  assert.deepEqual(result.required,['attachment_id','entity_id','status','idempotent']);
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

test('AP Bill and AR Invoice create commands are Draft-only and require a canonical business document body',()=>{
  for(const [path,operationId] of [['/entities/{entityId}/ap/bills','createApBill'],['/entities/{entityId}/ar/invoices','createArInvoice']]){
    const operation=contract.paths[path].post;
    assert.equal(operation.operationId,operationId);assert.equal(operation.requestBody.$ref,'#/components/requestBodies/BusinessDocument');
    assert.equal(operation.responses['201'].$ref,'#/components/responses/CommandCreated');
  }
  const schema=contract.components.requestBodies.BusinessDocument.content['application/json'].schema;
  assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.required,['periodId','documentNumber','counterpartyRef','counterpartyName','currency','accountingDate','amount','offsetAccountCode','attachmentIds']);
});
