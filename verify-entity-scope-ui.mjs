import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { localDimensionScopeEvidence } from './src/dimension-scope-evidence.js';
import { localReportScopeState } from './src/report-scope-empty-state.js';

const reportsSource = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const postedJournal = {
  posting_status: 'POSTED',
  entity_id: 4,
  lines: [{ account_code: '111000', debit_amount: 100, credit_amount: 0 }],
};

assert.equal(
  localDimensionScopeEvidence([postedJournal], { entityId: null }).state,
  'ENTITY_REQUIRED',
  'dimension scope must fail closed when no entity is selected',
);
assert.equal(
  localDimensionScopeEvidence([postedJournal], { entityId: '4' }).state,
  'LOCAL_SCOPE_COMPLETE',
  'route string entity ids must bind to numeric journal entity ids',
);
assert.equal(
  localReportScopeState({ journals: [postedJournal], entityId: null }).postedCount,
  0,
  'reports must not count global journals as a selected-entity result',
);

assert.match(reportsSource, /if \(!hasReportEntity && !drill\) return/, 'GL must render an entity-required state before report calculations');
assert.match(reportsSource, /Financial statements, control totals, drill-downs, and evidence status are never calculated across all entities\./, 'GL needs an explicit no-consolidation boundary');
assert.match(reportsSource, /REFS does not aggregate entity balances, journal counts, or mock projections into an “All entities” report\./, 'Reports Center needs an explicit no-global-results state');
assert.match(reportsSource, /reportCenterReturn:\{route:'reports',reportName:tab,category,search,reportPage\}/, 'Reports launch must retain its return scope and catalog page');
assert.ok(!reportsSource.includes('<div className="reports-clean-title">Reports Center</div>'), 'Reports Center must not render a duplicate title');
assert.ok(!reportsSource.includes('>Create new report</button>'), 'unsupported report creation must not remain visible');
assert.ok(!reportsSource.includes('aria-label="WBS mock posted JE report impact"'), 'unscoped WBS mock values must not be mixed into entity reports');

console.log('PASS: entity-scoped reports fail closed and preserve explicit return context');
