# Two accessibility defects: the off-canvas drawer, and dark mode

Branch `claude/ui-round3-qb-polish`. Both defects were found by a browser
evidence pass on 2026-08-06 against the deployed build. The fixes below are
visual and accessibility only: no accounting calculation, source classification,
state machine, API contract, migration, WBS/MCP rule or authorization decision
was touched.

## What is proved, and how

There is no browser in this environment and `file://` is blocked, so nothing
below is a re-measurement. Every claim is one of three kinds, and each is
labelled where it appears:

| kind | meaning |
| --- | --- |
| **executed** | real code was imported and called by a test that runs in the gate |
| **arithmetic** | computed from the CSS box model, or from the token values with the WCAG 2.x relative-luminance formula |
| **static** | asserted against the text of the shipped source or stylesheet |

The original browser measurements (42 tab stops, 16 off-screen, worst contrast
1.11:1) were **not** reproduced here. The mechanisms behind them were
reproduced arithmetically and they agree to rounding — see the table in
defect 2 — but the counts themselves are the other session's, not this one's.

`resize_window` is inert in this environment: it reports success while
`innerWidth` stays pinned, which is how an earlier 360px measurement went
wrong. It was not used.

`docs/preview/shell-preview.html` has been regenerated so the owner can check
both fixes by eye in a real browser. It now carries the ☰ opener, a
"Toggle the off-canvas drawer" control that writes the same `inert` /
`aria-hidden` pair the React shell writes, and a boot script that mirrors the
new operating-system theme resolution.

---

## Defect 1 — the off-canvas sidebar was a keyboard trap

WCAG 2.4.3 Focus Order (Level A) and 2.4.7 Focus Visible (AA).

### What was wrong

At `max-width:1024px` the sidebar is moved out of the viewport with

```css
.sidebar{position:fixed; top:0; left:0; transform:translateX(-100%); …}
```

and nothing else. A transform moves paint, not participation: the subtree stays
in the DOM, in the accessibility tree, and in the tab order. Measured at 768px:
42 tab stops, 16 of them off-screen, and the **first** tab stop in document
order was the invisible "Control" rail button at `left:-281px`. Loading the page
on a tablet and pressing Tab once made focus disappear.

The same rule applies to `src/authoritative-app.jsx`, which was worse: that
shell had no opener at all, so below 1024px its eight route buttons were
off-screen, in the tab order, and unreachable by any other means.

### The fix

`src/nav-drawer.js` (new) owns the whole contract as pure functions, so the gate
can execute it without a DOM:

```js
navDrawerIsInert(offCanvas, open)  // offCanvas && !open
navDrawerAttributes(offCanvas, open)
```

`navDrawerAttributes` returns `{inert:'', 'aria-hidden':'true'}` when the drawer
is off-canvas and closed, and `{inert:undefined, 'aria-hidden':undefined'}`
otherwise. Both shells spread it straight onto the `<aside class="sidebar">`.

Three details that are easy to get wrong:

- **`inert`, not `display:none` or `visibility:hidden`.** Both of those cancel
  the slide transition and make the drawer pop. `inert` leaves the element laid
  out and animating while removing it from the tab order, from hit testing and
  from the accessibility tree. The verifier asserts neither of the two banned
  properties appears on `.sidebar` inside the media block.
- **The empty string, not `true`.** React 18.3.1 does not know `inert` as a
  boolean DOM property and drops a literal `true` with a warning. `inert=""` is
  the HTML spelling of a present boolean attribute and React forwards it.
- **Read the viewport synchronously at mount.** `readOffCanvas()` is a lazy
  `useState` initialiser, not an effect. One frame of the wrong answer is one
  frame in which the first Tab lands off-screen, which is the defect itself.

Focus behaviour, both shells:

| event | behaviour |
| --- | --- |
| opener pressed | drawer opens, focus moves to the **Close** button inside it |
| Escape | drawer closes, focus returns to the opener |
| scrim or Close pressed | drawer closes, focus returns to the opener |
| a nav item selected | drawer closes, focus returns to the opener |
| viewport grows past 1024px | drawer stops being inert immediately |

Focus never ends up abandoned inside a subtree that is about to become inert,
which is what would otherwise happen when navigation closes the drawer.

`[inert]{pointer-events:none; user-select:none;}` was added so the closed drawer
cannot swallow a click meant for the page behind it.

### How it is proved

- **Executed** — `tests/navigation-a11y.test.js` and
  `verify-a11y-offcanvas-and-dark-contrast.mjs` both import `src/nav-drawer.js`
  and exercise the full truth table, the `matchMedia` probes (including a host
  with no `matchMedia`, a throwing `matchMedia`, and a legacy `addListener`-only
  `MediaQueryList`), and the focus helpers with stub nodes.
