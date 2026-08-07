# Period Management

Branch `claude/period-management`. Closes the gap between a correct control and an
unusable product: period control was made fail-closed, and nothing in REFS could open
a period, so 117 of 119 entities could not post anything and the only remedy was
hand-editing `PERIODS` in `src/data.js`.

The control was not relaxed. The missing capability was built.

---

## 1. The defect this closes

`src/period-control.js` reads a period master row as an **authorization record**: it
exists because somebody with period authority opened that entity's period, so its
absence means the opposite of permission. That is right, and it stays.

What was wrong was the other half:

| | Before | After |
|---|---|---|
| Period master rows | 3 | 120 |
| Entities able to post into 2026-07 | **2 of 119** | **119 of 119** |
| Entity/period pairs carrying POSTED journals with no record | 943 | 826 |
| POSTED journals in a CLOSED period (breaches) | 26 | 26 |
| Way to open or close a period from the product | none | `Close → Period Management` |
| `Close period` control | a button that raised `Period close is shell-only` | removed; the real command lives on the period surface |

Measured (`npm run test:audit`, exit 0):

```
audit entities=119/119 jes=3656 fails=0
period-control PERIOD_CONTROL_EXCEPTIONS_FOUND closed_period_journals=26
               unconfigured_entity_periods=826 unconfigured_journals=3202
```

---

## 2. Lifecycle

```
            openPeriodCommand              closePeriodCommand
 (no record) ──────────────────▶  OPEN  ──────────────────────▶  CLOSED
                                   ▲                               │
                                   └───────────────────────────────┘
                                        reopenPeriodCommand
                                    (separate, more privileged,
                                     mandatory substantive reason)
```

Two states, `OPEN` and `CLOSED`. **"No record" is not a third state** — it is the
absence of an authorization, and the resolver reports it as `NOT_CONFIGURED` so a
screen can say exactly that. No command can produce it: `close` amends the record in
place, it never deletes it.

All three commands live in `src/period-lifecycle.js`. They are pure: no `Date.now`,
no randomness, no storage, no React. The caller supplies the actor and the timestamp,
which is what makes the resulting event auditable rather than self-asserted.

### Why there is no `LOCKED` state

Considered and rejected. A permanently sealed state was declined on four grounds:

1. **It is invisible at the gate that matters.** `resolvePostingPeriod` refuses
   anything that is not `OPEN`. `LOCKED` and `CLOSED` would be identical to every
   posting path in the system. The only observable difference is that a Controller
   could not recover from an operator error.
2. **REFS has no event that could justify it.** A lock is meaningful when it is
   triggered by something real — a statutory filing, an audit sign-off, an archival
   cutover. REFS records none of those. A lock command with no triggering fact would
   be a button whose meaning was invented at the UI layer.
3. **It would be unreachable and therefore dead.** With no data-supported trigger,
   `LOCKED` would either never be entered (a dead state) or be entered by a control
   whose criteria were fabricated (the defect this repository has been removing).
4. **The property it protects is already protected elsewhere, and better.** Posted
   evidence is immutable because the JE workflow says so and because correction is
   reversal-only — not because a period is sealed. Reopening a period does not make a
   posted entry editable; it makes a *new* entry postable, which is exactly what a
   correcting reversal needs.

Irreversibility is bought here with an audit trail and a privileged, reasoned reopen,
not with a state nobody can leave. If a statutory-filing or archival event is ever
recorded in REFS, `LOCKED` becomes justifiable and should be revisited then.

---

## 3. Permission model

Wired into the existing `ROLE_PERMS` / `ctx.can(permission)` model in `src/app.jsx`.
**No role was widened by this branch.** `ROLE_PERMS` is unchanged.

| Command | Permission | Held by |
|---|---|---|
| Open | `PERIOD.PERIOD.OPEN` *(new code)* | CONTROLLER only, via its `'*'` wildcard |
| Close | `PERIOD.PERIOD.CLOSE` *(pre-existing)* | CONTROLLER, ACCT_MANAGER |
| Reopen | `PERIOD.PERIOD.REOPEN` *(new code)* | CONTROLLER only, via its `'*'` wildcard |

The two new codes appear in no enumerated role array, so they add no capability to any
role — the same pattern already used for `CASH.BANKTX.*`
(`docs/QB-REFS-PARITY-IMPLEMENTATION.md` §185).

The asymmetry is deliberate and is the point of the model:

