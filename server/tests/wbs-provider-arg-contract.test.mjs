import test from 'node:test';
import assert from 'node:assert/strict';
import { WBS_PULL_TOOL_ARGS, argsForWbsPullTool } from '../tools/wbs-pull.mjs';

test('list_payables keeps the provider-native company scope argument', () => {
  assert.equal(WBS_PULL_TOOL_ARGS.list_payables.company, 'company_code');
  assert.deepEqual(argsForWbsPullTool('list_payables', {
    limit: 10,
    company: 'WBPA',
  }), { limit: 10, company_code: 'WBPA' });
});

test('provider argument helper does not invent company scope for unknown tools', () => {
  assert.deepEqual(argsForWbsPullTool('unknown_tool', {
    limit: 10,
    company: 'WBPA',
  }), { limit: 10 });
});
