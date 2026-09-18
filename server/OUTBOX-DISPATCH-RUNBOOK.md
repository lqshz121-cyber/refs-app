# Outbox dispatch worker — operations runbook (P10)

Scope: `refs-outbox-dispatch-staging` (Render worker) and the `outbox_event` queue it drains.
Written 2026-09-18 by session `claude-9c9cd162`. **Nothing in this runbook has been executed against staging or production** — it is the procedure, plus the read that now makes each step verifiable.

## 0. Current state as found (O10 read-back, 2026-09-17)

| Fact | Value |
|---|---|
| Worker | `refs-outbox-dispatch-staging`, branch `main`, Auto-Deploy Off |
| Status | **Suspended by Render since 2026-09-02 07:18** — "multiple startup failures over 24 h" |
| Root cause per L02 | consumer endpoint `OUTBOX_PUBLISH_URL` returned 404 |
| Backlog | growing since 09-02, **previously unobservable without a DB session** |
| Branch drift | worker on `main` while the four other surfaces are on the candidate branch |

## 1. What changed in P10

`GET /entities/{entityId}/ops/outbox-health?staleMinutes=N` (permission `OPS.OUTBOX.VIEW`, migration 433).
Returns pending / published / failed counts, due-now vs deferred, how many are older than the window, retry and max-attempt distribution, oldest pending age, a per-event-type breakdown, and the twenty oldest unpublished events by identity.
**Payloads are never returned** — only `payload_hash` and a 200-character `last_error`. The read dispatches nothing and mutates nothing (pinned by test).

`backlog_state` is the one-line summary: `DRAINED` | `PENDING_WITHIN_WINDOW` | `STALE_BACKLOG` | `FAILED_EVENTS_PRESENT`.

## 2. Before resuming the worker — preconditions

1. **Consumer reachable.** `OUTBOX_PUBLISH_URL` must return 2xx for a signed probe. Until then, resuming only re-creates the 09-02 crash loop. Do not resume to "see what happens".
2. **Branch aligned.** Point the worker at the same commit as the two APIs and two static sites; the four-surface release read-back (`staging-release-readback --expect <sha>`) cannot see the worker, so this is checked in the Render event log by `release` field.
3. **Baseline recorded.** Call the health read for each active company and record `pending_count`, `oldest_pending_age_seconds` and `backlog_state`. This is the number the resume is judged against.
4. **Secrets present.** `OUTBOX_PUBLISH_TOKEN` set; the preflight `npm run preflight:outbox-dispatch-release` must pass (it validates release config, not the ledger).

## 3. Resume procedure

1. Resume the worker in Render.
2. Watch the Render event stream for 15 minutes. Any `Instance failed` / `Exited with status 1` → **suspend again immediately** and record the log line; do not retry more than once.
3. At T+5, T+10 and T+15 minutes call the health read. Expected: `pending_count` strictly decreasing, `backlog_state` moving `STALE_BACKLOG → PENDING_WITHIN_WINDOW → DRAINED`.
4. If `failed_count` rises, stop: events are dead-lettering. Go to §4.

## 4. Dead letters and stuck events

`status='FAILED'` means the dispatcher exhausted its attempts (279 caps attempts and applies exponential backoff; `available_at` carries the next eligible time).

- Read `oldest_unpublished` for identity, `attempt_count` and the truncated `last_error`. Group by `event_type` from `by_event_type` — a single failing type points at one consumer route, an across-the-board failure points at auth or the base URL.
- **Do not delete or hand-edit `outbox_event`.** The queue is the delivery record; deleting it destroys the only evidence of what was never delivered. There is deliberately no delete path, and the read reports `can_delete: false`.
- Requeueing a dead letter is **not** implemented (D-P10-1). Today the only recovery is fixing the consumer and having the Owner decide whether to reset `status`/`available_at` through a reviewed migration or one-off script, with the before/after counts captured from the health read.

## 5. Correctness boundary

The outbox is **delivery**, not accounting. A backlog, a dead letter, or a suspended worker does **not** make the ledger wrong: every event was written in the same transaction as the accounting fact it describes, and the fact is already in `journal_entry` / `ledger_line`. Nothing in this runbook may be used to argue that accounting is degraded, and equally nothing here repairs accounting.

## 6. What is still missing (Owner decisions)

- **D-P10-1** No requeue / replay command for `FAILED` events, and no operator UI for the queue.
- **D-P10-2** No alert on `backlog_state` — the read exists, nothing polls it. Render notifications are currently "workspace default (failures only)".
- **D-P10-3** No inbox (consumer-side) equivalent: delivery is fire-and-forget from this side; duplicate suppression relies on the consumer honouring `payload_hash`.
- **D-P10-4** Resuming the worker is an Owner action; this session has not resumed, deployed, or changed any Render setting.

## 7. Related coverage (already green, not re-done here)

S23 outbox dispatch contract 52/52 (lease, attempt, max attempts, retry base), 279 retry/backoff migration, R16 worker deadlock ceiling, webhook subscription workflow (create/submit/approve/suspend with `INTEGRATION.WEBHOOK.*` and delivery history), `report_saved_views` (386) and `import_export_history_job` all have their own contract tests in the candidate.
