# UI System Pass — TASK-TO-CLAUDE-2026-08-05-004

**Base SHA:** `122f475` (`feat: integrate authoritative bank match and report evidence`)
**Branch:** `claude/final-ui-system-pass-122f475`
**Round 1:** `d2c4c86` — tokens (color / radius / shadow / type). 2026-08-05.
**Round 2:** structural pass — shell and home composition. 2026-08-06. See section 8.
**Round 3:** refinement and feel — motion, numeric legibility, scannability,
status marks, queue progress. 2026-08-06. Documented separately in
`docs/UI-ROUND-3-POLISH.md`; this file is unchanged apart from this line.
**Specification:** `docs/QB-DESIGN-TOKENS.md` (round 1) and
`docs/QB-SHELL-STRUCTURE.md` (round 2), both measured from live QuickBooks Online
sessions via a `getComputedStyle` census.

> Round 1 changed the *token layer* only and kept REFS' original layout. Compared
> side by side against QuickBooks the product still read as a different
> application, because the difference was structural. Round 2 (section 8) replaces
> the navigation structure and the home composition. Round 1's findings below are
> unchanged and still accurate for the token layer.

> **No release / no accounting behavior change.** This pass changes visual language,
> layout, responsive behavior, and accessibility affordances only. No accounting
> calculation, source classification, state machine, API/OpenAPI contract, migration,
> WBS/MCP logic, or authorization rule was modified. `Draft -> Review -> Approve -> Post`,
> segregation of duties, immutable Posted evidence, and reversal-only correction are
> untouched. No export, payment rail, bank feed, connect/import/OCR, auto-match,
> auto-categorize, auto-post, sign-off, destructive action, or promotion was added.
> The `Cash movement evidence` label and its "not a complete statement of cash flows"
> disclaimer are unchanged. **This is not a release and makes no claim of QuickBooks
> parity or equivalence.**

---

## 1. Changed files

| File | Nature of change |
|---|---|
| `index.html` | Whole `<style>` block replaced. Nine stacked override layers collapsed into one token-driven system. Removed the Google Fonts (`Inter`) `<link>` pair. |
| `src/ui.jsx` | `Btn` emits `aria-disabled`; new `Segmented` and `StateBlock` shared components; `Table` gained `loading`/`error` states and per-cell `title` for truncated text. |
| `src/app.jsx` | `AuditLog` bare table wrapped in a focusable `.table-wrap` scroll region. |
| `src/modules-core.jsx` | JE line grid wrapped in a focusable scroll region; JE queue switcher replaced with the shared `Segmented` control carrying counts inside labels. |
| `docs/UI-SYSTEM-PASS-122f475.md` | This document. |

`docs/QB-DESIGN-TOKENS.md` was read as the specification and not modified.
`src/module-banktx.jsx` and `src/module-bankrec.jsx` were **not edited** — their
token consistency is delivered entirely through shared CSS, so the other agent's
behavioral branch does not conflict on those files.

---

## 2. What was consolidated

The baseline `index.html` carried **nine** sequentially appended CSS layers that
fought each other across breakpoints:

1. generic base `:root` (blue `#2C6BED`, `--radius:10px`)
2. "QBO RESKIN" (old QB green `#2CA01C`, dark `#282828` rail)
3. "Apple polish + nav nowrap" (added `translateY(-2px)` hover lifts)
4. "Premium blue theme" (`#0B57D0`)
5. "Tech-feel finishing" (gradient buttons, aurora body, `cardIn` animations)
6. "2026 Modern Pass" (`--radius:16px`, uppercase 11.5px table headers, pastel `nth-child` cards)
7. "Art pass: aurora + glass" (radial-gradient body, gradient-clipped `.page-h` text)
8. "REFS PRODUCT SYSTEM / 2026-08" (green `#18864b`, re-tightened everything)
9. three further "phase" / "density" / "drill-through" patches

Four different brand colors, three different radius scales, and five different
sidebar treatments were live simultaneously; the winner depended on source order
rather than intent. Concretely: `--radius` was declared 3 times, `.sidebar` width
6 times, `.tbl th` background 7 times, `.page-h` 6 times, and there were **14
distinct breakpoints** (1800/1500/1320/1280/1200/1120/1080/1050/900/800/720/700/600/420).

The replacement is a single ordered stylesheet:

