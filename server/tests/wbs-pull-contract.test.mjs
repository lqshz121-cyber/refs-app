import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  WBS_PULL_TOOL_ARGS,
  argsForWbsPullTool,
} from '../tools/wbs-pull.mjs';

test('WBS pull supplies only each provider contract section\'s declared arguments', () => {
  const input = { limit: 7, company: 'WBAI' };
  assert.deepEqual(argsForWbsPullTool('get_meta', input), {});
  assert.deepEqual(argsForWbsPullTool('list_payables', input), { limit: 7, company_code: 'WBAI' });
  assert.deepEqual(argsForWbsPullTool('list_bank_transactions', input), { limit: 7, company_code: 'WBAI' });
  assert.deepEqual(argsForWbsPullTool('list_autorec_details', input), { limit: 7 });
  assert.deepEqual(argsForWbsPullTool('list_autorec_banks', input), { limit: 7, company_code: 'WBAI' });
  assert.deepEqual(argsForWbsPullTool('list_journal_entries', input), { limit: 7, company: 'WBAI' });
  assert.deepEqual(argsForWbsPullTool('list_control_totals', input), { company: 'WBAI' });
  assert.deepEqual(argsForWbsPullTool('trace_by_key', input), {});
  assert.equal(WBS_PULL_TOOL_ARGS.list_control_totals.paged, false);
});

test('WBS pull fails credential preflight before endpoint or network access', () => {
  const result = spawnSync(process.execPath, ['tools/wbs-pull.mjs', '--tool', 'get_meta'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      ComSpec: process.env.ComSpec,
    },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Credential preflight/);
  assert.match(result.stderr, /Refusing to start/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /https:\/\//);
});
