// Binds docs/WBS-MCP-LINEAGE.md to the reviewed V2 nine-source catalog so the
// documented stable keys, field counts, exception taxonomy and cursor
// semantics cannot silently drift from server/runtime/wbs-mcp-lineage.mjs.
//
// Read-only, credential-free, no network access.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { WBS_READONLY_TOOLS } from './server/runtime/wbs-readonly-mcp.mjs';
import {
  WBS_LINEAGE_CONTRACT_VERSION,
  WBS_LINEAGE_EXCEPTIONS,
  WBS_PIPELINE_STAGES,
  WBS_SOURCE_CATALOG,
  describeWbsMappingCoverage,
  verifyCatalogAgainstFrozenRowFields,
} from './server/runtime/wbs-mcp-lineage.mjs';

const root = import.meta.dirname;
const doc = readFileSync(resolve(root, 'docs', 'WBS-MCP-LINEAGE.md'), 'utf8');
const source = readFileSync(resolve(root, 'server', 'runtime', 'wbs-mcp-lineage.mjs'), 'utf8');
const coverage = describeWbsMappingCoverage();

// This is a reviewed contract, not a count-only threshold.  In particular, it
// retires the legacy eight-tool catalog by requiring the V2 insurance listing
// in its reviewed position.
const REVIEWED_WBS_MCP_CATALOG_V2_TOOLS = Object.freeze([
  'get_meta',
  'list_payables',
  'list_bank_transactions',
  'list_autorec_details',
  'list_autorec_banks',
  'list_journal_entries',
  'list_control_totals',
  'list_insurance',
  'trace_by_key',
]);

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(doc.includes(WBS_LINEAGE_CONTRACT_VERSION), `docs must name ${WBS_LINEAGE_CONTRACT_VERSION}`);
check(
  JSON.stringify(WBS_READONLY_TOOLS) === JSON.stringify(REVIEWED_WBS_MCP_CATALOG_V2_TOOLS),
  'the catalog must exactly match reviewed V2 nine-tool order; the legacy eight-tool catalog is rejected',
);
check(coverage.source_count === REVIEWED_WBS_MCP_CATALOG_V2_TOOLS.length, 'the catalog must hold exactly nine sources');
check(coverage.declared_fields === coverage.mapped_source_fields, 'every declared field must be mapped');
check(doc.includes(String(coverage.declared_fields)), 'docs must state the declared field count');

for (const tool of WBS_READONLY_TOOLS) {
  check(Object.hasOwn(WBS_SOURCE_CATALOG, tool), `catalog is missing approved tool ${tool}`);
  check(doc.includes(`\`${tool}\``), `docs must document ${tool}`);
  const entry = WBS_SOURCE_CATALOG[tool];
  if (!entry) continue;
  check(WBS_PIPELINE_STAGES.includes(entry.terminus), `${tool} terminus must be a declared pipeline stage`);
  check(doc.includes(entry.terminus), `docs must document terminus ${entry.terminus}`);
  for (const part of entry.stable_key) {
    check(doc.includes(`\`${part}\``), `docs must document stable-key part ${tool}.${part}`);
  }
}

for (const code of Object.values(WBS_LINEAGE_EXCEPTIONS)) {
  check(doc.includes(code), `docs must define exception class ${code}`);
}

const drift = verifyCatalogAgainstFrozenRowFields();
check(drift.ok, `catalog drifted from the frozen row-field allowlist: ${JSON.stringify(drift.drift)}`);

for (const forbidden of [/https?:\/\//, /wbm3/i, /CF-Access/i, /X-REFS-Auth/i, /\bcookie\b/i, /fetch\s*\(/]) {
  check(!forbidden.test(source), `the lineage module must not contain ${forbidden}`);
}

const readOnlyClaims = ['read_only: true', 'can_write_wbs: false', 'can_post: false'];
for (const claim of readOnlyClaims) {
  check(source.includes(claim), `the lineage module must declare ${claim}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`verify-wbs-mcp-lineage: ${failures.length} failure(s)`);
  process.exitCode = 1;
} else {
  console.log(
    `verify-wbs-mcp-lineage: OK — ${coverage.source_count} sources, ${coverage.declared_fields} declared fields, ` +
      `${coverage.exception_classes.length} exception classes, coverage ${coverage.coverage_ratio}`,
  );
}