1. tokens (`:root` + `body.dark`)
2. base / typography
3. app shell (sidebar, topbar, page hierarchy, full-page Back)
4. buttons, segmented control, chips, form controls, filter rows
5. surfaces, metric grids, badges, tables, states
6. layout + overlays + the ten workspaces
7. one responsive ladder: **1440 / 1280 / 1024 / 768 / (720, 600) / 430 / 360**
8. dark-mode parity

Every legacy variable name (`--bg-canvas`, `--divider`, `--brand`, `--radius`,
`--shadow`, `--accent`, `--text-3`, `--focus-ring`, ...) is now an **alias** onto
the one system, so no page keeps a private palette and no rule had to be rewritten
to adopt the tokens. `--accent` and `--text-3` were referenced by 7 rules in the
baseline but **never defined** — they now resolve.

---

## 3. Shared tokens

```
--qb-canvas #F4F5F8   --qb-surface #FFFFFF   --qb-inset #F7F8FA
--qb-text #393A3D     --qb-text-strong #21262A
--qb-text-muted #4C555B --qb-text-faint #676F74
--qb-border #C3CED5   --qb-border-soft #D4D7DC
--qb-border-alt #DDDDDD --qb-divider #E2E9ED
--qb-brand #003E31 (fill)  --qb-brand-fg #FFFFFF  --qb-accent #003E31 (ink/border)
--qb-link #205EA3     --qb-info #0097E6
radii 6 control / 8 card / 9999 pill / 4 chip / 12 panel
--qb-shadow-card 0 1px 4px rgba(76,85,91,.20)
--qb-shadow-strong 0 1px 4px rgba(33,38,42,.60)
--qb-shadow-stick -2px 0 2px rgba(0,0,0,.15)
--qb-control-h 36px   --qb-control-h-sm 30px
--qb-sans "Avenir Next","Segoe UI",-apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif
```

**Brand is split into two tokens** (`--qb-brand` = filled surface,
`--qb-accent` = ink/border on canvas). A single token cannot satisfy both
"white text on the fill" and "readable text on the canvas" in dark mode. In dark
mode `--qb-brand:#3FA982` with `--qb-brand-fg:#05231A` (dark ink on light green,
6.5:1) and `--qb-accent:#7BD4AF` for text and borders.

Every token above is redefined under `body.dark` — nothing falls through to a
light value.

### Shared components changed

| Component | Change |
|---|---|
| `Btn` | Adds `aria-disabled="true"` when disabled, so an unavailable reference action is announced, not only painted. |
| `Segmented` (new) | `role="tablist"` white-item-on-gray-track control; renders counts inside the label (`Needs review (3)`). |
| `StateBlock` (new) | One empty / loading / error block with `role="status"`, `aria-live="polite"`, `aria-busy`. |
| `Table` | New optional `loading` / `error` props routed through `StateBlock`; every text cell gets a `title` so truncated content stays reachable; `.table-wrap` is a focusable scroll region with a `max-height` so the sticky header actually sticks. |
| `Money` | Unchanged JSX; `.num` retokened to the sans face with `tabular-nums`. |
| `Tabs` | Unchanged JSX (ARIA preserved); `.tabs`/`.tab` restyled into the segmented control. |

---

## 4. The ten divergences from the tokens doc

