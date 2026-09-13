# Refs unified agent and Chatbox coordination plan — 2026-09-14

## Current authority

- Repository: `lqshz121-cyber/refs-app`
- Active review branch: `codex/374-postgres-syntax-verify`
- Review head: `ed8c1acdef60bb1f13ec9fbd59370e853541d8ee`
- Review PR: #582 (draft; never merge or deploy from this plan)
- Authoritative implementation worktree: `C:\Users\lqshz\Documents\Codex\2026-09-06\task-continuation-019fbdb6-9\work\refs-accounting-settings-authoritative`

## Completed agent receipts and disposition

| Workstream | Agent receipt | Finding / artifact | Disposition |
| --- | --- | --- | --- |
| Attachment and Render acceptance | `claude_attachment_workflow` | Acceptance task wording distinguishes functional SHA from handoff SHA. | Retain as deployment evidence only; re-read head SHA at actual acceptance. No deployment or paid resource change. |
| Authoritative navigation and startup usability | `claude_navigation_usability` | Commit `0143429d14ce62aba1abb369bab7f8f25677f5de`: block data reads when API release differs from UI build SHA. | Candidate change; review against the authoritative head before any cherry-pick. |
| Settlement migration contract | `claude_settlement_contract` | P0: migration 305 history/content must remain immutable; rollback must fail closed when retained settlement records exist. | Current priority. Prove exact deployed-history compatibility and repair through a new forward migration if needed; never rewrite applied migration bytes or checksums. |

## Immediate execution lanes

1. **P0 — PostgreSQL fixture closure and migration integrity**
   - Owner: Codex primary.
   - Evidence required: complete GitHub logs for run `34768858195`, local fixture receipt, migration history byte/hash comparison, and fresh PostgreSQL results.
   - Rule: no overwrite of applied `305_native_settlement_command.sql`; additive migration only for production-safe remediation.

2. **P1 — Release identity and navigation safety**
   - Owner: review lane after P0 is green.
   - Input: candidate `0143429d`.
   - Evidence required: focused test plus no pre-auth/accounting read before release identity agreement.

3. **P2 — Claude mounted-checkout review**
   - Owner: Claude read/write session.
   - Input: root-level task `TASK-TO-CLAUDE-2026-09-14-MOUNT-ROUTING-REVIEW.md` already copied to its actual mount.
   - Output required: `CLAUDE-TO-CODEX-2026-09-14-MOUNT-ROUTING-REVIEW.md` with visible paths and capability facts only.

4. **Deferred external evidence lanes**
   - WBS 12-sample evidence and Render production acceptance require authenticated, read-only source evidence or explicit deployment authorization. Prepare evidence packets only; do not access WBS/QBO, modify Render, create paid resources, or post accounting data.

## Integration rules

- One primary branch owns P0 fixes; candidate branches remain isolated until focused review and tests pass.
- A green UI/unit gate does not prove production accounting readiness.
- Every result must state exact SHA, commands, exit status, and scope limits.
- No agent may merge PR #582, deploy, alter roles/secrets, incur paid service cost, or create/post actual accounting transactions.

## Current blocking facts

- GitHub PostgreSQL business-closure job has failed; detailed log is unavailable until the overall workflow reaches a terminal status.
- PostgreSQL 15/16/18 matrix jobs are still running.
- Claude's mounted environment can read/write but cannot execute Git, Node, Docker, or test commands.

## 2026-09-14 P0 execution receipt

- Local commit `a62ed503f31589448986aa058ae348b900c54fcd` corrects two test-gate defects without modifying any SQL migration or manifest checksum:
  - fixture tests now have a 150-second Node test budget and a separate bounded process watchdog;
  - migration 329 round-trip now explicitly asserts that its own down script removes the function and its up script restores it.
- Local evidence:
  - `node --test tests/postgres-fixture-suite.test.mjs` — exit 0, 7/7 passed.
  - `node runtime/run-postgres-fixture-suite.mjs --fixture ar-rent-pickup-close` — exit 0, 1/1 passed, total 149248ms.
  - `node runtime/run-postgres-fixture-suite.mjs --fixture signed-wbs-payable-post` — exit 0, 1/1 passed, total 91381ms.
- Remote push is pending: two attempts to `github.com:443` failed with connection timeout. Do not treat the local commit as PR-integrated or CI-verified until push succeeds and a new GitHub Actions run is green.
## QB interface workstream receipt

A separate QB-interface workstream reports local authoritative-shell scope labels, refresh/theme action grouping, and a 44px mobile period touch target implemented with focused shell, navigation accessibility, visual parity, release-harness, runtime-config, and build checks passing. Full `npm test` was preflight-blocked because that candidate worktree is not clean. QBO browser automation is unavailable (`nodeRepl.fetch request failed`), so there is no new authenticated QBO evidence. Treat this as an isolated candidate pending clean-worktree validation and review; it is not production acceptance.