- **Arithmetic** — the closed drawer's viewport box is computed from the box
  model: `position:fixed; left:0` puts the border box at `x=0`, and
  `translateX(-100%)` shifts it left by its own width, which resolves from
  `--qb-rail-w` + `--qb-navpanel-w` = 74 + 236 = **310px**. So the closed drawer
  spans `x = [-310, 0]`. Its intersection with the viewport is asserted to be
  exactly 0px at 320, 360, 480, 768 and 1024px. `.sidebar` is `overflow:hidden`,
  so no descendant can sit outside that box.
- **Static** — the focusable inventory is counted from the generated preview
  markup: **20** focusable controls inside the drawer. The verifier then states
  the requirement literally:

  > `reachableOffscreenTabStops = closedDrawerInert ? 0 : focusableInDrawer.length`
  > must equal 0

  and separately asserts the inventory is non-empty and that the open drawer is
  not inert, so the pin cannot be satisfied by emptying the drawer or by making
  it permanently inert.

Both halves were negative-tested: deleting the `navDrawerAttributes` spread from
`src/app.jsx` fails the verifier with
`the sidebar must take its inert state from navDrawerAttributes(navOffCanvas, mobileNav)`.

### What is **not** proved

The real browser numbers — 42 tab stops, 16 off-screen — are not recomputed
here, because computing them needs layout for the whole page, not just the
drawer. The claim this branch supports is narrower and exact: *the 20 controls
inside the drawer are in a box with zero viewport intersection when the drawer
is closed, and `inert` removes all 20 from the tab order.* Whether some
**other** element elsewhere in the shell is also off-screen and focusable is not
covered by this fix or its verifier.

---

## Defect 2 — dark mode contrast

WCAG 1.4.3 Contrast (Minimum) and 1.4.11 Non-text Contrast, both AA.

### What was wrong

Three coverage gaps let light surfaces survive into the dark theme, plus two
that this pass found on its own. All ratios are **arithmetic**, from the token
values.

1. **`.btn.btn-default` was a phantom class** — written in the markup, defined
   in no stylesheet rule, in either theme. Where a container rule did not catch
   it, it fell to a white surface while the dark theme wrote
   `--qb-text-strong` (`#F1F4F6`) onto it: **1.10:1**. This is the mechanism
   behind the reported worst case of 1.11:1.
2. **An unclassed `<button>`** was painted from system colours. A light user
   agent's `buttonface` is `#EFEFEF`; with `--qb-text` (`#D7DDE1`) on it that is
   **1.19:1**. There are 78 unclassed `<button>` elements in `src/`.
3. **The selected navigation states.** The claim as reported was that `.rail-on`
   and `.nav-on` have no dark rule. That is not literally true — both have had
   `body.dark` rules since round 2 — but the *effect* is the same and worse than
   it looks: `body.dark .nav-item.nav-on{background:var(--qb-raised)}` paints
   `#1E252B` on the `#171D22` nav panel, which is **1.10:1**. The current page
   was indistinguishable from every other row and identical to a hover. The rail
   half of the claim does not reproduce: the selected rail glyph sits on a
   `--qb-brand` fill at **6.14:1** against the rail and was already compliant.
4. **Every control border**, found by this pass. `--qb-border` was `#404C55`:
   1.93:1 on `--qb-surface`, 2.10:1 on `--qb-canvas`, 1.76:1 on `--qb-raised`.
   Inputs, selects and default buttons had no perceivable edge.
5. **Five rules with raw light hexes placed *after* the dark-mode section**, so
   they won the cascade in both themes and painted a white segmented control and
   a light grey count pill into the middle of a dark page:
   `.bank-queue-seg-row`, `.bank-queue-seg`, `.bank-queue-seg-item`,
   `.bank-queue-seg-on`, `.bank-account-pill`, plus
   `.bank-action-availability`'s border.

There were also **zero** `@media (prefers-color-scheme: dark)` blocks: the app
ignored the operating system entirely.

### The fix, at the token layer

Per the instruction, dark values were added to tokens rather than sprinkled as
one-off overrides:

| token | before (dark) | after (dark) | why |
| --- | --- | --- | --- |
| `--qb-border` | `#404C55` | `#74818B` | 1.4.11: clears 3:1 against canvas, surface, raised, inset, rail and the segmented track |
| `--qb-chip-border` | `#3A464F` | `#6E7B85` | 3.57:1 on raised, 3.91:1 on surface |
| `--qb-canvas` | `#0F1418` | `var(--qb-dark-canvas)` | one source of truth shared with the pre-boot rule |
| `--qb-text` | `#D7DDE1` | `var(--qb-dark-text)` | same |