| # | Before (baseline `122f475`) | After | Where |
|---|---|---|---|
| 1 | 4 competing brands: `#2C6BED`, `#2CA01C`, `#0B57D0`, `#18864b` | `--qb-brand:#003E31` / `--qb-accent:#003E31`, one source | `:root`, all legacy names aliased |
| 2 | `--radius` declared 3x (`10px`, `16px`, `8px`) plus ad-hoc `5px/7px/12px/14px/20px` | `6` control / `8` card / `9999` pill / `4` chip / `12` panel | `--qb-r-*` |
| 3 | `0 4px 12px`, `0 8px 30px`, `0 16px 40px`, `0 24px 60px` glow/gradient shadows | `--qb-shadow-card 0 1px 4px rgba(76,85,91,.20)`; borders do the separation | surfaces reset to `box-shadow:none` |
| 4 | `translateY(-2px)`/`-3px scale(1.005)` lift on `.card-hover`, `.kpi`, `.qbo-card`, `.acct-card`, `.todo-item`; `cardIn`/`fadeUp` entrance animations | no lift anywhere; hover is a background tint only; entrance animations removed | `.card:hover{transform:none}` |
| 5 | `.num{font-family:var(--mono)}` — money in SF Mono | `.num{font-family:var(--qb-sans); font-variant-numeric:tabular-nums lining-nums}`; `--mono` retained only for `code`/`.mono` | section 1 |
| 6 | `.btn{padding:8px 15px; font-size:14px; min-height:34px}` | `min-height:36px; font:500 16px; radius 6`; primary filled `#003E31` border-0; **secondary `2px` outline**; `.btn-sm` 30px/13px for in-row density | section 4 |
| 7 | dark rail: `#282828` -> `#1E1F24` -> `linear-gradient(#17181d,#1b2030)` -> `#202522` | light `#FFFFFF` rail, `#D4D7DC` right border, per-group colored circular icon badges, chevron groups, selected row = `#E2E9ED` fill + 3px accent inset | section 2 |
| 8 | `.chip`/`.bank-queue-tabs` underline tabs and filled-green pills for queues | segmented control: `#E2E9ED` track, `padding:2px`, 32px items, radius 5, selected = white + `0 1px 4px rgba(76,85,91,.2)`; count pill inside the label | section 4 |
| 9 | `.link{color:var(--brand)}` (whatever brand won that layer) | `--qb-link:#205EA3`, `font-weight:500`, no underline until hover | section 1 |
| 10 | one `--divider` token doing all four jobs | four tokens: `--qb-border` (controls), `--qb-border-soft` (cards), `--qb-border-alt` (tables), `--qb-divider` (panel dividers + segmented track) | `:root` |

---

## 5. Other substantive fixes

**93 of 305 class names used in JSX had no CSS rule at all** in the baseline —
semantic wrappers falling back to browser defaults, which is the direct cause of
the concatenated labels and collapsed metric rows in the brief. Examples:
`card-head`, `card-h`, `kv-grid`, `mini-table`, `stack`, `two`, `filter-label`,
`expense-toolbar`, `expense-search`, `expense-shell-panel`, `expense-filter-evidence`,
`gl-drill-head`, `gl-drill-crumb`, `source-doc-shell`, `source-doc-kv`,
`report-preview-head`, `report-preview-titlewrap`, `qbo-report-tabs`,
`qbo-insight-metrics`, `bank-queue-empty`, `bank-pagination`, `je-search`,
`je-queue-chips`, `detail-grid`, `balance-row`, `mobile-nav-close`.
After the pass **4 remain**, and all four are co-classes or false positives from
template-literal parsing (`qbo-preview-toolpanel` inherits `.qbo-report-toolpanel`;
`balanced`, `cls`, `drill` are fragments of interpolated expressions).

**Page-level horizontal overflow.** Seven tables rendered without any scroll
container. Two are now wrapped (`AuditLog`, the JE line grid), two already had
wrappers (`authoritative-bank-workspace`, `authoritative-reports-workspace`), and
the remaining bare `<section><table class="tbl">` cases are handled without markup
change by `section:has(>table.tbl){overflow-x:auto}`. Below 768px `.tbl th` is
allowed to wrap, since an unwrappable header row is the main remaining cause of a
sideways page scroll on a table with no `min-width`.

**Stable headers.** `.table-wrap` gained `max-height:min(74vh,880px)`, which gives
the already-sticky `th` an actual scrollport. Short tables are unaffected. The
max-height is lifted below 768px where vertical space is the scarce resource.

**Disabled / read-only.** One treatment for `:disabled` and `[aria-disabled=true]`
across `.btn`, raw buttons, `.grid-tool`, quicklinks, report controls and preview
bar: `background:var(--qb-inset)`, `color:var(--qb-text-faint)` (4.8:1),
`border-color:var(--qb-border-soft)`, `cursor:not-allowed`, no hover response.
Critically, a **disabled item on a segmented track is forced flat** — the default
raised-white treatment would have made an unavailable option read as *selected*.
For the same reason `.qbo-report-previewbar` was reclassified from segmented track
to action toolbar, because it mixes a toggle with three permanently unavailable
reference actions.

**Focus.** One global `:focus-visible{outline:2px solid var(--qb-accent); outline-offset:1px}`
plus explicit rings on `.th-sort`, `.table-wrap`, `.je-lines-scroll`, nav items and
card buttons. `prefers-reduced-motion` is honored.

