import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WBS_MCP_TOOLS = Object.freeze([
  'get_meta',
  'list_payables',
  'list_bank_transactions',
  'list_autorec_details',
  'list_autorec_banks',
  'list_journal_entries',
  'list_control_totals',
  'trace_by_key',
]);

export const WBS_STABLE_KEYS = Object.freeze({
  list_payables: 'ap_guid',
  list_bank_transactions: 'cb_id',
  list_autorec_details: 'pd_guid',
  list_autorec_banks: 'pb_guid',
  list_journal_entries: 'id',
});

const SAMPLE_TOOLS = Object.freeze([...Object.keys(WBS_STABLE_KEYS)]);
const REQUIRED_ENV = Object.freeze([
  'WBS_MCP_ENDPOINT',
  'WBS_CF_ACCESS_CLIENT_ID',
  'WBS_CF_ACCESS_CLIENT_SECRET',
  'WBS_REFS_AUTH',
]);
const MAX_SAMPLE_ROWS = 1;
const MAX_CONCURRENCY = 2;
const APPROVED_ENDPOINT = 'https://refs-mcp.wbm3.com/mcp';

export class WbsMcpContractError extends Error {
  constructor(code, detail = '') {
    super(code);
    this.name = 'WbsMcpContractError';
    this.code = code;
    this.detail = detail;
  }
}

function invariant(condition, code, detail = '') {
  if (!condition) throw new WbsMcpContractError(code, detail);
}