`--qb-border-soft`, `--qb-border-alt` and `--qb-divider` were deliberately left
quiet. They rule table rows and split panels — decoration, not the boundary of a
control — and 1.4.11 does not apply to them.

Rule changes, all token-driven:

- `.btn-default` is now a real declaration in the base layer
  (`background:var(--qb-surface); color:var(--qb-text-strong); border:1px solid var(--qb-border)`)
  and is named in the dark control list.
- `button,input[type=button],input[type=submit],input[type=reset]` set `color`,
  `background-color` and `border-color` from tokens at element specificity
  `(0,0,1)`, so every class rule in the sheet still wins and any button that
  declares `border:0` or a transparent background is untouched. In light this is
  visually the same as the user-agent chip it replaces (`#F7F8FA` vs `#EFEFEF`).
- `:root{color-scheme:light}` / `body.dark{color-scheme:dark}` so the user
  agent's own widgets — scrollbars, the `<select>` popup, form control defaults
  — follow the theme instead of staying light.
- `.nav-item.nav-on` gains `box-shadow:inset 3px 0 0 0 var(--qb-accent)` in the
  **base** layer, so both themes get it. The fill alone is 1.23:1 in light and
  1.10:1 in dark; the accent bar is 12.11:1 and 9.62:1. This is the same mark
  the keyboard table row already uses. `body.dark .nav-item.nav-on` moves from
  `--qb-raised` to `--qb-accent-tint`.
- The selected segment / tab gains `box-shadow:0 0 0 1px var(--qb-border)` in
  dark. Light separates a selected chip with a drop shadow; dark had dropped it,
  leaving 1.48:1 between the chip and its own track. The ring is 3.27:1.
- The six trailing rules now use `--qb-divider`, `--qb-surface`,
  `--qb-text-muted`, `--qb-text-strong` and `--qb-shadow-card`. Same measured
  light appearance, one palette.

### Operating-system preference

`src/theme-preference.js` (new) resolves, in order: a stored choice → the OS
preference → light. The ☾ control writes `refs_theme` (`'dark'` or `'light'`,
literal key, declared in `verify-frontend-data-boundary.mjs`'s
`UI_PREFERENCE_WRITES`), and from then on the stored choice outranks the OS,
including when the OS flips later. While nothing is stored, the app follows the
OS live.

`<body>` now always carries an explicit `dark` **or** `light` class. That is what
makes "the user chose light on a dark machine" sayable, and it is what the CSS
media block stands down for:

```css
@media (prefers-color-scheme: dark){
  :root{ color-scheme:dark; }
  html{ background:var(--qb-dark-canvas); }
  body:not(.light){ background:var(--qb-dark-canvas); color:var(--qb-dark-text); }
}
```

This block is deliberately two declarations, not a duplicate palette. Duplicating
forty-odd token values into a media query is exactly the drift hazard this task
warned about; the whole palette stays switched from one place, the `dark` class,
and the media block only covers the frame before the bundle runs. Its two values
are read from the same `--qb-dark-*` tokens `body.dark` uses, so a pre-boot frame
cannot disagree with the booted app.

### Contrast: before and after

Dark mode, computed from the token values. Floors are 4.5:1 for body text and
3:1 for large text and the boundaries and states of user-interface components.
The full 38-row inventory is in the verifier; this is every row that changed or
failed.

| pair (dark) | floor | before | after |
| --- | ---: | ---: | ---: |
| `.btn.btn-default` label on its own surface | 4.5 | **1.10** | 14.03 |
| unclassed `<button>` ink on user-agent `buttonface` | 4.5 | **1.19** | 14.57 |
| `.nav-item.nav-on` — current page vs the nav panel | 3 | **1.10** | 9.62 |
| selected tab / segment vs its own track | 3 | **1.48** | 3.27 |
| control border vs `--qb-surface` | 3 | **1.93** | 4.25 |
| control border vs `--qb-canvas` | 3 | **2.10** | 4.64 |
| control border vs `--qb-raised` | 3 | **1.76** | 3.88 |
| control border vs `--qb-inset` | 3 | **1.83** | 4.03 |
| chip border vs `--qb-raised` | 3 | **1.60** | 3.57 |
| chip border vs `--qb-surface` | 3 | **1.76** | 3.91 |
| `.nav-item.nav-on` ink on its fill | 4.5 | 14.03 | 12.79 |
| `.bank-queue-seg-item` ink on its track | 4.5 | 6.21 † | 5.50 |
| `.bank-queue-seg-on` ink on its surface | 4.5 | 15.27 † | 15.39 |
| `.bank-account-pill` ink on its fill | 4.5 | 12.44 † | 11.83 |
| selected rail glyph fill vs the rail | 3 | 6.14 | 6.14 |