**Preserved verified behaviors.** Sidebar groups still expand independently
(`navigation-open-state.js` untouched; `verify-navigation-multi-expand` passes) with
`aria-expanded`/`aria-controls`/`aria-current` unchanged. The Reports control area
remains a responsive grid. English-only build passes.

---

## 6. Gate results

| Command | Exit code | Result |
|---|---|---|
| `npm run test` | **0** | full suite (includes ssr, audit, visual, release harness) |
| `npm run test:visual` | **0** | `Verifier summary: 39/39 passed` |
| `npm run build` | **0** | `dist/bundle.js` 827.3kb, `build done -> dist/` |
| `node verify-global-visible-english.mjs` | **0** | 8 static page contracts + source/dist no-mojibake gate |
| `git diff --check` | **0** | no whitespace errors |
| `npm run test:ssr` | **0** | `components=27 failed=0` |
| `npm run test:audit` | **0** | `entities=119/119 jes=2121 fails=0` |

`npm run test:visual` in this repository is a Node verifier runner
(`tools/run-verifiers.mjs`), not a browser harness, so it ran to completion here.

---

## 7. Remaining risks

1. **No live browser verification was performed on this branch.** The sandbox has
   no Chromium, Playwright, Puppeteer, or jsdom, and the locally connected Chrome
   cannot reach the sandbox HTTP server or `file://` URLs. The responsive claims at
   1440/1280/1024/768/430/360 rest on a **static audit** (token/brace/undefined-var
   checks, an enumeration of every `min-width`/`width` >= 360px against its scroll
   container, and per-breakpoint rule review) — not on rendered screenshots. This is
   the single largest verification gap and should be closed by a reviewer with a
   browser before any release decision.
2. **Table headers moved from 11px uppercase to the measured 14px/600 sentence case.**
   That is the specification, but it is ~2px wider per column. Padding was reduced
   from `10px 14px` to `8px 12px` to compensate; a wide ledger at 1280px may still
   scroll inside its container more often than before. This is intended
   (table-local scroll) but it is a visible density change.
3. **`section:has(>table.tbl)`** relies on CSS `:has()`. Supported in all current
   evergreen browsers; a legacy engine would fall back to page-level overflow for
   two `authoritative-*` tables only.
4. **`.btn` is now 16px type.** In dense areas that use full-size buttons rather
   than `size="sm"`, rows are taller than before. I kept `.btn-sm` at 30px/13px as a
   deliberate deviation from the doc's flat 36px/16px rule, because 16px in-row
   actions would out-shout 14px cell text. This is a documented judgement call, not
   a measurement.
5. **`src/module-banktx.jsx` / `src/module-bankrec.jsx` were not opened for edit.**
   Their appearance now depends entirely on shared CSS. If the other agent's
   behavioral branch changes that markup, some bank-specific rules
   (`.bank-table .tbl th:nth-child(n)` widths, `.bank-queue-tabs` segmented
   treatment) may need re-pointing at merge time.
6. **`src/app.jsx:54`** contains a pre-existing latent bug in
   `SingletonNavigationDirect`: `header.textContent?.replace(/[????]/g,'')` uses
   literal `?` characters (collapsed mojibake) and cannot strip the caret glyphs it
   intends to, so its route lookup never matches. The handler is redundant with the
   `isSingleton` `onClick` path, so behavior is unaffected. **Left untouched** —
   fixing it would be a navigation behavior change, outside this task's scope.
7. **Dark mode was reasoned, not rendered.** Contrast ratios were computed
   analytically (all sampled text/background pairs land >= 4.5:1, most >= 6:1) but
   no dark screenshot exists.

---

# 8. Round 2 — structural pass

**Parent commit:** `d2c4c86`
**Date:** 2026-08-06
**Specification:** `docs/QB-SHELL-STRUCTURE.md`

> **No release / no accounting behavior change.** Round 2 changes navigation
> structure, home-page composition, and shared surface rhythm only. No accounting
> calculation, source classification, state machine, API/OpenAPI contract,
> migration, WBS/MCP logic, or authorization rule was modified.
> `Draft -> Review -> Approve -> Post`, segregation of duties, immutable Posted
> evidence, and reversal-only correction are untouched. No export, payment rail,
> bank feed, connect/import/OCR, auto-match, auto-categorize, auto-post, sign-off
> automation, destructive action, or promotion was added. The `Cash movement
> evidence` label and its "not a complete statement of cash flows" disclaimer are
> unchanged. Visible copy stays English-only. **This is not a release and makes no
> claim of QuickBooks parity or equivalence.** No QuickBooks markup, CSS, icon,
> image, or font asset is copied; the proprietary `Avenir Next forINTUIT` face is
> never embedded or referenced.

