# Accounting period status: the SOFT_CLOSED contract (R09)

Task: `TASK-TO-CLAUDE-2026-09-17-NEXT-R01-R30-codex009.md` — R09 "SOFT_CLOSED 期间持久化语义、
权限、操作矩阵和拒绝测试".

Evidence: live PostgreSQL 16.14 (embedded), migrations `001..425` applied clean (431 completed),
synthetic tenant only. Probe scripts and raw logs are in the R09 evidence folder referenced by the
receipt. Static contract: `server/runtime/period-status-contract.mjs`,
`server/tests/period-status-contract.test.mjs`.

## 1. What is actually persisted

`001_wbs_accounting_core.sql`:

```sql
CREATE TYPE period_status AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');
...
status period_status NOT NULL DEFAULT 'OPEN',
CHECK ((status = 'OPEN' AND closed_at IS NULL) OR status <> 'OPEN')
```

The only table constraint tying status to close evidence is the `OPEN ⇒ closed_at IS NULL` check.
A `SOFT_CLOSED` row with `closed_by IS NULL AND closed_at IS NULL` is therefore storable, and the
live probe stored one. There is no constraint that would reject it, and no partial index or trigger
that notices it.

## 2. Nothing can produce SOFT_CLOSED, and nothing can leave it

Introspecting `pg_proc` on the migrated database: **258** functions reference `accounting_period`,
**83** of them carry a period guard, and exactly **three** write `accounting_period.status`:

| Function | Writes | Accepts |
|---|---|---|
| `refs_close_period` (legacy, 002) | `CLOSED` | `status='OPEN'` only |
| `refs_close_period_v2` (289) | `CLOSED` | `status='OPEN'` only |
| `refs_reopen_period_v1` (293) | `OPEN` | `status='CLOSED'` **and** retained close evidence |

So `SOFT_CLOSED` is **unreachable** through any command, and if a row reaches it by a privileged
direct write, an import, or a restore, it is **terminal**: close rejects it (needs OPEN), reopen
rejects it (needs CLOSED), and every posting path rejects it. There is no operator exit short of a
DBA-level `UPDATE`, which is exactly the class of action period control exists to prevent.

## 3. Permissions

`permission_catalog` contains `GL.PERIOD.CLOSE` (sod_class `PERIOD_CLOSE`) and `GL.PERIOD.REOPEN`
(sod_class `PERIOD_REOPEN`, authority class `REOPEN`). There is **no** soft-close permission, no
soft-close SoD class, and no soft-close idempotency scope — `refs_reserve_idempotency` allows
`CLOSE_PERIOD:%` and `REOPEN_PERIOD:%` and nothing else for periods.

## 4. Operation matrix (live, synthetic tenant)

Same period row, same actors, status forced to each value in turn.

| Operation (permission / function) | OPEN | SOFT_CLOSED | CLOSED |
|---|---|---|---|
| `refs_create_manual_journal` (`GL.JE.CREATE`) | admitted past the period gate (Draft created) | **55000** `Journal date must belong to the selected OPEN period` | **55000** same message |
| `refs_create_business_document` AP bill (`AP.BILL.CREATE`) | admitted past the period gate | **55000** `Business document date must belong to the selected OPEN period` | **55000** same message |
| `refs_read_period_close_readiness` (`GL.PERIOD.CLOSE`) | readable, blockers do not include `PERIOD_NOT_OPEN` | readable, blocker `PERIOD_NOT_OPEN` | readable, blocker `PERIOD_NOT_OPEN` |
| `refs_close_period_v2` (`GL.PERIOD.CLOSE`) | admitted past the status gate | **55000** `Only an OPEN period can be closed` | **55000** same message |
| `refs_reopen_period_v1` (`GL.PERIOD.REOPEN`) | **55000** `Only a retained CLOSED period can be reopened` | **55000** same message | admitted past the status gate |

Read the middle column against the right: **SOFT_CLOSED is byte-identical to CLOSED for every
operation except reopen, where it is strictly worse** — CLOSED is recoverable, SOFT_CLOSED is not.
The enum label therefore carries no behaviour today; it only carries risk.

## 5. The contradiction with approved settings

`374_accounting_settings_authoritative.sql` (and `251_…`) validate an approved period-close policy
snapshot that *does* define three distinct states:

| `period_status` | `allow_post` | `posting_lock` | `hard_lock` | `soft_lock` |
|---|---|---|---|---|
| `OPEN` | true | false | false | false |
| `SOFT_CLOSED` | false | true | **false** | **true** |
| `CLOSED` | false | true | **true** | false |

`374` even permits a retired snapshot to lag by one state when the live period is `SOFT_CLOSED`
(`period_status IN ('OPEN','SOFT_CLOSED')`). So the settings layer is written for a three-state
model with a distinguishable soft lock, while the kernel implements two states and collapses the
soft lock onto the hard lock. Whichever way this is resolved, one of the two layers is wrong today.

## 6. Owner decision required

Pick one; both are small, but they are opposite directions and neither should be chosen by a worker.

**(A) Retire the label.** Treat `SOFT_CLOSED` as dead, add a migration-time assertion that no row
carries it, and drop the `SOFT_CLOSED` branch from the settings-policy validator. Cheapest, and
removes the dead-end failure mode. Cost: the settings snapshot schema loses a state that the close
policy already describes, so the approved-policy contract changes.

**(B) Implement the label.** Add `GL.PERIOD.SOFT_CLOSE` (own SoD class), a
`refs_soft_close_period_v1` / `refs_unsoft_close_period_v1` pair with an idempotency scope, and
change the ~83 OPEN-only guards deliberately: posting paths stay rejecting, but the operations the
policy calls "soft" (adjusting journals by a controller, prior-period adjustment under
`prior_period_adjustment_policy=CONTROLLER_ONLY`) become admissible. That is a real accounting
feature with a real SoD surface, not a rename — it should be scoped as its own task, not folded
into R09.

Until the Owner picks, the safe reading is: **the system has two period states, not three**, and any
release note or runbook that says otherwise is wrong.

## 7. Interim guard shipped with this task

`server/tests/period-status-contract.test.mjs` (no database needed) fails if:

- the enum changes shape,
- any migration starts writing `SOFT_CLOSED`,
- reopen stops gating on `CLOSED`,
- a period-row guard starts admitting `SOFT_CLOSED`,
- a third `GL.PERIOD.*` permission appears,
- the settings policy stops declaring `SOFT_CLOSED` as `soft_lock`,
- the recorded operation matrix drifts from the behaviour above.

The failure message points back to this document, so whichever branch the Owner picks, the change
has to be made on purpose.
