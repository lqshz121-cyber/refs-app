# WBS twelve-sample manual acceptance workbook (N31)

Template for the human working paper behind matrix row **D3**. It tells a reviewer exactly what to
look at, in what order, and what to write down, so that the five boolean attestations consumed by
`server/runtime/wbs-twelve-sample-acceptance.mjs` are earned rather than asserted.

- Collection sequence and prohibitions: `server/WBS-TWELVE-SAMPLE-EVIDENCE-INTAKE-PLAN-2026-09-14.md`.
- Machine check: `node server/tools/verify-wbs-twelve-sample-acceptance.mjs --manifest <path>`.
- Blank manifest skeleton: `server/fixtures/wbs-twelve-sample-acceptance-template.json`.
- Structure pinned by: `server/tests/wbs-twelve-sample-workbook-contract.test.mjs`.

## 0. Standing rules

1. **Never write to WBS.** Every step below is a read. A step that cannot be completed read-only is
   failed, not worked around.
2. **This file carries no real figures.** Amounts, counterparties, account numbers and company names
   from the live source stay out of the repository. The workbook records *identifiers and hashes*;
   the amounts live in the completed working paper held outside source control.
3. The completed manifest is produced **outside source control** and is never committed.
4. A verifier PASS proves the manifest's internal evidence contract only. It is not production
   acceptance: that additionally needs independent verification of the provider package,
   authenticated read-back, the exact release SHA, and retained source artifacts.
5. A reviewer may not sign a sample they staged, reviewed, approved or posted. One reviewer may not
   sign more than four of the twelve samples.

## 1. Sample selection

Twelve samples, chosen before any evidence is collected and recorded with the reason for choice.
Minimum spread - a sample may satisfy at most two rows:

| # | Required characteristic |
|---|---|
| S-1 | Bank row matched 1:1 to one business row |
| S-2 | Bank row split across two or more business rows |
| S-3 | Business row settled by two or more bank rows |
| S-4 | Row that entered the exception queue and was cleared by manual review |
| S-5 | Row whose mapping version changed between normalization and staging |
| S-6 | Intercompany / internal transfer pair |
| S-7 | Row carrying an auxiliary (member) dimension on every sub-ledger line |
| S-8 | Row that produced a 291001 two-step clearing chain |
| S-9 | Row at a period boundary (posted in the period following its source date) |
| S-10 | Row with an attachment / source document binding |
| S-11 | Row whose first Draft was rejected, then re-drafted |
| S-12 | Largest absolute amount in the snapshot window |

## 2. Per-sample check steps

Run all fourteen for each sample. Every step is PASS / FAIL / N-A with a written note; **any FAIL
blocks the whole manifest**, not just that sample. Steps are ordered so an earlier failure makes the
later ones pointless.

| # | Step | Read from | Written down |
|---|---|---|---|
| C1 | Provider snapshot package hash recomputed from retained bytes | retained package | `package_hash` |
| C2 | Provider signature verified against the pinned key | signature verification | `signed_package_evidence` (reference, content hash, verification id, key id, algorithm, verified at) |
| C3 | `signed_package_evidence.content_hash` equals `package_hash` | both of the above | - (verifier re-checks) |
| C4 | Raw events immutable: no UPDATE / DELETE grant, hash chain intact | `wbs_raw_event` triggers | `bank_raw_event_id`, `business_raw_event_id` |
| C5 | Normalization is deterministic: re-running the normalizer on the retained bytes reproduces the staged row byte-for-byte | normalizer | mapping / rule version |
| C6 | Staged row traces back to exactly one raw event on each side | staging | `bank_staging_item_id`, `business_staging_item_id` |
| C7 | Source document binding present and resolvable | source documents | `bank_source_document_id`, `business_source_document_id` |
| C8 | Exception queue state is terminal and cleared by a named human, not by a job | exception queue | note the clearing actor |
| C9 | Human review exists on both sides and precedes posting | review events | `bank_review_event_id`, `business_review_event_id`, `bank_reviewed_at`, `business_reviewed_at` |
| C10 | Draft JE was produced by the controlled workflow; AI proposed nothing that posted itself | draft / journal workflow | - |
| C11 | Posted journal: balanced, six-digit accounts, every auxiliary line carries a member, Draw = Dr Cash / Cr Loan where applicable | journal entry lines | `bank_journal_entry_id`, `business_journal_entry_id`, `bank_posted_at`, `business_posted_at` |
| C12 | Audit event exists for the post on both sides, with a distinct actor from the reviewer | audit events | `bank_audit_event_id`, `business_audit_event_id` |
| C13 | Report figure -> ledger -> JE -> business object -> raw event round trip closes, and the control total matches | report | `report_id`, `control_total_hash` |
| C14 | Authenticated HTTPS read-back of the posted result returns 2xx and its response hash is recorded | authoritative API | `authoritative_api_readback_evidence` (endpoint, response hash, authenticated subject, read at, http status) |

