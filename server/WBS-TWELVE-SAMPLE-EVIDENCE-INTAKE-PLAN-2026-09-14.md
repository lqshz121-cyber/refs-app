# WBS twelve-sample evidence intake plan — 2026-09-14

## Current evidence status

The repository contains a strict verifier and passing local contract tests. It does **not** contain an actual twelve-sample manifest or provider-signed WBS packages. Therefore WBS twelve-sample production acceptance is **not achieved**.

## Required evidence for each of 12 distinct samples

- Provider-signed immutable WBS snapshot package and its SHA-256.
- A distinct snapshot, bank source record, business source record, raw event, staging item, review event, source document, Posted journal, audit event, report identifier, and control-total hash.
- Human review completed before Draft/Posted progression.
- Authenticated HTTPS API readback with subject, read timestamp, response hash, and 2xx status.
- Evidence references must be immutable (`object://`, `s3://`, `gs://`, `az://`, or HTTPS) and include the signing key ID, algorithm, verification ID, and verification time.

## Read-only collection sequence

1. Capture each provider snapshot through the authorized WBS read-only channel; preserve raw bytes unchanged.
2. Verify the provider signature against the pinned provider key, record package hash, then normalize and stage without auto-posting.
3. Require a human review record for both source sides and preserve its event IDs.
4. Obtain authenticated API readback after the controlled Draft/Posted workflow, then create a manifest outside source control.
5. Run `node server/tools/verify-wbs-twelve-sample-acceptance.mjs --manifest <approved-manifest.json>`.

A PASS proves the manifest's internal evidence contract only. Production acceptance additionally requires independent verification of the provider package, authenticated readback, exact release SHA, and retained source artifacts.

## Prohibited

- No WBS writes, posting, role changes, credentials, synthetic package substitution, report-derived formal journals, or sample reuse.