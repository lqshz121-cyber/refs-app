# TASK-TO-CLAUDE-2026-08-06-005

**Priority:** P0
**Owner category:** Runtime safety / front-end boundary
**Status:** OPEN
**Integration owner:** Codex

## Frozen base and branch

Create an isolated worktree from the current frozen remote base `origin/main` at `19294ee`
(or the newer SHA explicitly supplied by Codex when claiming the task).

Branch name:

```text
claude/runtime-explicit-mock-failclosed-20260806
```

Record `CLAIMED`, exact base SHA and worktree path before editing.

## Problem

The application currently enters the local demonstration/seed application for every runtime mode
that is not exactly `REQUIRES_AUTHORITATIVE_API`. A missing runtime config, unknown mode, stale
lock/config script or malformed configuration must never expose demonstration accounting data in
authoritative deployment.

## Exact scope

Change only the runtime-mode selection and its focused regression coverage.

Required outcome:

```text
explicit LOCAL_MOCK                 => local mock application
explicit REQUIRES_AUTHORITATIVE_API => authoritative application
missing/unknown/malformed mode      => visible fail-closed configuration error
missing/stale/invalid config/lock   => visible fail-closed configuration error
```

Use existing runtime lock/config primitives. Do not introduce a parallel configuration system.

## Strict exclusions

- no API/OpenAPI, server, migration, SQL, RLS or accounting-state-machine changes;
- no change to WBS lineage, WBS transport, provider contracts or mock fixtures;
- no seed/localStorage fallback that hides an error;
- no visual system refactor beyond the small error state necessary for this failure mode;
- no push to `main`, deployment or release claim.

## Acceptance criteria

1. A unit/verifier regression demonstrates each of these cases: `LOCAL_MOCK`, authoritative,
missing mode, unknown mode, malformed mode, missing config and invalid/stale lock.
2. The local mock path is reachable only through an explicit `LOCAL_MOCK` stamp.
3. Authoritative mode never silently falls back to a seed/localStorage workspace on any error.
4. Error copy is English-only, actionable and reveals no API/internal secret detail.
5. Existing runtime-config, OIDC, API-client, SSR and English gates continue to pass.

## Required commands

Run the existing focused runtime tests plus:

```powershell
npm.cmd run test:runtime-config
npm.cmd run test:oidc
npm.cmd run test:api-client
npm.cmd run test:ssr
npm.cmd run build
git diff --check
```

If the repo’s aggregate `npm.cmd test` can run in the actual worktree, run it and report its
exact exit code. Do not describe a skipped dependency/container check as passed.

## Completion block

Return:

```text
SHA/base:
branch/worktree:
changed files:
tests + exact exit codes:
failure cases proved:
known risks:
PASS / PARTIAL / FAIL:
next:
```