Mapping from check steps to the manifest booleans:

| Manifest field | Earned by |
|---|---|
| `signed_package_verified` | C1, C2, C3 |
| `manual_review_completed` | C8, C9, C10 |
| `g11_posted_trace_verified` | C4, C5, C6, C7, C11, C12 |
| `gl_report_control_total_matched` | C13 |
| `authoritative_api_readback_verified` | C14 |

## 3. Per-sample field roster

Twenty-four scalar fields per sample. Bank-side and business-side identifiers must differ within a
sample, and every identifier below (except `company_code`) must be unique across all twelve samples.

| Field | Meaning |
|---|---|
| `sample_id` | Workbook sample identifier, `^[A-Z0-9][A-Z0-9_-]{2,63}$` |
| `company_code` | Entity code, `^[A-Z0-9][A-Z0-9_-]{1,63}$` |
| `package_hash` | `sha256:` digest of the provider package |
| `snapshot_id` | UUID of the snapshot the sample was drawn from |
| `bank_source_record_id` | Bank-side source record |
| `business_source_record_id` | Business-side source record |
| `bank_staging_item_id` | Bank-side staged row |
| `business_staging_item_id` | Business-side staged row |
| `bank_review_event_id` | Bank-side human review event |
| `business_review_event_id` | Business-side human review event |
| `bank_source_document_id` | Bank-side source document |
| `business_source_document_id` | Business-side source document |
| `bank_raw_event_id` | Bank-side raw event |
| `business_raw_event_id` | Business-side raw event |
| `bank_journal_entry_id` | Bank-side Posted journal |
| `business_journal_entry_id` | Business-side Posted journal |
| `bank_audit_event_id` | Bank-side audit event |
| `business_audit_event_id` | Business-side audit event |
| `report_id` | Report the control total was read from |
| `control_total_hash` | `sha256:` digest of the control total |
| `bank_reviewed_at` | UTC instant, `YYYY-MM-DDTHH:MM:SS.sssZ`, no later than `bank_posted_at` |
| `business_reviewed_at` | UTC instant, no later than `business_posted_at` |
| `bank_posted_at` | UTC instant |
| `business_posted_at` | UTC instant |

Plus five booleans (section 2) and two evidence objects: `signed_package_evidence` and
`authoritative_api_readback_evidence`.

## 4. Manifest header

| Field | Value |
|---|---|
| `schema_version` | `WBS_TWELVE_SAMPLE_ACCEPTANCE_V1` |
| `release_sha` | the 40-character lowercase commit the evidence was read against |
| `verified_at` | UTC instant the manifest was assembled |
| `samples` | exactly 12 |

## 5. Refusal codes

When the verifier refuses, the reviewer records the code and the failing sample rather than editing
the manifest to make it pass.

| Code | Meaning |
|---|---|
| `WBS_TWELVE_SAMPLE_MANIFEST_INVALID` | header wrong, or sample count not 12 |
| `WBS_TWELVE_SAMPLE_INVALID` | a sample field is missing, malformed, over-long, or reused between the bank and business side |
| `WBS_TWELVE_SAMPLE_INCOMPLETE` | one of the five attestations is not `true` |
| `WBS_TWELVE_SAMPLE_REVIEW_ORDER_INVALID` | a timestamp is not a UTC instant, or review is later than posting |
| `WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE` | an identifier is reused across samples or across categories |
| `WBS_TWELVE_SAMPLE_SIGNED_PACKAGE_EVIDENCE_INVALID` | signature evidence malformed, or its content hash is not `package_hash` |
| `WBS_TWELVE_SAMPLE_API_READBACK_EVIDENCE_INVALID` | read-back not authenticated HTTPS 2xx with a response hash |
| `WBS_TWELVE_SAMPLE_ARGUMENT_INVALID` | CLI not called as `--manifest <path>` |
| `WBS_TWELVE_SAMPLE_MANIFEST_MISSING` | manifest path does not exist |

## 6. Sign-off

Copy this block twelve times; one per sample.

```
sample_id:            ____________________
selection reason:     ____________________  (which row of section 1)
C1..C14:              ____________________  (PASS / FAIL / N-A each, with notes)
exceptions raised:    ____________________
reviewer:             ____________________  (not the stager / approver / poster)
reviewed at (UTC):    ____________________
```

Manifest-level sign-off:

```
release_sha:          ____________________
verifier command:     node server/tools/verify-wbs-twelve-sample-acceptance.mjs --manifest <path>
verifier exit code:   ____________________
manifest_hash:        ____________________
Owner accepted:       [ ]       date: ____________________
```

## 7. What this workbook does not prove

Being read-only and offline it cannot establish: that the WBS channel used was the authorized one;
that the pinned provider key is the real provider's; that the staging environment the read-back hit
is the release under acceptance; or anything about production. Those remain Owner-held live
read-backs, and matrix row D3 stays short of `DONE` until they exist.
