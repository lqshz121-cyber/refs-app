# UI Round 3 — Refinement and Feel

**Branch:** `claude/ui-round3-qb-polish`
**Parent commit:** `96461b0`
**Date:** 2026-08-06
**Builds on:** `docs/UI-SYSTEM-PASS-122f475.md` (round 1 tokens, round 2 shell)
**Specifications read:** `docs/QB-DESIGN-TOKENS.md`, `docs/QB-SHELL-STRUCTURE.md`

> **No release / no accounting behavior change.** Round 3 changes motion, numeric
> legibility, table scannability, status marks, and queue progress display only.
> No accounting calculation, source classification, state machine, API/OpenAPI
> contract, migration, WBS/MCP logic, or authorization rule was modified.
> `Draft -> Review -> Approve -> Post`, segregation of duties, immutable Posted
> evidence, and reversal-only correction are untouched. No export, payment rail,
> bank feed, connect/import/OCR, auto-match, auto-categorize, auto-post, sign-off
> automation, destructive action, or promotion was added, and no disabled control
> was reintroduced. The `Cash movement evidence` label and its "not a complete
> statement of cash flows" disclaimer are unchanged. Visible copy stays
> English-only. No QuickBooks markup, CSS, icon, image or font asset is copied;
> the proprietary `Avenir Next forINTUIT` face is never embedded or referenced.
> **This is not a release and makes no claim of QuickBooks parity or equivalence.**

---

## 1. Changed files

| File | Nature of change |
|---|---|
| `index.html` | Motion tokens + one motion contract + a hardened `prefers-reduced-motion` block (section 1); three numeric readings (section 1); workflow mark alphabet (section 7); sticky-header edge and a keyboard row distinct from the hover row (section 8); `cleared` state and the skeleton system (section 9); queue-tile tones and meters (section 10); dark-mode parity for every one of the above (section 22). Still **one ordered stylesheet** — no new override layer was appended, every rule was placed in the section it belongs to. |
| `src/ui.jsx` | `Money` gained the nil/zero split; `Badge` gained the shape class; `StateBlock` gained the `cleared` tone; `Table` gained `emptyTone`, a skeleton loading state and keyboard-vs-pointer row tracking; new exported `QueueTile` and `TableSkeleton`. |
| `src/modules-core.jsx` | `Dashboard` attention grid rebuilt on `QueueTile` with derived done/total; approvals table empty state reclassified as `cleared`; JE line grid stops printing `$0.00` on the side of the entry that does not apply. |
| `tools/build-shell-preview.mjs` | Preview extended to cover every round-3 addition, plus a greyscale toggle. |
| `docs/preview/shell-preview.html` | Regenerated artifact. |
| `docs/UI-ROUND-3-POLISH.md` | This document. |

`src/module-banktx.jsx`, `src/module-bankrec.jsx`, `src/module-ap.jsx`,
`src/module-ar.jsx` and `src/module-coa.jsx` were **not opened for edit** —
they inherit round 3 through the shared stylesheet and the shared `Money`,
`Badge` and `Table` components, so the parallel branches do not conflict on them.

---

## 2. Refinement by refinement

### 2.1 Motion with purpose, at QuickBooks' restraint

**What changed.** Three tokens (`--qb-dur-1:120ms`, `--qb-dur-2:180ms`,
`--qb-ease-out:cubic-bezier(.22,.61,.36,1)`) replaced the five hand-written
`.12s ease` / `.1s ease` / `.18s ease` declarations that had accumulated across
rounds 1 and 2. One shared rule now gives every interactive surface — buttons,
nav rail items, panel rows, chips, action pills, cards, table rows, statement
rows, inputs, selects — the same short ease-out on **background, border, colour,
box-shadow and opacity only**.

