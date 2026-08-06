# QuickBooks Shell & Home — Measured Structure (round 2)

**Source:** live `qbo.intuit.com/app/homepage` and `/app/banking`, 2026-08-06.
**Why this exists:** round 1 (`QB-DESIGN-TOKENS.md`) fixed colors, radii and shadows but kept
REFS' original *layout*. Side-by-side against QB the app still reads as a different product.
The gap is **structural**, not chromatic. This document specifies the structure.

Companion doc: `QB-DESIGN-TOKENS.md` (colors/radii/shadows/type — still valid).

---

## 0. The gap, stated plainly

| | REFS today | QuickBooks |
|---|---|---|
| Left nav | one dark navy column, bright green `+ New` pill | **74px light icon rail** + optional white second-level panel |
| Page title | `Business overview`, left, ~32px bold | `Good morning, Qi!` **centered, 34px/500** |
| Primary entries | text links with `→` | **48px pill chips** with a dark circular icon badge |
| Quick actions | none | `Create actions` + a row of **outlined pills** |
| Cards | tight, heavy 1px borders | large radius, **0.8px** hairline, generous padding |
| Overall | dense enterprise dashboard | calm, airy, high whitespace |

---

## 1. App shell

```
page background        #F4F5F8
shell padding          6px 6px 6px 0        (content sits in a rounded white shell)
```

### 1.1 Left icon rail  — replaces the dark sidebar

```
nav width              74px
background             #F0F4F6            /* NOT the current dark #282828 */
padding                0 0 8px
group                  display:flex; flex-direction:column; gap:4px; padding:4px 0 12px
```

Rail item:
```
size                   68 x 64
border-radius          8px
layout                 icon above label, flex-column, gap 2px, centered
label                  11px / 600 / #21262A
icon                   24px, stroke style
hover                  background tint only — no lift, no scale
```

Selected rail item: the **icon** sits on a filled rounded square, the label stays plain.
```
icon holder (selected) 44 x 44, border-radius 12px, background #003E31, glyph #FFFFFF
label (selected)       11 / 600 / #21262A
```

Rail groups are separated by a hairline `#E2E9ED`; a `PINNED` group header is
`11px / 600`, uppercase, muted, letter-spaced.

### 1.2 Second-level nav panel (shown when a rail group is opened)

```
background             #FFFFFF
header                 "ALL APPS" — 11 / 600, uppercase, #4C555B, letter-spacing .06em
row                    circular colored icon badge 24px  +  label 14/400  +  right chevron
row height             ~52px, padding 0 16px
row selected           light gray fill, no left bar
```

Each nav group carries **its own icon badge color** (QB gives Accounting, Expenses,
Sales, Customers, Team, Time, Projects distinct hues). Pick a REFS palette — do not
copy Intuit's exact hues — but keep the *pattern*: small solid circle, contrasting glyph.

---

## 2. Home / Dashboard composition

Order top to bottom: **greeting → feature chips → create actions → section heading → cards**.

### 2.1 Greeting
```
font                   34px / 500 / #21262A
line-height            44px
text-align             center
```
Right-aligned on the same row: `Customize` and `Privacy` as icon+label ghost links.

### 2.2 Feature chip row
Horizontal, non-wrapping, with `‹ ›` chevrons when it overflows.
```
chip                   height 48px; border-radius 9999px;
                       border 0.8px solid #D5DEE3; background #FFFFFF;
                       padding 8px 16px 8px 8px; gap 12px; display:inline-flex; align-items:center
icon badge             32px circle; background #04263A; glyph mint (#5FE3B0-ish), 16–18px
label                  14px / 600 / #21262A
hover                  background #F4F5F8 only — no lift
```

### 2.3 Create actions row
```
row label              "Create actions" — 16px / 600 / #21262A
pill                   height ~44px; border-radius 9999px; border 0.8px solid #D5DEE3;
                       background #FFFFFF; padding 0 20px; label 14px / 600 / #393A3D
trailing link          "Show all" — #205EA3, 14/600, no underline
```
Only surface actions REFS actually supports. Do **not** add Get paid online, payments,
deposits, or anything on the excluded list just because QB shows it there.

### 2.4 Section heading
```
16px / 600 / #21262A     e.g. "Business at a glance"
```
Note this is *smaller* than the greeting — QB's hierarchy is greeting ≫ section, and
section headings are modest. Our current 26px section titles are too loud.

### 2.5 Cards
```
background             #FFFFFF
border                 0.8px solid #E2E9ED          /* hairline, not 1px */
border-radius          8px  (12px for full-width panels)
padding                24px
box-shadow             none by default
card label             12px / 600, UPPERCASE, letter-spacing .04em, #4C555B
primary figure         20–34px / 600, tabular-nums
supporting line        14px / 400 / #393A3D
empty state            centered icon in a light gray circle + 16/600 headline
                       + 14/400 muted body + a single #205EA3 text link
```

---

## 3. Interaction feel (unchanged from round 1, restated because it keeps getting missed)

- **No hover lift anywhere.** No `translateY`, no `scale`. Hover = background tint.
- Elevation is `0 1px 4px rgba(76,85,91,.2)` and reserved for genuinely floating layers.
- Borders carry the structure: `0.8px #E2E9ED` hairlines, `1px #C3CED5` on controls.
- Focus: 2px `#003E31` outline, 2px offset.
- Buttons 36px / 16px / radius 6. Pills radius 9999.
- Money uses the sans face with `tabular-nums` — never a monospace font.

---

## 4. Boundaries — unchanged and non-negotiable

- Visual only. No change to accounting calculations, source classification, state machines,
  API/OpenAPI contracts, migrations, WBS/MCP logic, or authorization behavior.
- Do not add: export, payment rails, bank feeds, connect/import/OCR, auto-match,
  auto-categorize, auto-post, sign-off automation, destructive actions, promotions.
  If QB shows such an entry point, **omit it** — do not build a dead affordance.
- Preserve Draft → Review → Approve → Post, SoD, immutable Posted evidence,
  reversal-only correction.
- Keep sidebar groups independently expandable; selecting a child must not collapse
  another expanded group. This survives the rail redesign.
- Keep English-only visible copy and dark-mode parity for every new token.
- Gates stay green: SSR smoke 27 components, ledger audit 119 entities / fails=0.

## 5. Legal line

No QuickBooks markup, CSS, icon, image, or font file is copied. The
`Avenir Next forINTUIT` face is proprietary to Intuit and must never be embedded or
referenced — use `"Avenir Next", "Segoe UI", -apple-system, sans-serif`. Everything above
is a measurement of observable layout used to build an **independent** implementation.
REFS makes no claim of QuickBooks parity or equivalence.
