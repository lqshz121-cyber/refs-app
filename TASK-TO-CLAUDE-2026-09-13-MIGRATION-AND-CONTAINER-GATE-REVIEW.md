# Claude task: migration and container-gate review

## Authoritative repository

- Repository: `https://github.com/lqshz121-cyber/refs-app.git`
- Branch: `main`
- Local production worktree: `C:\Users\lqshz\Documents\Codex\2026-09-06\task-continuation-019fbdb6-9\work\refs-accounting-settings-authoritative`

The stale `work\refs-app` checkout is not the authoritative code tree. If your mount only exposes that directory, review this task document and GitHub `main`; do not claim a local test result for code you cannot access.

## Review task

1. Inspect `server/compose.attachments.yaml`: MinIO and `mc` image references are being moved from Docker Hub to the verified `quay.io/minio/*` images with the same pinned release tags. Confirm this keeps the attachment test contract intact.
2. Review the production-readiness boundary: no real journals, access roles, secrets, paid Render resources, or QBO/WBS records may be changed. QBO/WBS are reference-only.
3. Inspect the latest GitHub Actions run after the next push. Report separately:
   - attachment container gate result;
   - PostgreSQL 15/16/18 fresh-gate result;
   - any migration name and database error code if failures remain.
4. Review the browser release contract in `src/authoritative-release-gate.js` and `server/runtime/verify-render-staging-release.mjs`: client/API must use the exact same 40-character commit SHA and anonymous API requests must remain denied.

## Reporting format

Provide exact SHA, commands actually run, exit codes, and evidence links. Do not write or push code from the stale checkout.