export function sortedCompactJson(value) {
  if (Array.isArray(value)) return `[${value.map(sortedCompactJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${sortedCompactJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sha256SortedCompact(value) {
  return createHash('sha256').update(sortedCompactJson(value), 'utf8').digest('hex');
}

function parseMcpBody(text, contentType) {
  if (!text.trim()) return null;
  if (contentType.includes('text/event-stream')) {
    const data = text.split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .filter(Boolean);
    invariant(data.length > 0, 'WBS_MCP_SSE_EMPTY');
    for (let index = data.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(data[index]); } catch {}
    }
    throw new WbsMcpContractError('WBS_MCP_SSE_INVALID');
  }
  try { return JSON.parse(text); }
  catch { throw new WbsMcpContractError('WBS_MCP_JSON_INVALID'); }
}

function extractToolPayload(result) {
  const text = result?.content?.find?.(item => item?.type === 'text' && typeof item.text === 'string')?.text;
  if (text) {
    try { return JSON.parse(text); }
    catch { throw new WbsMcpContractError('WBS_MCP_TOOL_PAYLOAD_INVALID'); }
  }
  if (result?.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent;
  throw new WbsMcpContractError('WBS_MCP_TOOL_PAYLOAD_MISSING');
}

function validateToolCatalog(tools) {
  invariant(Array.isArray(tools), 'WBS_MCP_TOOL_CATALOG_INVALID');
  const names = tools.map(tool => tool?.name).sort();
  invariant(
    JSON.stringify(names) === JSON.stringify([...WBS_MCP_TOOLS].sort()),
    'WBS_MCP_TOOL_ALLOWLIST_MISMATCH',
    names.join(','),
  );
  for (const tool of tools) {
    invariant(tool.annotations?.readOnlyHint === true, 'WBS_MCP_TOOL_NOT_READ_ONLY', tool.name);
    invariant(tool.annotations?.destructiveHint === false, 'WBS_MCP_TOOL_DESTRUCTIVE', tool.name);
    invariant(tool.annotations?.idempotentHint === true, 'WBS_MCP_TOOL_NOT_IDEMPOTENT', tool.name);
  }
  return new Map(tools.map(tool => [tool.name, tool]));
}

export function validateWbsEnvelope(envelope, expectedTool) {
  invariant(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'WBS_MCP_ENVELOPE_INVALID', expectedTool);
  invariant(envelope.tool === expectedTool, 'WBS_MCP_ENVELOPE_TOOL_MISMATCH', expectedTool);
  invariant(typeof envelope.contract_version === 'string' && envelope.contract_version.length > 0, 'WBS_MCP_CONTRACT_VERSION_MISSING', expectedTool);
  invariant(typeof envelope.environment === 'string' && envelope.environment.length > 0, 'WBS_MCP_ENVIRONMENT_MISSING', expectedTool);
  invariant(typeof envelope.captured_at === 'string' && !Number.isNaN(Date.parse(envelope.captured_at)), 'WBS_MCP_CAPTURE_TIME_INVALID', expectedTool);
  invariant(envelope.source && typeof envelope.source === 'object', 'WBS_MCP_SOURCE_MISSING', expectedTool);
  invariant(envelope.scope && typeof envelope.scope === 'object', 'WBS_MCP_SCOPE_MISSING', expectedTool);
  invariant(Array.isArray(envelope.rows), 'WBS_MCP_ROWS_INVALID', expectedTool);
  invariant(Number.isInteger(envelope.record_count) && envelope.record_count === envelope.rows.length, 'WBS_MCP_RECORD_COUNT_MISMATCH', expectedTool);
  invariant(envelope.rows.length <= MAX_SAMPLE_ROWS, 'WBS_MCP_SAMPLE_LIMIT_EXCEEDED', expectedTool);
  invariant(/^[a-f0-9]{64}$/i.test(String(envelope.content_sha256 || '')), 'WBS_MCP_CONTENT_HASH_INVALID', expectedTool);
  invariant(sha256SortedCompact(envelope.rows) === String(envelope.content_sha256).toLowerCase(), 'WBS_MCP_CONTENT_HASH_MISMATCH', expectedTool);
  const stableKey = WBS_STABLE_KEYS[expectedTool];
  if (stableKey) {
    for (const row of envelope.rows) {
      invariant(row && row[stableKey] !== undefined && row[stableKey] !== null && String(row[stableKey]).length > 0, 'WBS_MCP_STABLE_KEY_MISSING', `${expectedTool}:${stableKey}`);
    }
  }
  return {
    tool: expectedTool,
    recordCount: envelope.record_count,
    hashVerified: true,
    stableKey: stableKey || null,
    cursorPresent: envelope.cursor_next !== null && envelope.cursor_next !== undefined && String(envelope.cursor_next).length > 0,
    contractVersion: envelope.contract_version,
    environment: envelope.environment,
  };
}

function sampleArguments(tool) {
  const properties = tool?.inputSchema?.properties || {};
  invariant(Object.hasOwn(properties, 'limit'), 'WBS_MCP_LIMIT_UNSUPPORTED', tool?.name || 'unknown');
  return { limit: MAX_SAMPLE_ROWS };
}

function createHeaders(environment) {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'user-agent': 'REFS-WBS-MCP-Contract-Smoke/1.0',
    'cf-access-client-id': environment.WBS_CF_ACCESS_CLIENT_ID,
    'cf-access-client-secret': environment.WBS_CF_ACCESS_CLIENT_SECRET,
    'x-refs-auth': environment.WBS_REFS_AUTH,
  };
}

export async function verifyWbsMcpContractLive({ environment = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const missing = REQUIRED_ENV.filter(name => !String(environment[name] || '').trim());
  invariant(missing.length === 0, 'WBS_MCP_CONFIG_MISSING', missing.join(','));
  invariant(typeof fetchImpl === 'function', 'WBS_MCP_FETCH_UNAVAILABLE');
  const endpoint = new URL(environment.WBS_MCP_ENDPOINT);
  invariant(endpoint.href === APPROVED_ENDPOINT, 'WBS_MCP_ENDPOINT_NOT_APPROVED');
  invariant(MAX_CONCURRENCY <= 2 && MAX_SAMPLE_ROWS <= 1, 'WBS_MCP_PILOT_BOUNDS_INVALID');

  const headers = createHeaders(environment);
  let sessionId = null;
  let requestId = 0;
  const rpc = async (method, params, notification = false) => {
    const body = { jsonrpc: '2.0', method, ...(params === undefined ? {} : {params}) };
    if (!notification) body.id = ++requestId;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: sessionId ? {...headers, 'mcp-session-id': sessionId} : headers,
      body: JSON.stringify(body),
    });
    invariant(response?.ok, 'WBS_MCP_HTTP_FAILURE', `${method}:${response?.status || 0}`);
    sessionId ||= response.headers?.get?.('mcp-session-id') || null;
    if (notification) return null;
    const payload = parseMcpBody(await response.text(), response.headers?.get?.('content-type') || '');
    invariant(payload && payload.jsonrpc === '2.0' && payload.id === body.id, 'WBS_MCP_RPC_RESPONSE_INVALID', method);
    invariant(!payload.error, 'WBS_MCP_RPC_ERROR', `${method}:${payload.error?.code || 'unknown'}`);
    return payload.result;
  };

  const initialized = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: {name: 'refs-wbs-contract-smoke', version: '1.0.0'},
  });
  invariant(initialized?.protocolVersion === '2025-06-18', 'WBS_MCP_PROTOCOL_VERSION_MISMATCH');
  await rpc('notifications/initialized', undefined, true);
  const catalogResult = await rpc('tools/list', {});
  const catalog = validateToolCatalog(catalogResult?.tools);

  const results = [];
  for (const toolName of SAMPLE_TOOLS) {
    const toolResult = await rpc('tools/call', {name: toolName, arguments: sampleArguments(catalog.get(toolName))});
    invariant(toolResult?.isError !== true, 'WBS_MCP_TOOL_CALL_FAILED', toolName);
    results.push(validateWbsEnvelope(extractToolPayload(toolResult), toolName));
  }

  log(JSON.stringify({
    ok: true,
    toolCount: catalog.size,
    allowedTools: [...WBS_MCP_TOOLS],
    sampleLimit: MAX_SAMPLE_ROWS,
    maxConcurrency: MAX_CONCURRENCY,
    samples: results,
  }));
  return {ok: true, toolCount: catalog.size, samples: results};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyWbsMcpContractLive().catch(error => {
    const code = error instanceof WbsMcpContractError ? error.code : 'WBS_MCP_SMOKE_FAILED';
    const detail = error instanceof WbsMcpContractError ? error.detail : '';
    console.error(`${code}${detail ? `: ${detail}` : ''}`);
    process.exitCode = 2;
  });
}