† These three passed the ratio test **because** they were light islands: dark
ink on a white or `#e2e9ed` chip in the middle of a dark page. The ratio was
never the problem; the surface was.

Unchanged and already passing: all 22 text pairs (body / strong / muted / faint
ink on canvas, surface, raised, inset and divider; link; accent; brand
foreground; the ok, warn and bad tints; the rail label; the badge glyph). Their
numbers are printed by the verifier.

**Dark-mode failures in the 38-pair inventory: 7 before, 0 after.**

### How it is proved

- **Arithmetic** — `verify-a11y-offcanvas-and-dark-contrast.mjs` parses `:root`
  and `body.dark` out of the shipped `index.html`, resolves `var()` chains,
  composites `rgba()` over its background, and applies the WCAG 2.x
  relative-luminance formula to all 38 pairs. It fails the build on any dark
  ratio below its floor.
- **Static** — a cascade guard: any rule outside `body.dark` that sets `color`,
  `background` or `background-color` to a raw hex, `rgb()` or `white` is a
  failure unless it is on a short reviewed allowlist (the six coloured group
  badges, which have explicit dark pairings; white ink on the saturated danger /
  toast / bank-health fills; the modal scrims). This is the check that would
  have caught the five trailing bank-queue rules on the day they were written.
- **Executed** — `src/theme-preference.js` is imported and the precedence rules
  are exercised against stub hosts: dark machine → dark, light machine → light,
  stored `light` on a dark machine → light, stored `dark` on a light machine →
  dark, garbage in storage → ignored, no `matchMedia` → light.

---

## Residual risk

1. **Light mode still fails 1.4.11 on the same seven UI-boundary pairs.**
   `--qb-border` is `#C3CED5`: **1.60:1** on `--qb-surface`, **1.47:1** on
   `--qb-canvas`, **1.51:1** on `--qb-inset`. `--qb-chip-border` is **1.36:1**
   on both. The selected segment vs its track is **1.31:1**. This is
   pre-existing and was **not** fixed here: these are primitives measured from a
   live QuickBooks session and recorded in `docs/QB-DESIGN-TOKENS.md`, and
   reaching 3:1 needs roughly `#767F86`, which visibly darkens every control
   edge in the product's light appearance. That is a product-wide look change
   the owner did not ask for. The new verifier gates **dark only**; if the owner
   wants light gated too, the inventory is already written and only the floor
   check needs widening.
2. **The segmented track and the count pill are now low-contrast in dark**:
   `--qb-divider` on `--qb-surface` is 1.30:1. They are background groupings,
   not control boundaries — the segments themselves carry a 3.27:1 ring when
   selected and 5.50:1 label ink when not — and light mode has had the same
   1.23:1 relationship all along. They are deliberately excluded from the AA
   inventory. If the owner finds them too faint by eye, the fix is a
   `--qb-track` token, not another one-off override.
3. **No browser confirmation.** Nothing here was rendered. In particular:
   whether `inert` behaves as specified in the owner's actual browser; whether
   any element outside the drawer is also off-screen and focusable; and whether
   the new `#74818B` border reads as "correct QuickBooks weight" rather than
   "heavy" in dark. The regenerated preview is the way to settle all three.
4. **`aria-hidden` rides along with `inert`.** In an engine that supports
   `inert` this is redundant but harmless — the subtree is not focusable, so
   there is no "aria-hidden on focusable content" violation. In an engine that
   does not support `inert`, `aria-hidden` still removes the drawer from screen
   readers but the tab stops come back. The trap is only fully closed on engines
   that ship `inert` (Chrome 102+, Safari 15.5+, Firefox 112+).
5. **`color-scheme:dark` changes user-agent widget rendering** — scrollbars, the
   `<select>` popup, autofill. That is the point, but it is a visible change
   nobody has looked at in a browser yet.
6. **The base `button` rule is a wide blast radius.** It sets only `color`,
   `background-color` and `border-color`, at specificity `(0,0,1)`, so any class
   rule wins; the SSR suite (27 components), the audit suite (119 entities) and
   45 verifiers all pass. But a button that currently looks right *because* of a
   user-agent default, and that no class rule covers, will now look slightly
   different. There are 78 unclassed `<button>` elements. None was inspected in
   a browser.