**The measurement / principle behind it.** `QB-DESIGN-TOKENS.md` section 6:
*"No lift. QuickBooks never translates cards on hover. Hover = background tint
only."* `QB-SHELL-STRUCTURE.md` section 3 restates it. So the honest version of
"motion" here is not movement at all — it is a *paint* change with a short
onset, which is what makes a hover feel responsive rather than instant-and-harsh.
120ms is deliberately shorter than the roughly 150ms a deliberate click takes, so
the feedback resolves before the press lands.

**`transform` is absent from every transition list in the stylesheet**, and a
`*{transition-property: background-color, border-color, color, box-shadow,
opacity, fill, stroke, outline-color, width}` rule makes that structural rather
than a matter of discipline: an element that does not opt into a specific list
cannot transition a layout or transform property at all. Nothing can move a row
under a cursor that is already committed to a click. Grep for `translateY` and
`scale(` in the stylesheet returns nothing (verified — see section 4).

The two genuine movements in the product are both *overlays*, not content: the
drawer's `slideIn` and the mobile nav's off-canvas `transform`. Both were
retokenised to `--qb-dur-2` / `--qb-ease-out`. Neither can displace a target the
user is aiming at, because both appear over a scrim.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)` now sets
`animation-duration`, `animation-iteration-count`, `transition-duration` and
`scroll-behavior` with `!important` across `*`, `*::before` and `*::after`, and
additionally strips the skeleton's gradient to a flat fill. The gradient strip
matters: a shimmer implemented as an animated `background-position` does not
merely stop when its duration goes to zero, it freezes wherever the sweep
happened to be, leaving a permanently lopsided block. Under reduced motion the
skeleton is a plain, even grey. Every animation added in round 3 is covered, and
so is every animation inherited from rounds 1 and 2.

### 2.2 Density you can actually read — three numeric readings

**What changed.** `Money` now renders three distinct things instead of two:

| Input | Renders | Class | Why it is distinct |
|---|---|---|---|
| a figure | `$412,880.00` / `($8,420.00)` | `.num` (+`.num-neg`) | negatives in parentheses, the accounting convention, same tabular width as the positive |
| a recorded zero | `$0.00` | `.num-zero` | quieter (`--qb-text-muted`, 7.6:1 on white) but unmistakably a figure |
| no figure at all | `–` | `.num-nil` | an en dash with `title` and `aria-label` of "No amount" — it can never be read as a balance of zero |

Before round 3, `money(null)` returned the empty string, so "no data" rendered as
a **blank cell**: indistinguishable from a cell that failed to render, and
silently absent to a screen reader. A real `0.00` and an absent figure are now
three-way separated in text, in colour, and in the accessibility tree.

**Where this pays off immediately: the journal entry line grid.** Every line was
rendering `<Money v={l.debit_amount || 0}/>` **and** `<Money v={l.credit_amount
|| 0}/>`, so a credit line printed `$0.00` in the debit column. Two
identical-looking figures on every row is precisely the thing that makes a debit
and a credit of the same magnitude *not* comparable at a glance. The side that
does not apply to a line now renders the "no amount" dash, while a line that
genuinely carries zero on both sides still prints `$0.00` twice. Stored amounts
are untouched; this is a render-time distinction only.

Both money columns were already `ta-r` at a fixed 110px with
`font-variant-numeric: tabular-nums`, per `QB-DESIGN-TOKENS.md` section 1
(*"QB uses the same sans face with tabular-nums, not a monospace font"*), so
equal magnitudes already occupied equal width — the noise was the false zeros,
and that is what was removed.

One deliberate exception: `.num-bold.num-zero` keeps the strong text colour. A
*total* of exactly `$0.00` is a result, not a quiet cell.

### 2.3 Scannability — hover and keyboard are different facts

**What changed.** `Table` already supported ArrowUp/ArrowDown row navigation, but
the highlighted row used the same class (`.tr-hi`) whether the *keyboard* had put
it there or the *mouse pointer* was merely resting over it — and `onMouseEnter`
set it too. The two states were literally indistinguishable, which made keyboard
navigation of a ledger unusable.

`Table` now tracks which input device last moved (`kb`), set true on Arrow keys
and cleared on pointer movement. The row renders as:

- **`.tr-hi` / `:hover`** — the quiet `--qb-canvas` tint QuickBooks uses on white
  rows (`QB-DESIGN-TOKENS.md` section 6.1).
- **`.tr-kb`** — `--qb-accent-tint` background **plus a 3px inset accent marker
  on the leading edge**. This is the row the Enter key will open, so it is marked
  by geometry as well as by colour, and it cannot be confused with wherever the
  mouse happens to be.

Sticky headers were already in place from round 1; round 3 adds
`box-shadow: 0 1px 0 0 var(--qb-border-alt)` to `.tbl th`, because a sticky cell
paints its `border-bottom` underneath the scrolled row in some engines and the
header edge would disappear mid-scroll. It is the measured 1px offset, not a soft
drop shadow — `QB-DESIGN-TOKENS.md` section 4: *"QB elevation is tight and low."*

**Zebra striping was not added.** `QB-SHELL-STRUCTURE.md` section 2.5 and
`QB-DESIGN-TOKENS.md` section 6.3 are explicit that borders carry the structure
in QuickBooks. The `1px #DDDDDD` row rule stays the only separator.

