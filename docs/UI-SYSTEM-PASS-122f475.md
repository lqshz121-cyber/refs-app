# UI System Pass — TASK-TO-CLAUDE-2026-08-05-004

**Base SHA:** `122f475` (`feat: integrate authoritative bank match and report evidence`)
**Branch:** `claude/final-ui-system-pass-122f475`
**Date:** 2026-08-05
**Specification:** `docs/QB-DESIGN-TOKENS.md` (measured from a live QuickBooks Online
session on 2026-08-05 via a `getComputedStyle` census).

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