- **Closing narrows** what may be posted. An Accounting Manager may do it.
- **Opening and reopening widen** posting authority. Widening is the Controller's
  alone. Reopening additionally returns authority over a period somebody has already
  signed off, which is why it is a separate command and not "close with a flipped
  argument": a role that may close cannot therefore reopen, and
  `verify-period-lifecycle.mjs` pins exactly that case.

`src/period-lifecycle.js` and `src/module-periods.jsx` call `ctx.can()`. Neither
defines a role table; the verifier asserts they do not.

### On screen

A command the signed-in role can **never** execute renders as an `<Unavailable>`
statement of fact — `aria-disabled`, not focusable, carrying its own reason
("Your role does not hold `PERIOD.PERIOD.OPEN`"). It is not a greyed-out button.
A command the role **does** hold but which is unavailable for the current selection
stays a real control with `disabled={expression}` and a title saying why, because that
condition can change.

---

## 4. Audit events

Every accepted transition appends one event:

```js
{event_id, event_type, entity_id, period_code, prior_status, next_status, actor, at, reason}
```

`event_type` is `PERIOD_OPENED`, `PERIOD_CLOSED` or `PERIOD_REOPENED`. A transition
with no actor or no timestamp is refused — an unattributable or undated transition is
not an authorization. Events are also mirrored into `repo.audit()` so they appear on
the existing Audit Log page.

Reasons are mandatory and are written verbatim into the event:

- open / close: at least 8 characters
- **reopen: at least 20 characters**

A refused command writes no event and returns the caller's own `periods` and `events`
arrays by reference, so a caller that ignores `ok` still cannot commit a refused
transition.

---

## 5. Close-blocking criteria, and why these three

Closing is refused while the application can still observe unresolved work **in that
entity and that period**. Each criterion is derivable from records the browser already
holds. None is inferred from a field the data does not carry.

| Code | What it counts | Why it blocks a close |
|---|---|---|
| `JOURNALS_IN_WORKFLOW` | journals of this entity, in this period, not in a terminal posting state (`POSTED`, `REVERSED`, `VOID`, `REJECTED`, `CANCELLED`) | Closing would freeze them permanently. Every forward workflow move re-checks period control, so a `DRAFT`, `PENDING_REVIEW`, `PENDING_APPROVAL` or `APPROVED` entry in a closed period can never be posted *or* rejected. |
| `OPEN_EXCEPTIONS` | exceptions raised against this entity whose `occurred_date` falls in this period and whose status is neither `CLOSED` nor `WAIVED` | An exception open at close is an unexplained difference carried into a signed-off period. |
| `UNRECONCILED_BANK` | bank items of this entity, dated in this period, whose `match_status` is not `MATCHED` | Cash is not proven for the period until every statement line is matched or explained. |

Scoping is strict, and the verifier proves it: another entity's draft, another
period's draft, a `POSTED` or `REVERSED` journal, a resolved exception and a matched
bank item are all **not** blockers.

Two derivations are worth naming explicitly:

- **Exceptions have no `period_code`.** They carry `entity_id` and `occurred_date`, so
  the period is taken as `occurred_date.slice(0,7)`. This is a derivation from a field
  that exists, not an invented one.
- **Bank items have no `entity_id`.** They are held per bank account, so the account is
  resolved to its entity through `BANK_ACCOUNTS`. An account whose entity cannot be
  resolved is **dropped, not guessed at**. An item the user explicitly excluded from
  reconciliation is treated as dealt with and does not block.

### What is deliberately *not* a blocker

**The month-end close checklist (`CLOSE_TASKS`).** Those ten rows carry no `entity_id`
and no `period_code`. Scoping them to one entity and one period would be a check the
data cannot support, and applying an unscoped checklist to all 119 entities would make
the current period permanently unclosable in a UI that has no sign-off control — a
dead control by another route. The period surface therefore **reports** the checklist
("8 of 10 tasks outstanding") and says in the same breath that it is context, not a
condition. `verify-period-lifecycle.mjs` asserts that `src/period-lifecycle.js`
contains no reference to `closeTasks` at all.

This is the one place where the honest answer is weaker than the ideal one. It is
recorded as residual risk in §9 rather than papered over with a fabricated scope.

---

## 6. Posted entries stay immutable

Nothing in this branch rewrites, re-dates or deletes a journal.

- The three commands take no journal array they could mutate. `unresolvedWork` reads
  journals but only counts them.
- The verifier deep-compares a posted-journal fixture before and after running all
  three commands, and greps both new source files for `posting_status:`, `je_date:`,
  `.splice(`, `setJes` and the mutating `actions.*` calls.
