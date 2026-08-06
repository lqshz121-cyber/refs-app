# QuickBooks Online — Measured Design Tokens

**Source:** live `qbo.intuit.com/app/banking`, company "Wan Pacific Real Estate De…"
**Measured:** 2026-08-05 via `getComputedStyle` census over ~4000 visible nodes
**Method:** frequency analysis of real computed values — every number below is observed, not guessed.

> These tokens supersede the legacy QB skin currently in `index.html` (~line 158),
> which uses the **old** QB palette (`--qb-green:#2CA01C`, dark `#282828` sidebar).
> Current QB has moved to a deep-green brand with a **light** sidebar.

---

## 1. Typography

```
font-family: "Avenir Next", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif
base:        14px / 400 / #393A3D
line-height: 21px at 14px  (1.5)
```

QB itself ships `"Avenir Next forINTUIT"`. That face is **proprietary to Intuit — do not
embed or reference it.** Use the fallback stack above.

### Observed type scale (by frequency)

| size/weight | count | Usage |
|---|---|---|
| 14 / 400 | 1133 | Body, table cells — dominant token |
| 14 / 500 | 176 | Emphasised body, active nav |
| 14 / 600 | 147 | Table column headers, strong labels |
| 12 / 500 | 41 | Meta text, dates, secondary |
| 16 / 500 | 31 | **Buttons, segmented tabs** |
| 12 / 600 | 28 | Uppercase section labels |
| 20 / 600 | 25 | Section headings |
| 12 / 400 | 20 | Fine print |
| 11 / 500 | 16 | Badges / count pills |

Page title (`Bank transactions`): ~28–30px, light weight, `#21262A`.

**Money:** QB uses the same sans face with `font-variant-numeric: tabular-nums`,
**not** a monospace font. Our current `--mono` money styling is a divergence.

---

## 2. Color

### Neutrals
```
--qb-canvas:      #F4F5F8   /* page background */
--qb-surface:     #FFFFFF   /* cards, panels, tables */
--qb-text:        #393A3D   /* body */
--qb-text-strong: #21262A   /* headings, selected tab label */
--qb-text-muted:  #4C555B   /* idle tab, secondary */
```

### Borders — QB deliberately uses several
```
--qb-border:      #C3CED5   /* 18 uses — default control border */
--qb-border-soft: #D4D7DC   /*  9 uses — card border */
--qb-border-alt:  #DDDDDD   /* 13 uses — table */
--qb-divider:     #E2E9ED   /* panel dividers + segmented track (0.8px) */
```

### Brand
```
--qb-brand: #003E31   /* deep green — primary btn bg, outline btn fg+border */
--qb-link:  #205EA3   /* link blue, fw 500, NO underline */
--qb-info:  #0097E6
```

The old `#2CA01C` "QuickBooks green" no longer appears as a primary surface.
Keep it only for the logo mark if brand continuity is wanted.

---

## 3. Radii (by frequency)

```
6px     (139)  ← buttons, inputs, selects     [DOMINANT]
8px     ( 98)  ← cards, account tiles
9999px  ( 63)  ← pills, count badges
4px     ( 31)  ← small chips, icon buttons
5px     (  3)  ← segmented control items
12px    (  4)  ← large panel corners (12px 12px 0 0 / 0 0 12px 12px)
```

Our current single `--radius:10px` matches nothing in QB. Split into
`6px` control / `8px` card / `9999px` pill.

---

## 4. Elevation

```
--qb-shadow-card:   0 1px 4px rgba(76, 85, 91, 0.20)   /* selected tab, raised card */
--qb-shadow-strong: 0 1px 4px rgba(33, 38, 42, 0.60)   /* menus, popovers */
--qb-shadow-stick: -2px 0 2px rgba(0, 0, 0, 0.15)      /* sticky column edge */
```

QB elevation is **tight and low** — 1px offset, 4px blur. Our current
`0 4px 12px` + `0 8px 30px` is far softer and larger.
**There is no `translateY` hover lift anywhere in QB.**

---

## 5. Components (measured)

### Primary button
```
background:#003E31; color:#FFF; border:0; border-radius:6px;
padding:6px 12px; height:36px; font:500 16px/1; box-shadow:none;
```
Split variant: left segment `border-radius:6px 0 0 6px`, caret segment right.

### Secondary / outline button
```
background:transparent; color:#003E31;
border:2px solid #003E31;      /* NOTE: 2px, not 1px */
border-radius:6px; padding:0 10px; height:36px; font:500 16px;
```