### 2.4 Status legible without reading — a mark alphabet

**What changed.** `Badge` had one mark for every state: a 6px filled dot in the
tone colour. Tone is a three-way split (`muted` / `warn` / `ok` / `bad`) but the
posting workflow has five stages, so `APPROVED` and `POSTED` were the *same*
badge to any reader, and identical in greyscale to a reader with a colour vision
deficiency. Each recognised stage now also carries its own mark **geometry**:

| Stage | Mark | Reading |
|---|---|---|
| `DRAFT` | hollow ring | nothing committed yet |
| `PENDING_REVIEW`, `PENDING_APPROVAL`, `IN_PROGRESS`, `OPEN`, `PARTIAL`, `UNMATCHED` | half-filled ring | committed, awaiting a second pair of eyes |
| `APPROVED`, `MATCHED`, `DONE`, `BALANCED`, `SIGNED_OFF`, `PAID`, `RESOLVED`, `CLOSED` | filled circle | complete |
| `POSTED` | **filled square** + 600 weight | immutable — a different shape entirely, not a darker green |
| `REVERSED`, `VOID`, `REJECTED`, `FAILED`, `OUT_OF_BALANCE` | horizontal bar | struck through |

Three independent channels now carry the state: the **word** (which is the
accessible name and is unchanged), the **hue**, and the **shape**. Nothing
depends on any one of them. Badge content that is *not* a workflow token —
source system codes (`WBS_CL`, `PM`, `AP`), severities, `READ ONLY`,
`POSTED EVIDENCE` — keeps the plain dot and is unaffected.

The mark is a `::before` pseudo-element and is therefore already outside the
accessibility tree. A badge remains a statement of state; it is not focusable,
not a control, and implies no action.

### 2.5 Progress and relief — what is left *and* what is done

This is the item the brief calls the single biggest lever, and it is also the one
most easily faked, so the rule applied was: **no tile renders a denominator it
cannot count from the same records the numerator came from.**

**What changed.** The dashboard's six attention tiles rendered a bare count with
no tone rules at all — `.todo-n.warn` and `.todo-n.ok` were set in the JSX but
**never defined in CSS**, so a queue with five items left and a queue that was
completely clear rendered as the same plain 24px numeral on the same plain tile.
Each tile is now a `QueueTile` stating both halves of the fact:

| Tile | Remaining | Total (all derived in the same pass) |
|---|---|---|
| Bank transactions for review | `match_status === 'UNMATCHED'` | every transaction across every account |
| Bills pending approval | `status === 'PENDING_APPROVAL'` | every bill |
| JEs pending review/approval | `PENDING_REVIEW` + `PENDING_APPROVAL` | every JE in entity scope |
| Missing mappings | open `GL_MAPPING_MISSING` exceptions | every `GL_MAPPING_MISSING` exception in scope |
| Open exceptions | `OPEN` + `IN_PROGRESS` | every exception in scope |
| Close tasks remaining | tasks not `SIGNED_OFF` | every close task |

The tile shows the remaining count in a warn-toned pill, a meter of the
proportion already done, and `"{done} of {total} done"`. `QueueTile` refuses to
draw the meter unless `total` is a positive finite number, so a queue whose
denominator is not derivable degrades to the count alone rather than inventing
one. "3 remaining" reads as a chore; "3 remaining, 38 of 41 done" reads as
progress. The tiles read counts and change no status, filter or workflow.

**An empty queue reads as an outcome.** When `remaining === 0` the tile switches
to a check mark on the positive tone and reads `"All 41 done"`. The
`StateBlock` gained a fifth tone, `cleared`, used where a finite work queue has
genuinely been emptied — currently the dashboard approvals table, whose copy
changed from *"No journal entries are pending approval."* to *"Nothing is waiting
on you. Every journal entry in scope has cleared review and approval. Posted
evidence stays reachable from the Journal Entry workspace."* It is bordered and
tinted with the ok tokens and carries a check glyph instead of the neutral
document glyph.

**The claim boundary matters here.** `cleared` says one thing only: *this queue
is empty.* It does not say a period is closed, reconciled, approved or posted,
it never appears on a read that failed or was not permitted (those remain
`error` and `permission`), and like every other state block it carries no
control. The neutral `empty` state is unchanged for reads that are simply not
work queues, and the preview shows the two side by side so the difference is
visible.

**Skeletons that match the final layout.** `Table`'s loading state was a centred
text block; the table then replaced it and the page jumped. `TableSkeleton` now
draws the *same geometry as the loaded table* — the same `.table-wrap` hairline
and radius, a 40px header, 44px rows, one bar per real column with the numeric
columns at a fixed narrow width — so nothing shifts when the read resolves. It
keeps `role="status" aria-live="polite" aria-busy="true"`, and the bars
themselves are `aria-hidden`.

---

## 3. Dark mode

Every round-3 token and every round-3 painted class has an explicit `body.dark`
value: `--qb-skel` / `--qb-skel-hi`, `.tbl th`'s header edge, `.tr-kb`,
`.todo-n` and its two tones, `.todo-meter` and its fill, `.state-cleared`
including a **second copy of the check glyph with a light stroke** (it is a
data-URI SVG and cannot inherit a colour), and the skeleton gradient. The motion
tokens are colour-free and are inherited unchanged, which is intended.

Contrast was computed analytically for every new pairing, not sampled from a
render:

| Pair | Ratio | Requirement |
|---|---|---|
| `.num-zero` `#4C555B` on `#FFFFFF` | 7.6:1 | AA normal text |
| `.num-nil` `#676F74` on `#FFFFFF` | 5.1:1 | AA normal text |
| `.state-cleared` `#393A3D` on `#E3F1E9` | 9.7:1 | AA normal text |
| `.tr-kb` `#393A3D` on `#EDF2F0` | ~10:1 | AA normal text |

`.todo-n.warn` and `.todo-n.ok` reuse the existing `--qb-warn`/`--qb-warn-bg` and
`--qb-ok`/`--qb-ok-bg` badge pairings, which round 1 established at >= 4.5:1.

---

## 4. Gate results

Every command below was run in this sandbox on the final tree.

