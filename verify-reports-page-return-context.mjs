import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reports = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
const reportsCenter = reports.slice(reports.indexOf('export function Reports({ctx})'));
assert.match(reports, /const \[reportPage, setReportPage\] = useState\(Math\.max\(0, Number\(reportsReturn\?\.reportPage\) \|\| 0\)\)/, 'Reports must retain its parent-owned catalog page.');
assert.match(reports, /reportCenterReturn:\{route:'reports',reportName:tab,category,search,reportPage\}/, 'GL reports must preserve the exact catalog page.');
assert.match(reports, /route:'reports', reportName:'Cash & Restricted Cash Control', category, search, reportPage/, 'Control-report drills must preserve the exact catalog page.');
assert.match(reports, /onChange=\{e=>\{setSearch\(e\.target\.value\);setReportPage\(0\);\}\}/, 'Changing catalog search must reset the report page.');
assert.match(reports, /pageSize=\{12\} page=\{reportPage\} onPageChange=\{setReportPage\}/, 'Catalog paging must stay parent-owned across full-page replacement.');
assert.doesNotMatch(reportsCenter, /Export CSV|Save report|Share report|Customize report/, 'Reports Center retention must not introduce report mutation or delivery actions.');
console.log('PASS: Reports full-page detail restores category, search, and exact catalog page without mutable report actions.');
