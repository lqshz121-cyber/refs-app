# Claude safety integration audit

Base: `fba0e06cc16d7e2e4cf2ff3c0949063f49a450ab` (exact main).

Read-only sources were Claude's 2026-09-06 handoff and the four named patches.
No code was run in the old dirty collaboration checkout; its locks and work were not changed.

## Accepted slices

- Patch 2 / F1: the production E2E runner really could skip its WeakMap authorization
  when a writeEnabled accessor changed between observations. Retain the existing
  non-forgeable authorization and freeze the observation for authorization, preflight
  metadata, and the write-phase decision. Two changing-accessor regressions assert
  exactly one observation, GET-only execution, and zero simulated effects.
- Patch 1: wire the 23 missing root scripts without deleting current main gates.
  Update stale navigation, controller-read token and parenthesized CASE contracts.
  All existing accounting/no-write assertions remain.
- Patch 3: wire 13 omitted plain Node server suites; retain the explicitly named
  infrastructure suites separately. Include posttest in reachability, unlike the
  original proposal. Update exact BLOCKED-rule tokens and whitespace-only SQL
  patterns without changing thresholds, proposed-line, risk or authority checks.
  Normalize Windows separators in the local manifest retain tool and assert both
  accepted names and rejected wrong-company/suffixed names.
- Integration findings: use esbuild's public buildSync API so the audit mutation
  gate does not assume the installed CLI is JavaScript or a native binary. Add the full root aggregate to PR CI while
  preserving every existing CI step; previously it ran only after main succeeded.

## Rejected as-is: patch 4 / R19

The source-path and byte-integrity defects are real, but the proposed integrity
probe settles only after insertBatch has issued auto-committed pool.query writes.
A mismatch can leave imported data behind. Reimporting the same manifest path can
also leave a prior imported_at timestamp while new row/hash claims have changed.
Checking textual order relative to imported_at does not prove atomic rejection.

R19 is deliberately absent from this commit. A separate slice must guarantee a
single checked-out database client/transaction covers manifest metadata, all row
batches and completion; hash/byte/parsed-row failure must roll back all of them.
It must prove on real isolated PostgreSQL that failed first import leaves no rows,
failed reimport preserves the old committed metadata/data, and successful replay
does not relabel evidence. No live WBS ingestion or production execution is authorized.

## Evidence boundaries

PR #510 exact 67c0bc static job 101396079939 exposed eight root scripts naming
the nonexistent server/tests/migration-manifest.test.mjs. The file was absent both
from Git and the local checkout; a direct local Node 22 invocation with that missing
path plus an existing test nevertheless exited 0 and silently ran only the latter.
The actual normalized up/down checksum contract already lives in the tracked
server/tests/postgres-runtime-contract.test.mjs. All eight references now run that
complete suite; no manifest or accounting assertions were removed.

All 98 root and 115 server scripts were checked for JavaScript input paths against
the exact-case Git index, allowing only bundle outputs generated earlier in the
same script. The new pretest guard failed with all eight missing references before
the repair (exit 1); afterward the guard and real runtime/manifest suite pass 63/63,
zero skip. It also mutation-tests missing, untracked, wrong-case and not-yet-produced
bundle inputs, preventing local files or Node-version behavior from hiding omissions.
Path-fix verification: root npm test exit 0 (1540 pass/0 fail/0 skip, including
all eight previously omitted manifest-suite invocations), server npm test exit 0
(1508 pass/0 fail/162 PG skips), SSR 29/0 and audit 40/40 mutations proved. A build
started concurrently with root tests encountered their shared dist output rewrite;
the required sequential build after root completed passed, including runtime-asset
verification. No code was changed to bypass that assertion. Linux remains a CI gate.

PR #510's exact-69be Linux static job 101395273572 caught that npm can replace
esbuild/bin/esbuild with an ELF executable; invoking that path through Node was
invalid despite passing on Windows. The follow-up uses the public JavaScript API
with identical bundle options and preserves every mutation assertion. A reachable
pretest contract prohibits guessed CLI paths; the actual audit mutation harness
also passes all 40 cases locally. Linux acceptance still requires the next CI run.
Follow-up local exits are all 0: audit-mutations (40/40), root npm test (TAP
1098 pass/0 fail/0 skip), server npm test (1508 pass/0 fail/162 PG skips), build
and runtime-asset verification. The focused reachability/API contract is 6/6.

The two new F1 getter tests were also run against an isolated copy of the exact
main runner: both failed with AUTHORIZED_ACCOUNTING_WRITES_COMPLETED instead of
PREFLIGHT_ONLY (expected red). The integrated focused tests pass 61/61, zero skip.
Final local gates: root npm test exit 0 (TAP pass 1097/fail 0/skip 0, plus
SSR 29/0, audit 119/119 entities and 3955 JEs with zero failures, and real audit
mutation harness); server npm test exit 0 (pass 1508/fail 0/skip 162); npm run
build and runtime deployment-asset verification exit 0. TAP totals may include
intentional duplicate suites; they are not distinct-test coverage counts.

Focused runner/contracts are local mocked or static tests, not production receipts.
The local Docker Linux daemon is unavailable (named pipe not found), and the
ordinary server aggregate explicitly skips 162 PostgreSQL tests without a database.
Only the separate fresh PostgreSQL 15/16/18 CI gates can supply zero-skip database
evidence here. No migrations, accounting authority, identity, UI or deployment
were changed by this slice; no merge or deployment was performed.
