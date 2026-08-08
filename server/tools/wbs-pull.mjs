#!/usr/bin/env node
//
// Pull real rows from the WBS read-only MCP and run them through the REFS
// accounting lineage. Read-only end to end: this posts nothing, writes nothing
// to WBS, and creates no journal entry.
//
// CREDENTIALS
// -----------
// Supplied by the operator's shell, never by this file, never by the repo.
// The three headers are read from the environment and injected through the
// client's `getAuthHeaders` seam, which is why no secret needs to be stored
// anywhere:
//
//   WBS_CF_ACCESS_CLIENT_ID       -> CF-Access-Client-Id
//   WBS_CF_ACCESS_CLIENT_SECRET   -> CF-Access-Client-Secret
//   WBS_REFS_AUTH                 -> X-REFS-Auth
//
// Nothing here prints a credential. The preflight reports only whether each
// variable is present and its length, so a typo is diagnosable without the
// value ever reaching a terminal, a log or a screenshot.
//
// USAGE
// -----
//   node server/tools/wbs-pull.mjs                 # step 1+2: meta, then a pilot sample
//   node server/tools/wbs-pull.mjs --tool list_payables --limit 10
//   node server/tools/wbs-pull.mjs --all           # a pilot page from every list tool
//   node server/tools/wbs-pull.mjs --json pilot.json # write aggregate pilot metadata
//
// The provider's own contract (§6) sequences first contact as: tools/list +
// get_meta + a pilot sample, then field-by-field confirmation, and only then
// bulk reads. `--all` still takes one pilot page per tool — the endpoint is
// rate limited to 10 req/s with concurrency 2 against the live BGDATA
// instance, which has no read replica. Deliberately no bulk mode here.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WBS_MCP_PILOT_LIMIT,
  WBS_READONLY_TOOLS,
  WBS_MCP_APPROVED_ENDPOINT,
  WbsMcpError,
  createReadOnlyWbsMcpClient,
} from '../runtime/wbs-readonly-mcp.mjs';
import {
  WBS_SOURCE_CATALOG,
  mapWbsSourceEnvelope,
} from '../runtime/wbs-mcp-lineage.mjs';

const CREDENTIAL_ENV = Object.freeze({
  'CF-Access-Client-Id': 'WBS_CF_ACCESS_CLIENT_ID',
  'CF-Access-Client-Secret': 'WBS_CF_ACCESS_CLIENT_SECRET',
  'X-REFS-Auth': 'WBS_REFS_AUTH',
});

const LIST_TOOLS = WBS_READONLY_TOOLS.filter(name => name.startsWith('list_'));

// Per-tool argument surface, transcribed from provider contract v0.1 §4.
// The client validates every key against the tool's *published* input schema and refuses
// the whole call on one undeclared key, so a single wrong parameter name costs a page.
// The parameters genuinely differ between tools — `company_code` on the ledger reads,
// `company` on the accounting reads — and `list_control_totals` takes no `limit` at all
// because it returns totals, not a page of rows.
export const WBS_PULL_TOOL_ARGS = Object.freeze({
  get_meta:                { company: null,        paged: false },  // §4.1 takes `section`
  list_payables:           { company: 'company_code', paged: true },  // §4.2
  list_bank_transactions:  { company: 'company_code', paged: true },  // §4.3
  list_autorec_details:    { company: null,        paged: true },  // §4.4 filters by pb_guid
  list_autorec_banks:      { company: 'company_code', paged: true },  // §4.5
  list_journal_entries:    { company: 'company',   paged: true },  // §4.6
  list_control_totals:     { company: 'company',   paged: false }, // §4.7 company/period/kind
  trace_by_key:            { company: null,        paged: false }, // §4.8 key_type/key_value
});

export function argsForWbsPullTool(tool, { limit, company }) {
  const spec = WBS_PULL_TOOL_ARGS[tool] || { company: null, paged: true };
  const args = {};
  if (spec.paged) args.limit = limit;
  if (company && spec.company) args[spec.company] = company;
  return args;
}

const PILOT_OUTPUT_DIRECTORY = resolve(dirname(new URL(import.meta.url).pathname), '../outputs/wbs-pilot');

