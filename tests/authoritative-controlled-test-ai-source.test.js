import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/authoritative-controlled-test-ai-workflow.jsx',import.meta.url),'utf8');
assert.match(source,/refreshControlledTestAiSources\(\{config,limit:100,fetcher\}\)/);
assert.doesNotMatch(source,/refreshAuthoritativeSourceDocuments/);
assert.match(source,/\['WBS','REFS_STAGE1'\]\.includes\(row\.source_system\)/);
assert.match(source,/source_module==='payable'/);
assert.match(source,/document_type==='WBS_TEST_PAYABLE'/);
assert.match(source,/status==='POSTED'/);
console.log('controlled TEST_ONLY AI source chooser uses the bounded period-scoped server read');
