import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const coa = readFileSync(new URL('./src/module-coa.jsx', import.meta.url), 'utf8');
assert.match(coa, /const \[coaPage, setCoaPage\] = useState\(0\)/, 'COA must own the page that an evidence drill returns to.');
assert.match(coa, /setCoaPage\(Math\.max\(0, Number\(navContext\.coaReturn\.coaPage\) \|\| 0\)\)/, 'Register or GL Back must restore the frozen COA page.');
assert.match(coa, /coaReturn:\{route:'coa',tab:LOCAL_TAB,qboQuery,accountType,coaPage,entityId:entity \|\| ''\}/, 'COA drills must carry page with query and account-type scope.');
assert.match(coa, /onChange=\{e=>\{setQboQuery\(e\.target\.value\);setCoaPage\(0\);\}\}/, 'Changing the name-or-number query must reset COA to page one.');
assert.match(coa, /pageSize=\{200\} page=\{coaPage\} onPageChange=\{setCoaPage\}/, 'COA must follow the observed 200-account page size with a parent-owned page.');
assert.doesNotMatch(coa, /Export CSV|Create account|Edit account|Merge account|Delete account/, 'COA page retention must not introduce mutable account actions.');
console.log('PASS: COA drills retain query, account type, and the observed 200-account page without account mutations.');
