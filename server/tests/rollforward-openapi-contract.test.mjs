import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8'));

test('construction-loan and prepaid rollforwards are documented exact period-scoped no-store reads',()=>{
  for(const [path,operationId,responseName,rowName,status,moneyFields] of [
    ['/entities/{entityId}/reports/construction-loan-rollforward','getConstructionLoanRollforward','ConstructionLoanRollforwardReadOk','ConstructionLoanRollforwardReadRow','MAPPED_CONSTRUCTION_LOAN_ACCOUNT',['opening_balance','period_draws','period_repayments','closing_balance']],
    ['/entities/{entityId}/reports/prepaid-rollforward','getPrepaidRollforward','PrepaidRollforwardReadOk','PrepaidRollforwardReadRow','MAPPED_PREPAID_ACCOUNT',['opening_balance','period_additions','period_amortization','closing_balance']],
  ]){
    const operation=contract.paths[path]?.get;
    assert.equal(operation.operationId,operationId);
    assert.equal(operation.parameters.find(parameter=>parameter.name==='periodId')?.required,true);
    assert.equal(operation.responses['200'].$ref,`#/components/responses/${responseName}`);
    assert.match(operation.description,/POSTED ledger evidence/);
    assert.match(operation.description,/cannot infer/i);
    const row=contract.components.schemas[rowName];
    assert.equal(row.additionalProperties,false);
    assert.ok(row.properties.mapping_status.enum.includes(status));
    for(const field of moneyFields)assert.equal(row.properties[field].oneOf[0].$ref,'#/components/schemas/Money');
    for(const field of ['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'])assert.equal(row.properties[field].items.$ref,'#/components/schemas/Uuid');
    assert.equal(contract.components.responses[responseName].headers['Cache-Control'].schema.const,'no-store');
  }
});