## 8.1 Changed files

| File | Nature of change |
|---|---|
| `index.html` | Section 2 (app shell) rewritten: rounded content shell + 74px icon rail + white second-level panel. New structural tokens in `:root` and `body.dark`. Section heading scale, surface hairlines/padding, centered empty states, dashboard greeting/chip/pill rules, responsive and dark-mode additions. Still **one ordered stylesheet** — no new override layer was appended. |
| `src/app.jsx` | Sidebar markup split into `.nav-rail` + `.nav-panel`. `NAV` entries gained `short` (11px rail label), `glyph` (icon key) and `railBreak`. `Approvals` sub-headings moved onto the shared 16/600 scale. |
| `src/ui.jsx` | New exported `Icon` component with a self-authored `ICON_PATHS` map (15 stroke glyphs on a 24x24 grid). |
| `src/modules-core.jsx` | `Dashboard` recomposed to greeting -> feature chips -> create actions -> queue actions -> section heading -> cards. |
| `tools/build-shell-preview.mjs` | New generator for the standalone static preview. |
| `docs/preview/shell-preview.html` | Generated artifact — single self-contained file, no build step. |
| `docs/QB-SHELL-STRUCTURE.md` | The round-2 specification (added to the repository, not authored here). |
| `docs/UI-SYSTEM-PASS-122f475.md` | This section. |

`src/module-banktx.jsx` and `src/module-bankrec.jsx` were **not opened for edit**;
their round-2 appearance comes entirely from shared CSS, so the parallel bank
branch does not conflict on those files.

## 8.2 The section 0 gap table, row by row

| Row | Before (`d2c4c86`) | After (round 2) |
|---|---|---|
| **Left nav** | one 264px column: white panel, per-group circular badge, chevron groups, filled `#003E31` `+ New` | **74px `#F0F4F6` icon rail** of 68x64 items (24px self-authored stroke icon above an 11/600 `#21262A` label) **+ a 236px white second-level panel**. Selected group's glyph sits on a filled 44x44 `#003E31` rounded square with a white glyph; the label stays plain. Panel rows are 52px: 24px circular colored badge + 14/400 label + right chevron, selected row gets a light gray fill and **no left bar**. Six group hues, light and dark. A hairline separates the reporting/admin block from the operational block. |
| **Page title** | `Business overview`, left, 28px | `Good morning, <first name>` — **centered, 34px/500, 44px line-height**, in a three-column row whose left cell is an equal-width spacer so the greeting is centered against the page, not against the leftover space. |
| **Primary entries** | text pills with a trailing `→` glyph, 36px, radius 6 | **48px pill chips**, radius 9999, `0.8px #D5DEE3`, `padding 8px 18px 8px 8px`, `gap 12px`, label 14/600, each led by a **32px `#04263A` circular icon badge with a mint glyph**. The trailing arrows are gone. |
| **Quick actions** | none (a `Shortcuts` row of default buttons existed lower down) | a `Create actions` heading (16/600) + a row of **44px outlined pills** (radius 9999, `0.8px #D5DEE3`), and a second `Open a queue` pill row. See 8.4 for why `Create actions` holds one pill. |
| **Cards** | radius 8, `1px #D4D7DC`, 17-18px padding | radius 8, **`0.8px #E2E9ED` hairline**, **24px padding**, no shadow, uppercase 12/600 `.04em` labels, tabular-nums figures. Grid gap 14 -> 16. |
| **Overall** | dense grey-canvas dashboard | content sits in a **rounded white shell inset 6px** from the `#F4F5F8` canvas (nav flush left); section headings dropped 20px -> **16/600**; `h3` base 20 -> 16; metric tiles 10/12 -> 14/16 padding; filter bars 10/14 -> 14/16; empty states became a **centered 48px glyph circle + 16/600 headline + 14/400 body**. |

## 8.3 The multi-expand contract survives

This was the highest-risk part of the redesign, because QuickBooks' rail shows the
pages of exactly one group and REFS must keep several groups open at once.