| Command | Exit code | Output |
|---|---|---|
| `npm run test:ssr` | **0** | `mtest components=27 failed=0` |
| `npm run test:audit` | **0** | `audit entities=119/119 jes=2121 fails=0` |
| `npm run build` | **0** | `build done -> dist/` + runtime deployment assets PASS |
| `node tools/run-verifiers.mjs` | **0** | `Verifier summary: 44/44 passed` |
| `node verify-global-visible-english.mjs` | **0** | 8 static page contracts + source/dist no-mojibake gate |
| `npm run test:navigation-a11y` | **0** | mobile drawer + focused navigation group |
| `git diff --check` | **0** | no whitespace errors |

**`npm run test` (21 scripts).** This sandbox terminates any process outliving a
single 45-second tool call, so the chain was run as consecutive foreground
segments covering all 21 scripts. Each exited 0:

```
segment 1  test:ssr=0  test:authoritative-bank=0  test:authoritative-reports=0
segment 2  test:wbs-accounting-foundation=0  test:wbs-accounting-acceptance=0
           test:wbs-mcp-lineage=0  test:ap-ar=0  test:api-client=0
segment 3  test:attachment-client=0  test:oidc=0  test:runtime-config=0
           test:ai-draft-je-contract=0  test:ai-review-outcome-contract=0
           test:navigation-a11y=0
segment 4  test:workflow=0  test:autorecon=0  test:audit=0
segment 5  test:visual=0                       (Verifier summary: 44/44 passed)
segment 6  test:release-harness=0  test:release-simulation=0
segment 7  test:release-evidence-bundle=0
```

The chain is a `&&` sequence that short-circuits on the first non-zero exit, and
no member is non-zero, so `npm run test` exits 0. **A reviewer on a normal
machine should still run it as one command** — segmented execution proves each
script passes, not that the chain has no inter-script ordering dependency.

**Static checks run in addition to the gates:**

- CSS braces balance to zero.
- No `translateY(` and no `scale(` anywhere in the stylesheet.
- No undefined `var(--...)` reference (the six flagged by a naive line-start
  regex — `--qb-ok-bg`, `--qb-ok-line`, `--qb-warn-bg`, `--qb-warn-line`,
  `--qb-bad-bg`, `--qb-bad-line` — are defined mid-line in `:root` and in
  `body.dark`; this is pre-existing formatting, not a real gap).
- Every one of the 18 new class names is both defined in CSS and used in source.
- `verify-navigation-multi-expand.mjs` passes unchanged; no navigation markup was
  touched in this round.

---

## 5. What is **not** verified

Stated plainly, because two earlier rounds over-claimed here.

1. **Nothing in this round has been rendered, screenshotted or measured.** This
   sandbox has no Chromium, Playwright, Puppeteer, `jsdom`, `happy-dom` or
   `linkedom`, and `file://` is blocked, so the locally connected browser cannot
   reach the output either. Every visual claim in section 2 is a claim about
   **what the CSS and JSX say**, derived by reading them. It is not a claim about
   pixels. `docs/preview/shell-preview.html` exists so a human can close this gap
   in one double-click.

2. **The reduced-motion story is untested at runtime.** The media query and the
   skeleton gradient strip are correct by inspection, but no one has actually set
   "reduce motion" and watched the result. The preview note tells the reviewer
   exactly what to check: the sweep must stop completely, not freeze mid-gradient,
   and every hover tint must become instant.

3. **The keyboard-vs-pointer row distinction is untested at runtime.** The `kb`
   state transitions are simple, but the specific interaction that matters —
   arrow down three rows, then nudge the mouse, and confirm the accent row
   reverts to a plain hover — has been reasoned about, not performed. There is
   a plausible failure mode I could not rule out: on a touch device or a trackpad
   with inertial scroll, a stray `mousemove` could clear `kb` while the user is
   still navigating by keyboard. The consequence is cosmetic (the row loses its
   accent marker but keeps the hover tint and still opens on Enter), but it is
   real.

4. **The badge mark shapes are 6–8px.** Whether a hollow 6px ring, a half-filled
   6px ring and a 7px square are actually *distinguishable at a glance* at that
   size, on a real display, is exactly the sort of thing that needs an eye and
   not a stylesheet. The greyscale toggle in the preview is there for that
   judgement. If they turn out to be too subtle the honest fix is to grow the
   mark to 8px or move it into the badge's own weight, not to lean back on hue.