// Pilot evidence can contain sensitive business metadata. Keep it confined to an
// ignored directory, make capture files immutable, and never serialize rows.
export function resolvePilotEvidencePath(requestedName, outputDirectory = PILOT_OUTPUT_DIRECTORY) {
  if (typeof requestedName !== 'string' || !requestedName.trim()) {
    throw new Error('--json requires a simple evidence file name such as pilot.json');
  }
  const name = requestedName.trim();
  // Reject both separator spellings before resolving. A WBS pilot artifact is
  // a file name, never a path; accepting Windows backslashes on POSIX would
  // make the policy depend on the runner OS.
  if (/[\\/]/.test(name) || basename(name) !== name || name === '.' || name === '..' || extname(name) !== '.json') {
    throw new Error('--json accepts only a simple .json file name; evidence is confined to server/outputs/wbs-pilot');
  }
  const root = resolve(outputDirectory);
  const target = resolve(root, name);
  const child = relative(root, target);
  if (!child || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(child)) {
    throw new Error('evidence path escapes the controlled pilot-output directory');
  }
  return target;
}

export function buildPilotEvidence(outcomes) {
  return outcomes.map(o => ({
    tool: o.tool,
    ok: o.ok,
    code: o.code ?? null,
    rows: o.rows ?? 0,
    mapped: o.mapped ?? 0,
    exception_codes: [...new Set(o.exceptions ?? [])].sort(),
  }));
}