- The rail item **is** the old `.nav-group-h` button. It keeps
  `aria-expanded={isSingleton?undefined:opened}`,
  `aria-controls={isSingleton?undefined:groupPanelId}`, the same
  `toggleNavigationGroup(o, g.group)` click handler, and the same
  `retainActiveNavigationGroup` effect. `src/navigation-open-state.js` was not
  touched.
- The panel renders **every** open group, stacked, each with its own
  `<div id={groupPanelId} className="nav-group-items">` and each child keeping
  `aria-current={route===k?'page':undefined}`. Selecting a child still cannot
  collapse another group.
- Because the rail glyph square marks the *current* group rather than the *open*
  ones, an expanded rail item additionally keeps a `#E2E9ED` background tint
  (`.nav-group-h[aria-expanded="true"]`), so the rail still shows which groups
  are listed below.
- When only singleton groups are active the panel shows
  `Choose a section in the rail to list its pages.` rather than collapsing, so
  the shell width does not jump.
- `verify-navigation-multi-expand.mjs`, `tests/navigation-a11y.test.js` and
  `verify-accessibility-baseline.mjs` all pass unchanged.

**Accessible-name change:** the rail button's accessible name is now the short
label (`Reconcile`, `Sources`, `Operations`) rather than the full group name; the
full name is on `title`. An `aria-label` carrying the full name was deliberately
*not* used, because `Sources` / `Reconcile` / `AP / AR` are not substrings of
their group names and that would violate WCAG 2.5.3 label-in-name.

## 8.4 Omitted affordances

Only entry points whose destination actually offers the action are surfaced.

| QuickBooks shows | REFS decision | Why |
|---|---|---|
| `Customize` and `Privacy` ghost links beside the greeting | **omitted** | REFS implements neither. The right cell holds three real workspace links instead. |
| `Create actions`: add customer, add product/service, create invoice, `Show all` | **one pill: `Journal entry`** | `je` is the only workspace that exposes a create (`+ New Journal Entry`). `module-ap.jsx`, `module-coa.jsx` and the AR receipt queues are deliberately read-only retained evidence (`Account creation, editing, activation, and deactivation are unavailable`), and `module-ar.jsx`'s invoice drawer has no trigger. Adding `Create invoice` / `Create bill` / `Add account` pills would each be a dead affordance. A muted note states this on the page. A second `Open a queue` row carries the five real work queues. |
| `Show all` link at the end of the create row | **omitted** | there is nothing further to show. |
| Chip carousel with `‹ ›` overflow chevrons | **wraps instead** | `verify-dashboard-quicklinks-layout.mjs` pins `.qbo-quicklinks{display:flex;flex-wrap:wrap;gap:8px`. Five chips fit on one line at desktop widths; below that they wrap rather than hide behind chevrons. Documented deviation. |
| `PINNED` rail group header | **omitted** | REFS has no pinning. A plain hairline separator is used instead. |

## 8.5 Hover lift

`translateY` and `scale(` do not appear anywhere in `index.html` or in any
`src/*.jsx` inline style (verified by grep over the whole stylesheet and all JSX).
An explicit guard rule forces `transform:none; box-shadow:none` on hover for
`.card`, `.kpi`, `.qbo-card`, `.acct-card`, `.card-hover`, `.todo-item`,
`.rep-card`, `.chip`, `.btn`, `.nav-item`, `.nav-group-h`, `.qbo-quicklinks button`
and table rows. Hover is a background tint only.

## 8.6 Gate results (round 2)

| Command | Exit code | Result |
|---|---|---|
| `npm run test` | **0 (composite)** | see the note below |
| `npm run test:visual` | **0** | `Verifier summary: 39/39 passed` |
| `npm run build` | **0** | `dist/bundle.js` 832.1kb, `build done -> dist/` |
| `node verify-global-visible-english.mjs` | **0** | 8 static page contracts + source/dist no-mojibake gate |
| `npm run test:ssr` | **0** | `mtest components=27 failed=0` |
| `npm run test:audit` | **0** | `audit entities=119/119 jes=2121 fails=0` |
| `git diff --check` | **0** | no whitespace errors |

**Note on `npm run test`.** It is a `&&` chain of 21 sub-scripts and takes roughly
two minutes. The sandbox used for round 2 terminates any process that outlives a
single tool call (hard 45-second ceiling), so the chain could not be executed as
one process. Every sub-script was instead run in order, in the foreground, and
each exited 0:

