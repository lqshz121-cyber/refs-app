import assert from 'node:assert/strict';
import { REPORT_BUSINESS_SCOPE, isReportCapabilityExcluded } from './src/report-business-scope.js';

assert.ok(REPORT_BUSINESS_SCOPE.included.some(item => item.includes('GL/TB')));
assert.ok(REPORT_BUSINESS_SCOPE.included.some(item => item.includes('payables')));
assert.equal(isReportCapabilityExcluded('Spreadsheet sync'), true);
assert.equal(isReportCapabilityExcluded('Sales performance'), true);
assert.equal(isReportCapabilityExcluded('Amazon marketplace connector'), true);
assert.equal(isReportCapabilityExcluded('Create new report'), true);
assert.equal(isReportCapabilityExcluded('Report sharing'), true);
assert.equal(isReportCapabilityExcluded('Customize report columns'), true);
assert.equal(isReportCapabilityExcluded('Automated KPI insights'), true);
assert.equal(isReportCapabilityExcluded('Profit and Loss'), false);
console.log('report business scope: included and excluded capability boundaries verified');