- The **26 journals already POSTED into entity 2's CLOSED `2026-06`** are untouched.
  They stay `POSTED`, keep their `2026-06` document dates, and stay visible as
  `POSTED_INTO_CLOSED_PERIOD` exceptions in the Exception Center. The verifier asserts
  each one individually: still `POSTED`, still in the period it breached, still dated
  inside it.
- Period Management surfaces the same fact next to the command that can act on it: a
  row whose period is not `OPEN` but which holds posted journals is flagged
  `POSTED IN A PERIOD THAT IS NOT OPEN`, and the row drawer states that correction is
  a reversal in an open period or a documented reopen — never a re-date.

---

## 7. The period management surface

`src/module-periods.jsx`, route `periods`, navigation `Close → Period Management`.

**Scale.** 119 entities × 12 periods is 1,428 possible rows. The default view is one
period — the current one — with:

- a **summary strip** answering "how much of the group can post right now" without
  reading a row: open / closed / no record / posted journals / breaches;
- **filters**: period (only codes the data actually contains), entity type, and a
  QB-style **segmented control** for state (`All | Open | Closed | Not configured`)
  with live counts in the labels;
- the shared data grid's own **search, sort and pagination at 25 rows**;
- **bulk selection** with "Select N listed", because opening the same period for many
  entities is the common case.

**Bulk is the same command in a loop, not a looser second path.** Each target is
authorised, validated and checked for unresolved work individually; each accepted
target writes its own event; a refusal on one entity stops nothing and hides nothing —
refusals come back itemised with their reasons. The verifier pins that bulk cannot
bypass the permission check and that a partial batch reports its refusals.

**Row drawer** shows the full event history for that entity/period, the itemised
unresolved work with example references, and the one command applicable to that row's
state.

**Design system.** The page adds no CSS. It composes only existing `index.html`
primitives — `Segmented`, `Btn`, `Table`, `Drawer`, `Field`, `Badge`, `Unavailable`,
`filter-bar`, `qbo-card`, `report-workbench`, `qbo-drill-summary` — which already carry
the QB-derived tokens (36px/16px controls, hairline borders, no hover lift, radius
6/8/9999). Figures use the `num` class (`tabular-nums`).

`Month-End Close` keeps its checklist and progress, and its shell button is replaced by
a navigation to Period Management.

---

## 8. Seeding decision

**What is seeded** (`src/data.js`, 120 rows, 121 events):

1. **2026-07 `OPEN` for all 119 entities**, every row carrying `opened_by`,
   `opened_at` and `open_reason`, and every row backed by a `PERIOD_OPENED` event.
   These 119 records are one recorded authorization: the Controller opening the
   current month for the group on 2026-07-01, for July only.
2. **2026-06 `CLOSED` for entity 2** — the pre-existing state — with both the opening
   and the closing event recorded so the closed state has a provenance instead of
   appearing from nowhere. Its 26 breaching journals are left exactly as they are.

**What is deliberately not seeded:**

- **The other 826 entity/period pairs that carry posted journals.** They keep no
  record, which reads as "nobody opened this period" — which is exactly true. This is
  the pre-existing control gap and it stays visible on the Exception Center.

### Why not blanket-open all 946 pairs

That is the fail-open defect moved from the resolver into the seed: the system
granting itself authority nobody exercised. It would report the control as clean while
proving nothing, and it would make the resolver's fail-closed behaviour untestable
against real data.

### Why not blanket-*close* the prior periods instead

This was the brief's suggested alternative and it was tried on paper and rejected on
arithmetic. `periodControlExceptions` flags **any** POSTED journal whose period is not
`OPEN` — it has no posting-timestamp-versus-close-timestamp to distinguish "posted
while open, then closed" from "posted into a closed period". Marking 2025-12 through
2026-06 as `CLOSED` would therefore turn **3,202 prior-period postings into
closed-period breaches** and bury the 26 real ones in noise, directly contradicting
the requirement that those 26 remain visible.

Leaving history unconfigured is the honest reading: for those pairs, nobody opened the
period, and REFS says so.

### Why 119 open records is not the same thing at smaller scale

Two differences, and both are asserted by the verifier:

- **It is the current period only.** No back-dated posting authority is granted.
  `resolvePostingPeriod` refuses 2026-05 for all 119 entities. The verifier fails if
  any row other than `CURRENT_PERIOD_CODE` is seeded `OPEN`.
- **It is attributed.** Every row names who opened it, when and why, and has a
  corresponding event. The verifier fails on any row or event missing any of those
  fields.

`SEED_V` is incremented **v11 → v12**, so retained demo stores are invalidated. The
version reset and the `Reset demo data` control both clear `refs_periods` and
`refs_periodevents`.

