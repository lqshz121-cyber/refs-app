import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reports = readFileSync(new URL('./src/modules-more.jsx', import.meta.url), 'utf8');
assert.doesNotMatch(reports, /toggledReportFavorites|normalizeReportFavorites|refs_report_favorites|toggleFavorite|favorite toggled|Added to favorites|More Options|qbo-more-menu/, 'Reports Center must not persist favorites or expose report management actions.');
assert.doesNotMatch(reports, /refs_local_report_scopes|Save local scope|Saved local report scope|Report refreshed|Local report view refreshed|Drill report refreshed|Source trace controls opened/, 'Reports must not persist a view or expose refresh-like report controls.');
assert.match(reports, /favorites and report menus unavailable/, 'The read-only report boundary must be visible.');
assert.match(reports, /Refresh, save view, density, customization, comparison, automated insights, email, print and export/, 'The unavailable read-only report boundary must be visible.');
assert.match(reports, /Core financial reports/, 'Core report category must remain available.');
for (const name of ['Trial Balance','GL Detail','Balance Sheet','Income Statement','Cash Flow']) assert.match(reports, new RegExp(name), `${name} must remain launchable.`);
assert.match(reports, /Back to Reports Center/, 'Report details must retain a full-page Back path.');
assert.match(reports, /setSearch/, 'Catalog search must remain functional.');
console.log('PASS: Reports Center removes favorite/menu mutation while retaining core report catalog, search, launch and full-page Back.');
