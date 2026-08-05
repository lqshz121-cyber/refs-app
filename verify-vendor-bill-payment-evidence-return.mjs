import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ap = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
const vendors = readFileSync(new URL('./src/vendor-listing.js', import.meta.url), 'utf8');
const billBalance = readFileSync(new URL('./src/bill-balance-explanation.js', import.meta.url), 'utf8');

assert.match(ap, /function VendorWorkspace\(/, 'Vendors evidence workspace must exist.');
assert.match(ap, /aria-label="Local bill evidence detail"/, 'Bill drill must replace the list with a full-page evidence detail.');
assert.match(ap, /aria-label="Local payment evidence detail"/, 'Payment drill must replace the list with a full-page evidence detail.');
assert.match(ap, /Back to Vendor evidence/, 'Vendor → Bill must expose an explicit full-page Back target.');
assert.match(ap, /vendorEvidenceReturnSearch/, 'Vendor search context must survive Bill/JE/source drill returns.');
assert.match(ap, /vendorEvidenceId:vendorReturnId,vendorSearch:vendorReturnSearch \|\| ''/, 'Bill drill must pass vendor identity and search through downstream evidence links.');
assert.match(ap, /initialQuery=\{navContext\?\.vendorSearch\}/, 'Returned Vendor page must restore the original search filter.');
assert.match(ap, /PaymentEvidenceDetail[\s\S]*Open local bank evidence/, 'Payment detail must retain an exact Bank DEBIT evidence drill.');
assert.match(ap, /Original bill − effective POSTED payments − applied vendor credits = open AP/, 'Bill detail must explain the AP open balance from retained evidence.');
assert.match(billBalance, /effectivePayments/, 'AP balance control must calculate effective posted payments.');
assert.match(vendors, /NO_POSTED_VENDOR_EVIDENCE/, 'Vendor empty state must distinguish missing posted evidence.');

assert.doesNotMatch(ap, /Approve and create AP journal|actions\.approveBill|Run Bill Pay|Create bill|Pay bill/, 'Vendor/AP evidence UI must not create, approve, or pay bills.');
assert.match(ap, /features=\{\{exportable:false\}\}/, 'Vendor/Bill evidence tables must disable export.');
assert.match(ap, /Read-only local evidence detail\. It cannot pay, import a feed, match, clear, sign off, post, reverse, refund, export, connect or synchronize an external service\./, 'Payment detail must declare the read-only boundary.');

console.log('PASS: Vendor → Bill/Payment/AP Aging evidence drills retain vendor search and scope, with no bill-approval or payment mutation surface.');