The period master is now application state seeded from `src/data.js`, persisted through
the existing allowlisted `refs_` writer in `src/app.jsx`. It is never synthesised: the
`load` fallback is the authored master, and every posting path resolves against the
live state.

---

## 9. Residual risk

Stated plainly.

1. **The close checklist is not scoped, so it is not enforced.** `CLOSE_TASKS` has no
   entity or period. It is reported as context. If per-entity close readiness matters,
   `CLOSE_TASKS` needs `entity_id` and `period_code` and a sign-off surface — a data
   model change outside this branch.
2. **No segregation of duties between closer and reopener.** The same Controller can
   close a period and reopen it. Enforcing "the actor who closed may not reopen" would
   make reopen unreachable in a demo with one Controller. The compensating controls are
   the distinct, more privileged permission, the mandatory 20-character reason and the
   audit event. A real deployment should add maker/checker on reopen.
3. **The exception-to-period derivation uses `occurred_date`.** An exception raised in
   August about a July transaction is attributed to August and does not block July's
   close. Exceptions carry no period field; nothing better is available.
4. **A closed period's breach detector cannot tell "posted then closed" from "posted
   into a closed period".** This is why prior periods were left unconfigured rather
   than closed (§8). Fixing it needs a posting timestamp on the journal compared
   against the close event timestamp.
5. **Browser state, not an accounting record.** Period records live in the demo store
   like every other legacy workspace's state. `verify-frontend-data-boundary.mjs`
   already tracks this as the migration's largest item; the period master is now part
   of it. There is no period endpoint in the accounting API to bind to.
6. **Bulk opening is one click for 119 entities.** It is permission-gated, reasoned and
   fully audited (119 events), but it is still one click. There is no second approval.
7. **`Field` renders a visible `<label>` with no `htmlFor`.** This matches the existing
   pattern throughout the codebase; the segmented control and every input carry their
   own `aria-label`, so nothing is unlabelled to a screen reader, but the visible label
   is not programmatically associated. Pre-existing, not introduced here.

---

## 10. Verification — what is proved and what is not

### Test-verified (exit 0, run on this branch)

| Gate | Result |
|---|---|
| `npm run test:ssr` | `components=28 failed=0` (was 27; `PeriodManagement` added) |
| `npm run test:audit` | `entities=119/119 jes=3656 fails=0` |
| `npm run test:audit-mutations` | `cases=36 proved=36 broken=0 baseline_clean=true` |
| `npm run build` | ok |
| `node tools/run-verifiers.mjs` | `46/46 passed` (was 45; `verify-period-lifecycle.mjs` added) |
| `node verify-global-visible-english.mjs` | pass |
| `npm run test:navigation-a11y` | pass |
| `git diff --check` | clean |
| `tools/analysis/{unit-cost-cogs,ic-elimination,opening-equity}.js` | `failures=0` |
| full `npm run test` chain, 21 scripts | all exit 0 |

`verify-period-lifecycle.mjs` pins, as executable assertions: absence is never
permission; no command produces "no record"; reopen is a distinct command with a
distinct permission, refused for five inadequate reasons and writing no event when
refused; every accepted transition carries actor, timestamp, entity, period, prior
state and reason; close is refused by each of the seven blocking cases and permitted
by each of the eight out-of-scope cases; posted evidence is byte-identical before and
after all three commands; `ROLE_PERMS` grants the two new codes to no enumerated role;
the seed opens only the current period, attributes every row and leaves the historical
gaps visible; the surface renders no permanently disabled control.

`mtest.jsx` adds 18 SSR cases covering the same commands plus the rendered markup of
the period surface for both a permitted and a denied role.

### Static reasoning only — NOT visually verified

There is no browser in this environment and `file://` is blocked, so **no screenshot
was taken and no rendered pixel was inspected.** Specifically unverified:

- how the page actually looks in light or dark mode;
- that the segmented control, filter bar and command panel lay out sensibly at any
  particular viewport width;
- computed contrast ratios of the new page's text against its backgrounds;
- focus-ring appearance and tab order as experienced.

What supports the visual claims is weaker than a screenshot and is stated as such: the
page introduces **no new CSS** and uses only components and class names that already
exist in `index.html` and are already exercised by other pages and by
`verify-a11y-offcanvas-and-dark-contrast.mjs`. That makes a *regression* unlikely; it
does not prove the layout is good. The rendered HTML string is asserted by `mtest.jsx`,
which proves the markup and its text, not its appearance.
