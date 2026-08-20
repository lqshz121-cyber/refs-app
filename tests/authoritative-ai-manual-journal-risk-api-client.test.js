import assert from 'node:assert/strict';
import { refreshAuthoritativeAiManualJournalRisks, retainAuthoritativeAiManualJournalRisks } from '../src/accounting-api.js';

const id = (n) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = `sha256:${'a'.repeat(64)}`;
const config = { baseUrl: 'https://accounting.example', entityId: id(1), periodId: id(2), getAccessToken: async () => 'a'.repeat(48) };
const actions = { can_create_draft: false, can_review: false, can_approve: false, can_post: false };
const policy = { schema_version: 'AI_MANUAL_JOURNAL_RISK_POLICY_V1', setting_snapshot_id: id(3), setting_snapshot_hash: hash, policy_version: 1, large_manual_journal_threshold: '10000.0000', round_amount_increment: '100.0000' };
const finding = {
  schema_version: 'AI_MANUAL_JOURNAL_RISK_FINDING_V1', finding_type: 'MANUAL_JOURNAL_RISK', risk_level: 'HIGH',
  rule_ids: ['MANUAL_JE_LARGE_NO_ATTACHMENT', 'MANUAL_JE_ROUND_AMOUNT_PATTERN'], journal_entry_id: id(10), journal_number: 'JE-2026-001',
  entity_id: id(1), accounting_period_id: id(2), journal_date: '2026-08-19', currency: 'USD', total_debits: '50000.0000', total_credits: '50000.0000',
  attachment_count: 0, source_document_ids: [], source_payload_hashes: [], line_ids: [id(11), id(12)],
  reason: 'A large manual Journal Entry has no retained attachment or source document evidence.',
  suggested_action: 'Require an independent Controller to inspect the complete journal, supporting source documents, account mapping, member trace, business purpose, and approval history before any further workflow action.',
  confidence: 0.99, owner_role: 'CONTROLLER_REVIEW', due_basis: 'BEFORE_APPROVAL_OR_PERIOD_CLOSE',
  required_human_fields: ['business_purpose', 'source_support', 'account_mapping', 'member_trace', 'preparer_approver_separation', 'resolution_reason'],
  policy_evidence: policy, action_flags: actions,
};

let request;
const read = await refreshAuthoritativeAiManualJournalRisks({
  config, limit: 25,
  fetcher: async (url, init) => (request = { url, init }, { ok: true, status: 200, json: async () => ({ ok: true, data: { schema_version: 'AI_MANUAL_JOURNAL_RISK_BATCH_V1', current_accounting_period_id: id(2), scanned_journal_count: 1, finding_count: 1, findings: [finding], action_flags: actions } }) }),
});
assert.equal(read.ok, true);
assert.match(request.url, /manual-journal-risks/);
assert.equal(request.init.cache, 'no-store');
assert.equal(read.data.findings[0].action_flags.can_post, false);

const rejected = await refreshAuthoritativeAiManualJournalRisks({
  config,
  fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { schema_version: 'AI_MANUAL_JOURNAL_RISK_BATCH_V1', current_accounting_period_id: id(2), scanned_journal_count: 1, finding_count: 1, findings: [{ ...finding, raw_prompt: 'secret' }], action_flags: actions } }) }),
});
assert.equal(rejected.ok, false);
assert.equal(rejected.code, 'AI_MANUAL_JOURNAL_RISK_PROTOCOL');

const missingExplanation = await refreshAuthoritativeAiManualJournalRisks({
  config,
  fetcher: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { schema_version: 'AI_MANUAL_JOURNAL_RISK_BATCH_V1', current_accounting_period_id: id(2), scanned_journal_count: 1, finding_count: 1, findings: [{ ...finding, reason: null }], action_flags: actions } }) }),
});
assert.equal(missingExplanation.ok, false);
assert.equal(missingExplanation.code, 'AI_MANUAL_JOURNAL_RISK_PROTOCOL');

const receipt = { schema_version: 'AI_MANUAL_JOURNAL_RISK_RUN_RECEIPT_V1', accounting_period_id: id(2), row_count: 1, inserted_count: 1, replayed_count: 0, finding_ids: [id(44)], request_hash: hash, can_create_draft: false, can_review: false, can_approve: false, can_post: false, idempotent: false };
const retained = await retainAuthoritativeAiManualJournalRisks({
  config, limit: 25, idempotencyKey: 'manual-je-risk-001',
  fetcher: async (url, init) => (request = { url, init }, { ok: true, status: 201, json: async () => ({ ok: true, data: receipt }) }),
});
assert.equal(retained.ok, true);
assert.equal(request.init.headers['idempotency-key'], 'manual-je-risk-001');
assert.equal(retained.data.can_post, false);
console.log('authoritative AI manual Journal risk client tests passed');