export function writePilotEvidence({ outcomes, requestedName, outputDirectory } = {}) {
  const path = resolvePilotEvidencePath(requestedName, outputDirectory);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(buildPilotEvidence(outcomes), null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  return path;
}

function parseArgs(argv) {
  const args = { tool: null, limit: WBS_MCP_PILOT_LIMIT, all: false, json: null, company: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--tool') args.tool = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--company') args.company = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unrecognised argument "${a}"`);
  }
  return args;
}

// Presence and length only. Never the value.
function preflight() {
  const missing = [];
  const placeholders = [];
  // A pasted instruction placeholder is a real failure mode: it is "present" and long
  // enough, so length alone reports it as fine and the run dies later with a confusing
  // error. Angle brackets, CJK, or whitespace cannot occur in either real credential.
  const looksLikePlaceholder = v => /[<>]/.test(v) || /[一-鿿]/.test(v) || /\s/.test(v);
  for (const [header, envName] of Object.entries(CREDENTIAL_ENV)) {
    const value = process.env[envName];
    const present = typeof value === 'string' && value.length >= 8;
    const placeholder = present && looksLikePlaceholder(value);
    const state = !present
      ? 'MISSING or too short'
      : placeholder
        ? `PLACEHOLDER, not a credential (${value.length} chars)`
        : `present (${value.length} chars)`;
    console.log(`  ${header.padEnd(26)} <- ${envName.padEnd(30)} ${state}`);
    if (!present) missing.push(envName);
    else if (placeholder) placeholders.push(envName);
  }
  if (placeholders.length) {
    console.error(
      `\nRefusing to start: ${placeholders.join(', ')} still contain instruction text\n` +
      `rather than a credential. Copy the real values from section 2.1 and 2.2 of the\n` +
      `WBS delivery document. Neither value contains angle brackets, spaces or CJK.\n`
    );
    process.exit(2);
  }
  if (missing.length) {
    console.error(
      `\nRefusing to start: ${missing.join(', ')} not set.\n\n` +
      `Set them in your shell for this session only — do not put them in a file in this repo,\n` +
      `and do not commit them. PowerShell:\n\n` +
      `  $env:WBS_CF_ACCESS_CLIENT_ID='...'\n` +
      `  $env:WBS_CF_ACCESS_CLIENT_SECRET='...'\n` +
      `  $env:WBS_REFS_AUTH='...'\n`
    );
    process.exit(2);
  }
}

const getAuthHeaders = () => ({
  'CF-Access-Client-Id': process.env.WBS_CF_ACCESS_CLIENT_ID,
  'CF-Access-Client-Secret': process.env.WBS_CF_ACCESS_CLIENT_SECRET,
  'X-REFS-Auth': process.env.WBS_REFS_AUTH,
});

async function pullOne(client, tool, { limit, company }) {
  const catalog = WBS_SOURCE_CATALOG[tool];
  console.log(`\n── ${tool} ${'─'.repeat(Math.max(0, 58 - tool.length))}`);
  if (catalog) console.log(`   role ${catalog.role} · terminus ${catalog.terminus}`);

  const args = argsForWbsPullTool(tool, { limit, company });
  console.log(`   requested ${Object.keys(args).length ? Object.keys(args).join(', ') : 'no arguments'}`);

  // `readView` runs the frozen contract validator itself and returns the frozen,
  // validated envelope — so there is exactly one validation point, not two that
  // could drift apart.
  let envelope;
  try {
    envelope = await client.readView({ toolName: tool, args });
  } catch (error) {
    if (error instanceof WbsMcpError) {
      console.log(`   REFUSED  ${error.code}`);
      // The frozen validator accepts `environment: production` only (contract §2 allows
      // "sandbox | production"). Refusing a sandbox envelope is correct — REFS must not
      // map non-production rows into an accounting lineage — but the bare code does not
      // say so, and this is the likeliest first-run surprise.
      if (error.code === 'WBS_MCP_ENVELOPE_INVALID') {
        console.log('            If the provider is serving sandbox data, this is the expected refusal:');
        console.log('            the read contract accepts environment="production" only.');
      }
      if (error.code === 'WBS_MCP_CONTENT_HASH_MISMATCH') {
        console.log('            Contract §2 computes content_sha256 over the canonical JSON of the page\'s');
        console.log('            rows. A mismatch means our canonicalisation and theirs differ — a contract');
        console.log('            question to settle with WBS, not corrupted data.');
      }
      if (error.code === 'WBS_MCP_ARGUMENTS_INVALID') {
        console.log('            An argument key is not in this tool\'s published input schema. Compare');
        console.log('            against get_meta section=dictionary before changing anything here.');
      }
      return { tool, ok: false, code: error.code };
    }
    throw error;
  }

  const rows = envelope.rows || [];
  console.log(`   rows ${rows.length}`);

  if (!catalog) {
    console.log('   no lineage catalog entry — envelope shown only, nothing mapped');
    return { tool, ok: true, rows: rows.length, mapped: 0, exceptions: [] };
  }

  // Contract §2: the envelope carries `scope.company_codes` (an array), not `company`.
  // Reading the singular yields null, which the lineage mapper reports as CROSS_COMPANY on
  // every row — a scope-plumbing bug that would look like a data defect. A page scoped to
  // exactly one company gives a company_key; a multi-company page deliberately does not,
  // because the mapper's key identifies one company and guessing which would be worse than
  // failing closed.
  const codes = envelope.scope?.company_codes;
  const singleCode = Array.isArray(codes) && codes.length === 1 ? codes[0] : null;
  const scope = { company_key: singleCode ?? envelope.scope?.company ?? company ?? null };
  if (Array.isArray(codes) && codes.length > 1) {
    console.log(`   scope covers ${codes.length} companies — rows will be scoped per row, not per page`);
  }
  const result = mapWbsSourceEnvelope({
    toolName: tool,
    envelope,
    scope,
    mappingCandidatesByKey: {},
    memberByKey: {},
  });

  const exceptions = result.exceptions || [];
  console.log(`   normalized ${result.normalized.length} · exceptions ${exceptions.length}`);
  const seams =
    (result.je_request_seams?.length || 0) +
    (result.autorec_review?.length || 0) +
    (result.evidence?.length || 0);
  console.log(`   reached terminus: ${seams} item(s)`);

  const exceptionCodes = [...new Set(exceptions.map(e => e.code))];
  if (exceptionCodes.length) console.log(`   exception codes: ${exceptionCodes.join(', ')}`);
  // Default output is safe pilot metadata only. Source keys, amounts, dates,
  // account codes, row payloads, and upstream error detail stay out of logs.

  return {
    tool,
    ok: true,
    rows: rows.length,
    mapped: result.normalized.length,
    exceptions: exceptions.map(e => e.code),
    result,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(new URL(import.meta.url).pathname);
    console.log('  --tool <name> --limit <1..10> --company <key> --all --json <file.json>');
    console.log('  --json records aggregate metadata only under server/outputs/wbs-pilot and never overwrites.');
    return;
  }
  if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > WBS_MCP_PILOT_LIMIT) {
    console.error(`--limit must be between 1 and ${WBS_MCP_PILOT_LIMIT} (pilot cap).`);
    process.exit(2);
  }
  if (args.tool && !WBS_READONLY_TOOLS.includes(args.tool)) {
    console.error(`--tool must be one of: ${WBS_READONLY_TOOLS.join(', ')}`);
    process.exit(2);
  }

  console.log('WBS read-only pull — credentials from environment, nothing written to WBS\n');
  console.log('Credential preflight:');
  preflight();

  // Default to the approved endpoint. Passing `undefined` reaches `new URL(undefined)`,
  // which throws WBS_MCP_CONFIG_INVALID "endpoint is invalid" before any request is made —
  // a confusing way to say "you did not set an optional variable".
  const endpoint = process.env.WBS_MCP_ENDPOINT || WBS_MCP_APPROVED_ENDPOINT;
  console.log(`\nEndpoint configuration: ${process.env.WBS_MCP_ENDPOINT ? 'operator supplied' : 'approved default'}`);

  const client = createReadOnlyWbsMcpClient({
    endpoint,
    getAuthHeaders,
    allowedReadTools: WBS_READONLY_TOOLS,
  });

  console.log('\nStep 0 · initialize');
  const session = await client.initialize();
  console.log(`  protocol ${session.protocolVersion} · server ${session.serverName ?? '(unnamed)'}`);

  console.log('\nStep 1 · tools/list');
  // listTools itself refuses unless the advertised catalogue is exactly the eight
  // approved tools and every one is declared readOnly, non-destructive and
  // idempotent. A provider that quietly adds a ninth tool fails here, closed.
  const advertised = await client.listTools();
  const names = (advertised || []).map(t => (typeof t === 'string' ? t : t.name)).filter(Boolean);
  console.log(`  advertised: ${names.join(', ') || '(none)'}`);
  const unexpected = names.filter(n => !WBS_READONLY_TOOLS.includes(n));
  if (unexpected.length) console.log(`  NOT IN THE APPROVED SET, will not be called: ${unexpected.join(', ')}`);
  const absent = WBS_READONLY_TOOLS.filter(n => !names.includes(n));
  if (absent.length) console.log(`  approved but not advertised: ${absent.join(', ')}`);

  console.log('\nStep 2 · get_meta');
  const outcomes = [];
  outcomes.push(await pullOne(client, 'get_meta', { limit: args.limit, company: args.company }));

  const tools = args.tool ? [args.tool] : args.all ? LIST_TOOLS : [];
  for (const tool of tools) {
    if (tool === 'get_meta') continue;
    outcomes.push(await pullOne(client, tool, { limit: args.limit, company: args.company }));
  }

  console.log('\n── summary ' + '─'.repeat(52));
  let rows = 0, mapped = 0, refused = 0;
  const codes = new Map();
  for (const o of outcomes) {
    if (!o.ok) { refused += 1; continue; }
    rows += o.rows || 0;
    mapped += o.mapped || 0;
    for (const c of o.exceptions || []) codes.set(c, (codes.get(c) || 0) + 1);
  }
  console.log(`  tools called ${outcomes.length} · refused ${refused}`);
  console.log(`  rows received ${rows} · normalized ${mapped}`);
  console.log(`  exception codes: ${codes.size ? [...codes].map(([c, n]) => `${c}×${n}`).join(', ') : 'none'}`);
  console.log('\n  Nothing was written to WBS. No journal entry was created, approved or posted.');
  console.log('  This is a read and a mapping. Posting stays behind Draft -> Review -> Approve -> Post.');

  if (args.json) {
    const evidencePath = writePilotEvidence({ outcomes, requestedName: args.json });
    console.log(`\n  wrote ${evidencePath} (aggregate metadata only; no rows, credentials, or raw headers)`);
  }

  if (refused > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    if (error instanceof WbsMcpError) {
      console.error(`\nWBS refused the request: ${error.code}\n  ${error.message}`);
      if (error.code === 'WBS_MCP_AUTHENTICATION_REQUIRED') {
        console.error(
          '\n  Both layers must be present: Cloudflare Access (missing -> 403) and the\n' +
          '  application shared secret (missing or wrong -> 401). Check all three variables.'
        );
      }
      process.exit(1);
    }
    // Do not echo an upstream response or transport error: providers sometimes
    // include row context in those messages. The structured error code path above
    // is safe; all other diagnostics belong in operator-controlled infrastructure.
    console.error('\nUnexpected WBS pull failure. No response detail was written to this terminal.');
    process.exit(1);
  });
}
