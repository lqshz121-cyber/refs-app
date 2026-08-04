import { strict as assert } from 'node:assert';
import { englishOnlyVisibleText } from './src/english-only-text.js';

assert.equal(englishOnlyVisibleText('Integration Hub'), 'Integration Hub');
assert.equal(englishOnlyVisibleText('闆嗘垚涓績 Integration Hub'), 'Integration Hub');
assert.equal(englishOnlyVisibleText('璐﹀崟'), 'Local evidence');
assert.equal(englishOnlyVisibleText('Bill 搴斾粯璐﹀崟'), 'Bill');
console.log('english-only visible-text verification passed');
