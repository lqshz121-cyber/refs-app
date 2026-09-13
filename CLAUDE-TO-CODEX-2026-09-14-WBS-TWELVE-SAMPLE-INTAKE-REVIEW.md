# WBS twelve-sample intake static review

- Mounted checkout: `C:\Users\lqshz\Documents\Codex\2026-09-06\task-continuation-019fbdb6-9\work\refs-accounting-settings-authoritative`
- Task reviewed: `TASK-TO-CLAUDE-2026-09-14-WBS-TWELVE-SAMPLE-INTAKE-REVIEW.md` (dispatched by Codex)
- Files reviewed: `server/WBS-TWELVE-SAMPLE-EVIDENCE-INTAKE-PLAN-2026-09-14.md`, `server/runtime/wbs-twelve-sample-acceptance.mjs`
- Review type: read-only static comparison. No WBS, QBO, Render, provider, database, Docker, Git mutation, Node, npm, or test command was run.

## Commands and exit status

`Get-Content -LiteralPath <file> -Raw` reads of both files completed with exit code 0. No application, migration, or test file was changed. No runtime result is claimed.

## Consistent requirements

- Both documents require exactly 12 samples (`SAMPLE_COUNT=12` in the verifier and `samples.length===SAMPLE_COUNT`), with unique sample IDs and per-category evidence identifiers.
- The plan's provider-signed immutable reference requirements map to `signed_package_evidence`: immutable `object://`, `s3://`, `gs://`, `az://`, or HTTPS reference, SHA-256 content hash, verification ID, signing key ID, approved algorithm, and verified UTC timestamp.
- The plan's authenticated readback requirements map to `authoritative_api_readback_evidence`: HTTPS endpoint without embedded credentials, response hash, authenticated subject, read timestamp, and an HTTP 2xx status.
- The verifier additionally enforces signed-package `content_hash === sample.package_hash`, all five completion booleans, strict sample/package/snapshot/control hashes, and a 12-sample release envelope.
- The plan correctly states that the repository has no actual twelve-sample provider manifest and that a local verifier PASS would only prove the manifest's internal contract.

## Gaps or risks found

1. **Review ordering is not verifiable.** The plan requires human review before Draft/Posted progression. The verifier only accepts `manual_review_completed === true`; it has no review timestamp, Draft/Posted timestamp, or ordering relation to prove “before.” The two review-event IDs are required, but their temporal semantics are not checked.

2. **Distinctness is narrower than the prose may imply.** The verifier applies uniqueness separately for each key in `allKeys`. It rejects bank-versus-business equality for source-record, staging-item, and journal IDs within one sample, but it does not reject bank/business equality for review-event, source-document, raw-event, or audit-event IDs. It also permits a value used under one key (for example a sample's bank source ID) to reappear under a different key in another sample. If “distinct” and “no sample reuse” mean globally distinct evidence objects across all categories, this is an under-enforcement.

3. **Length guards contain a JavaScript precedence defect.** Conditions such as `!text(value.verification_id).length>256`, `!text(value.key_id).length>256`, and `!text(value.authenticated_subject).length>512` negate the numeric length before comparing it to 256/512. They therefore do not reject overlong non-empty values. The plan does not state these bounds, but the verifier's apparent bounds are ineffective and should be corrected or removed deliberately.

4. **Package integrity is linked by supplied hash equality only.** The verifier checks `signed_package_evidence.content_hash === sample.package_hash`, but it does not recompute a hash from retained package bytes (none are present in the plan) or cryptographically verify the provider signature. The plan acknowledges that independent provider-package verification remains necessary.

5. **The plan's “PASS” boundary is accurately narrower than production acceptance.** The verifier returns `requires_authenticated_api_e2e:true`, and the plan explicitly requires independent provider verification, authenticated readback, exact release SHA, and retained artifacts. No actual twelve-sample manifest or provider-signed package is present in the reviewed checkout, so production acceptance is not achieved.

## Conclusion and limits

The intake plan and verifier are substantially aligned on sample count, immutable references, hashes, signed-package metadata, authenticated HTTPS readback, and fail-closed completion flags. They are not fully equivalent for review-before-post ordering or the strongest interpretation of globally distinct evidence. The verifier's overlength checks for verification/key/subject text are currently ineffective due to operator precedence. These are static findings only; this review cannot establish applied runtime behavior, CI status, provider signatures, authenticated live readback, or production acceptance.