### Segmented control (queue tabs: `Pending (1,402) | Posted | Excluded`)
```
track:     background:#E2E9ED; border-radius:6px; padding:2px;
item:      height:32px; padding:0 16px; font:400 16px; border-radius:5px;
item idle: background:#E2E9ED; color:#4C555B;
item on:   background:#FFFFFF; color:#21262A;
           box-shadow:0 1px 4px rgba(76,85,91,.2);
```
Count renders **inside** the label: `Pending (1,402)`.

### Link
```
color:#205EA3; font-weight:500; text-decoration:none;
```

### Panel / table container
```
background:#FFF; border-radius:12px 12px 0 0 (header) / 0 0 12px 12px (footer);
divider: 0.8px solid #E2E9ED;
```

### Account tile (bank account selector)
```
idle:     background:#FFF; border:1px solid #D4D7DC; border-radius:8px;
selected: border:2px solid #003E31;
layout:   name (14/500, truncated) + alert icon ..... count pill (top-right)
          "Bank: $140,657.96"   (20/600, tabular-nums)
          "Posted: $24,192.00"  (14/400) ..... date (12/400 muted, bottom-right)
hover:    pencil edit affordance appears right
```
Horizontal carousel with `‹ ›` chevrons — no wrapping.

### Count pill
```
border-radius:9999px; font:500 11px; padding:2px 8px;
idle: background:#E2E9ED; color:#4C555B;
```

### Inputs / filter row
```
height:36px; border:1px solid #C3CED5; border-radius:6px;
background:#FFF; font-size:14px; padding:0 12px;
Search: TRAILING magnifier icon (right-aligned, not left)
Date:   trailing calendar icon
Select: trailing chevron-down
```

### Pagination
```
"1-50 of 401   ‹  Page [ 1 ]  of 9  ›"  + print / export / column-settings icon buttons
page input: ~36px wide, bordered, radius 6px
```

---

## 6. Interaction feel — what to imitate

1. **No lift.** QB never translates cards on hover. Hover = background tint only
   (`#F4F5F8` on white rows) + pointer cursor.
2. **Focus is visible.** 2px brand-green outline, 1–2px offset.
3. **Borders do the work, not shadows.** Separation is a 1px `#C3CED5` or
   0.8px `#E2E9ED` line. Shadow is reserved for genuinely floating layers.
4. **Buttons are 36px tall with 16px type** — noticeably larger than our current
   `8px 15px / 14px`. QB targets are generous.
5. **Icons 16–20px, stroke style, 8px gap** to their label.
6. **Selected = white on gray track** (segmented) or **2px green border** (tiles).
   A filled brand background is reserved for true primary actions only.
7. **Sidebar is light**, each group carries a colored circular icon badge, chevron
   right for expandable groups, selected row gets a light gray fill. The legacy
   dark `#282828` rail is not current QB.

---

## 7. Divergences to fix in REFS

| # | Current REFS | QB actual | Action |
|---|---|---|---|
| 1 | `--brand:#2C6BED` / `#2CA01C` | `#003E31` | Retoken |
| 2 | `--radius:10px` everywhere | 6 / 8 / 9999 | Split |
| 3 | `0 4px 12px` + `0 8px 30px` | `0 1px 4px rgba(76,85,91,.2)` | Tighten |
| 4 | `.card-hover:hover{translateY(-2px)}` | no lift | Remove |
| 5 | Money in `--mono` | sans + tabular-nums | Retoken |
| 6 | Buttons `8px 15px`, 14px | 36px tall, 16px, radius 6 | Resize |
| 7 | Dark `#282828` sidebar | light + colored icon badges | Redesign |
| 8 | `.chip` filters for queues | segmented control on `#E2E9ED` | Replace |
| 9 | Link = brand blue | `#205EA3`, fw 500 | Retoken |
| 10 | One `--divider` token | 4 distinct border tokens | Expand |

---

## 8. Scope discipline

This document describes **visual language only**. Adopting it must not change:

- accounting calculations, source classification, posting logic, or state machines
- API/OpenAPI contracts, migrations, or `repo.js` interface shape
- WBS/MCP logic or authorization behavior
- the gates: SSR smoke (27 components) and ledger audit (119 entities, fails=0)

No QuickBooks markup, CSS, font binary, or icon asset is copied. Values above are
measurements taken to inform an **independent** implementation. REFS makes no claim
of QuickBooks equivalence.