5. **Dark mode was reasoned, not rendered** (unchanged from rounds 1 and 2). The
   contrast ratios in section 3 were computed, not sampled.

6. **The queue-tile denominators are truthful for the current data shape, and
   that is a narrower claim than it sounds.** "Total bank transactions" means
   every transaction currently loaded across every account in `ctx.bank.accounts`
   — it is not a statement about a period, an entity filter, or a bank feed. The
   same applies to bills and exceptions. If a later change scopes those
   collections differently, the denominators shift with them, and the tile will
   still be arithmetically correct but may answer a different question than the
   reader expects. This is the single place in round 3 where a UI element states
   a figure the user might reasonably interpret more broadly than it is meant.

7. **`.num-nil` now appears in places I did not enumerate.** `Money` previously
   rendered an empty string for `null`/`undefined` and now renders a dash. Every
   `<Money>` call site inherits that. The 27-component SSR smoke and the 119-entity
   ledger audit both pass, so nothing crashes and no total changed — but I did not
   walk all call sites to confirm each one *wants* a dash rather than a blank.
   Reading a dash as "no amount" is the correct default; a specific screen may
   still want different copy.

8. **`*{transition-property: ...}`** is a structural guard, and structural guards
   have blast radius. It restricts what any element with a duration but no
   explicit property list can animate. I grepped every `transition` and
   `animation` declaration in the stylesheet and all of them set the property
   explicitly, so nothing in the product today is affected — but a future editor
   adding `transition-duration` alone will find it silently does nothing, and
   that is a trap worth knowing about.

9. **Round 2's open risks all still stand** and were not addressed here: the
   white-on-white content shell, the 11-item rail scrolling below ~870px, 52px
   panel rows costing IA visibility, the one-pill `Create actions` row, and the
   abbreviated rail labels. Round 3 was scoped as refinement, not restructure.

---

## 6. What is still visually unfaithful to QuickBooks, and why

| Gap | Why it stays |
|---|---|
| No `‹ ›` carousel on the chip row or the account tiles | `verify-dashboard-quicklinks-layout.mjs` pins a wrapping flex row. Wrapping is also the better answer when there are five chips, not fifteen. Documented deviation since round 2. |
| Buttons are 16px/36px per the measurement, but `.btn-sm` stays 30px/13px | A 16px in-row action out-shouts 14px cell text. Documented judgement call since round 1, unchanged. |
| No split primary button with a caret segment | `QB-DESIGN-TOKENS.md` section 5 measures one, but REFS has exactly one create action (`Journal entry`). A caret with one item in it is decoration. |
| Table headers are sentence case 14/600, not the 11px uppercase REFS used to have | This *is* the measurement. Noted only because it is a visible density change from the pre-round-1 product. |
| The nav panel lists every open group, not exactly one | Deliberate: multi-expand is a REFS behaviour contract guarded by `verify-navigation-multi-expand.mjs`. QuickBooks shows one group; REFS must not. |
| Money badge/pill marks are a REFS invention | QuickBooks does not encode workflow stage in mark geometry — it does not have this five-stage workflow to encode. This is an independent solution to the colour-blindness requirement, informed by the measured badge dimensions but not copied from anything. |
| The `cleared` state is a REFS invention | QuickBooks has no equivalent. It comes from the brief's "an empty queue should read as an accomplishment", not from a measurement. |

No QuickBooks markup, CSS, icon, image or font asset is copied. Every measured
value used above comes from `docs/QB-DESIGN-TOKENS.md` and
`docs/QB-SHELL-STRUCTURE.md`, which record observable layout from a live session
and were taken to inform an **independent** implementation. REFS makes no claim
of QuickBooks parity or equivalence.