```
test:ssr=0  test:authoritative-bank=0  test:authoritative-reports=0
test:wbs-accounting-foundation=0  test:wbs-accounting-acceptance=0  test:ap-ar=0
test:api-client=0  test:attachment-client=0  test:oidc=0  test:runtime-config=0
test:ai-draft-je-contract=0  test:ai-review-outcome-contract=0
test:navigation-a11y=0  test:workflow=0  test:autorecon=0  test:audit=0
test:visual=0  test:release-harness=0  test:release-simulation=0
test:release-evidence-bundle=0
```

Since the chain short-circuits on the first non-zero exit and no member is
non-zero, `npm run test` exits 0. A reviewer on a normal machine should run it as
one command to confirm.

## 8.7 Static preview

`docs/preview/shell-preview.html` is a single self-contained file with no build
step. It inlines the product `<style>` block **verbatim** from `index.html` and
reads the icon path data **from `src/ui.jsx`**, so it cannot drift from the
product stylesheet or the product icon set. The markup is hand-written to mirror
what React renders: the rail with all eleven groups (one selected), the panel with
two groups expanded simultaneously, the topbar, the centered greeting with its
right-hand links, the chip row, both pill rows, three cards, the attention grid,
and one empty state. A `Toggle dark mode` button is included. Regenerate with
`node tools/build-shell-preview.mjs`.

## 8.8 Remaining risks and what is NOT verified

1. **No rendered verification of any kind.** The round-2 sandbox has no Chromium,
   Playwright, Puppeteer, `jsdom`, `happy-dom` or `linkedom`, no `pip` browser
   automation, and no way to reach a local server from the user's Chrome. Every
   visual claim in section 8.2 is a claim about **what the CSS and JSX say**, not
   about pixels. Nothing here has been screenshotted, measured, or compared side
   by side. `docs/preview/shell-preview.html` exists precisely so a human can
   close this gap.
2. **The rounded white content shell is the highest-risk single change.**
   `.main` is now `#FFFFFF` instead of `#F4F5F8`, which means white cards now sit
   on white with only a `0.8px #E2E9ED` hairline separating them. That is what the
   measurement says QuickBooks does, and it is the main reason the product read as
   a "dense enterprise dashboard" before. But if the hairlines read as too faint
   in practice, nine workspaces will look flatter than they did, not calmer.
   This is a one-line revert (`.main{background:var(--qb-canvas)}`) if it is wrong.
3. **The rail is 11 items tall.** 11 x 72px = ~792px plus the logo. Below roughly
   a 870px viewport the rail scrolls, and its scrollbar is hidden so the 68px item
   keeps the full 74px track. Wheel and keyboard reach still work, but there is no
   visual scroll cue. QuickBooks' rail carries fewer groups; REFS' IA has eleven.
4. **Panel rows are 52px per the specification.** With several groups expanded and
   `Accounting Operations` holding eleven items, the panel scrolls sooner than the
   old 32px rows did. That is a deliberate spec-following density change, not an
   accident, but it is a real regression in how much of the IA is visible at once.
5. **`Create actions` has one pill.** Truthful, but visually thin next to
   QuickBooks' four. If REFS later exposes a real invoice or bill create, it
   belongs in that row.
6. **Rail labels are abbreviations.** `Reconcile`, `Sources`, `Operations`,
   `AP / AR`. They fit 66px at 11/600 by calculation, not by measurement; a
   different fallback font could ellipsize `Operations`.
7. **Greeting is time-of-day dependent** (`new Date().getHours()`). Client-side
   only, so there is no SSR hydration concern in this app, but the string differs
   between renders across a boundary hour.
8. **Dark mode was reasoned, not rendered** (unchanged from round 1). All new
   tokens have `body.dark` values, including the empty-state glyph, which is a
   data-URI SVG and therefore needs its own dark stroke color rather than
   inheriting one.
9. **`src/module-banktx.jsx` / `src/module-bankrec.jsx` were not opened.** Their
   round-2 appearance depends entirely on shared CSS; a merge with the parallel
   bank branch may need the bank-specific rules re-pointed.
10. **`src/app.jsx` `SingletonNavigationDirect` is still the pre-existing dead
    handler** described in round 1 risk 6. With the rail its `textContent` lookup
    now happens to match the `Reports` singleton, which calls `goto('reports')` —
    identical to that button's own `onClick`, so behavior is unchanged. It was
    left untouched because repairing it is a navigation behavior change.
