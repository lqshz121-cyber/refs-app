import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  WBS_PULL_TOOL_ARGS,
  argsForWbsPullTool,
  buildPilotEvidence,
  resolvePilotEvidencePath,
  writePilotEvidence,
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

test('pilot evidence is aggregate-only and excludes business rows and secret-like values', () => {
  const evidence = buildPilotEvidence([{
    tool: 'list_bank_transactions', ok: true, rows: 1, mapped: 1,
    exceptions: ['AMBIGUOUS_MATCH'],
    result: { normalized: [{ source_id: 'SOURCE-CANARY', amount: 923.45, secret: 'SECRET-CANARY' }] },
  }]);
  const serialized = JSON.stringify(evidence);
  assert.deepEqual(evidence, [{
    tool: 'list_bank_transactions', ok: true, code: null, rows: 1, mapped: 1,
    exception_codes: ['AMBIGUOUS_MATCH'],
  }]);
  assert.doesNotMatch(serialized, /SOURCE-CANARY|SECRET-CANARY|923\.45/);
});

test('pilot evidence path is confined, non-overwriting, and metadata-only', () => {
  const directory = mkdtempSync(join(tmpdir(), 'refs-wbs-pilot-'));
  try {
    assert.throws(() => resolvePilotEvidencePath('../escape.json', directory), /simple .json file name/);
    assert.throws(() => resolvePilotEvidencePath('..\\escape.json', directory), /simple .json file name/);
    assert.throws(() => resolvePilotEvidencePath('C:\\escape.json', directory), /simple .json file name/);
    const path = writePilotEvidence({
      outcomes: [{ tool: 'get_meta', ok: true, rows: 1, mapped: 0, exceptions: [] }],
      requestedName: 'pilot.json',
      outputDirectory: directory,
    });
    assert.equal(existsSync(path), true);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), [{
      tool: 'get_meta', ok: true, code: null, rows: 1, mapped: 0, exception_codes: [],
    }]);
    assert.throws(() => writePilotEvidence({
      outcomes: [], requestedName: 'pilot.json', outputDirectory: directory,
    }), /EEXIST/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
