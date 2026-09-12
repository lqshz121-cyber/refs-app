import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const spec=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));
const base='/entities/{entityId}/cash-transfers';
const paths={
  register:base,
  createOptions:base+'/create-options',
  attachmentCandidates:base+'/attachment-candidates',
  bankLegCandidates:base+'/{cashTransferId}/bank-leg-candidates',
  detail:base+'/{cashTransferId}',
  transitions:base+'/{cashTransferId}/transitions',
  cancel:base+'/{cashTransferId}/cancel',
  post:base+'/{cashTransferId}/post',
  controls:base+'/bank-account-controls',
  approve:base+'/bank-account-controls/{controlId}/approve',
  retire:base+'/bank-account-controls/{controlId}/retire',
  links:base+'/{cashTransferId}/bank-links',
};
const operation=(path,method)=>{const value=spec.paths[path]?.[method];assert.ok(value,path+' '+method.toUpperCase()+' must be published');return value;};
const refNames=operation=>operation.parameters?.filter(item=>item.$ref).map(item=>item.$ref)??[];
const body=operation=>operation.requestBody?.content?.['application/json']?.schema;

test('Cash Transfer OpenAPI publishes the complete scoped read and command surface',()=>{
  assert.equal(operation(paths.register,'get').operationId,'readCashTransferRegister');
  assert.equal(operation(paths.register,'post').operationId,'createCashTransfer');
  assert.equal(operation(paths.createOptions,'get').operationId,'readCashTransferCreateOptions');
  assert.equal(operation(paths.attachmentCandidates,'get').operationId,'readCashTransferAttachmentCandidates');
  assert.equal(operation(paths.bankLegCandidates,'get').operationId,'readCashTransferBankLegCandidates');
  assert.equal(operation(paths.detail,'get').operationId,'readCashTransferDetail');
  assert.equal(operation(paths.transitions,'post').operationId,'transitionCashTransfer');
  assert.equal(operation(paths.cancel,'post').operationId,'cancelCashTransfer');
  assert.equal(operation(paths.post,'post').operationId,'postCashTransfer');
  assert.equal(operation(paths.controls,'get').operationId,'readCashTransferBankAccountControls');
  assert.equal(operation(paths.controls,'post').operationId,'createCashTransferBankAccountControl');
  assert.equal(operation(paths.approve,'post').operationId,'approveCashTransferBankAccountControl');
  assert.equal(operation(paths.retire,'post').operationId,'retireCashTransferBankAccountControl');
  assert.equal(operation(paths.links,'post').operationId,'linkCashTransferBankLeg');
});

test('Cash Transfer OpenAPI closes headers, CAS, DTOs, and no-store boundaries',()=>{
  const reads=[operation(paths.register,'get'),operation(paths.createOptions,'get'),operation(paths.attachmentCandidates,'get'),operation(paths.bankLegCandidates,'get'),operation(paths.detail,'get'),operation(paths.controls,'get')];
  for(const read of reads){
    assert.ok(read.responses['200'],'read must define 200');
    assert.equal(read.responses['200'].headers['Cache-Control'].$ref,'#/components/headers/NoStore');
    assert.ok(refNames(read).includes('#/components/parameters/EntityId'));
    assert.equal(refNames(read).includes('#/components/parameters/IdempotencyKey'),false);
    assert.equal(refNames(read).includes('#/components/parameters/IfMatch'),false);
  }
  const commands=[operation(paths.register,'post'),operation(paths.transitions,'post'),operation(paths.cancel,'post'),operation(paths.post,'post'),operation(paths.controls,'post'),operation(paths.approve,'post'),operation(paths.retire,'post'),operation(paths.links,'post')];
  for(const command of commands){
    assert.ok(refNames(command).includes('#/components/parameters/EntityId'));
    assert.ok(refNames(command).includes('#/components/parameters/IdempotencyKey'));
    assert.equal(body(command).additionalProperties,false);
    assert.ok(command.responses['201']||command.responses['200']);
    assert.ok(command.responses['400']);assert.ok(command.responses['401']);assert.ok(command.responses['403']);
  }
  for(const command of [operation(paths.transitions,'post'),operation(paths.cancel,'post'),operation(paths.post,'post'),operation(paths.approve,'post'),operation(paths.retire,'post'),operation(paths.links,'post')])assert.ok(refNames(command).includes('#/components/parameters/IfMatch'),'mutable existing evidence requires strong CAS');
  const register=operation(paths.register,'get'),registerNames=register.parameters.map(item=>item.name??item.$ref);
  for(const name of ['periodId','limit','afterDate','afterTransferId'])assert.ok(registerNames.includes(name));
  const options=operation(paths.createOptions,'get'),optionNames=options.parameters.map(item=>item.name??item.$ref);
  for(const name of ['periodId','transferDate'])assert.ok(optionNames.includes(name));
  assert.match(operation(paths.attachmentCandidates,'get').description,/never exposes storage locations, content hashes, scan references/i);const attachmentCandidateNames=operation(paths.attachmentCandidates,'get').parameters.map(item=>item.name??item.$ref);for(const name of ['limit','beforeVerifiedAt','beforeAttachmentId'])assert.ok(attachmentCandidateNames.includes(name));
  const bankLegNames=operation(paths.bankLegCandidates,'get').parameters.map(item=>item.name??item.$ref);
  for(const name of ['cashTransferId','leg','limit','afterExternalBankLineId','afterBankSourceId'])assert.ok(bankLegNames.includes(name));
  assert.match(operation(paths.bankLegCandidates,'get').description,/does not require generic BANK\.VIEW/i);
  const create=body(operation(paths.register,'post'));
  for(const field of ['periodId','date','currency','sourceCashAccountCode','sourceBankMemberRef','destinationCashAccountCode','destinationBankMemberRef','amount','number','attachmentIds','reason'])assert.ok(create.required.includes(field));
  for(const command of [operation(paths.transitions,'post'),operation(paths.cancel,'post'),operation(paths.post,'post'),operation(paths.links,'post')])assert.ok(command.responses['412'],'revision/evidence drift must map to 412');
});
