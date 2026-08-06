# Integration status — `integration/claude-tasks-2026-08-06`

Base `3266099` (current `main`, = live build stamp). Four commits cherry-picked, all
conflicts resolved, full frontend gate chain green. **Not pushed. Not merged to main.**

```
0dbbcdb  style(ui): QB shell + home composition        (was babbe47, t004 round 2)
a1eca2e  style(ui): consolidate CSS into token system  (was d2c4c86, t004 round 1)
9831de3  feat(bank): queue filters, deep-link, recon   (was fb17940, t003)
fc48396  feat(wbs): eight-source MCP lineage mapping   (was 662cf16, t002)
3266099  fix(ci): preserve Pages runtime mode          (main)
```

---

## The blocker that stopped the previous integration attempt — fixed

4 failing `wbs-mcp-lineage` tests, all reporting `WBS_LINEAGE_SCHEMA_INVALID` on
`list_journal_entries`. **The schema was not the cause.** The real error surfaced only
after dumping the exception payload:

```json
{ "code": "WBS_LINEAGE_SCHEMA_INVALID",
  "scope": { "level": "ENVELOPE" },
  "detail": { "upstream_code": "WBS_MCP_ENVELOPE_INVALID" } }
```

`ENVELOPE` level, upstream code — so it was rejected by the **frozen** validator in
`server/runtime/wbs-readonly-mcp.mjs:76` before mapping ever ran:

```js
stableKey === 'id' ? !Number.isSafeInteger(row[stableKey]) : ...
```

The authoritative contract requires `list_journal_entries.id` to be a **safe integer**.
The t002 catalog declared it `string` and the fixture used `'JE-0001'`. Because t002 was
cut from `1233a13`, its own suite passed in isolation and only failed once rebased onto a
`main` carrying the tightened validator.

Fix, in three parts:

1. New `integer` schema type in `wbs-mcp-lineage.mjs` validating with `Number.isSafeInteger`
   — deliberately mirroring the frozen contract so the two cannot drift again.
2. `list_journal_entries.id` → `int(true)`.
3. Fixture `id: 'JE-0001'` → `id: 10001`.

Result: **34/34 pass**. Both edits carry a comment naming the upstream validator, so the
next person sees why the type is integer.

---

## Conflict resolutions

| File | Conflict | Resolution |
|---|---|---|
| `package.json` | main added `test:authoritative-bank` + `test:authoritative-reports`; t002 added `test:wbs-mcp-lineage` | **Union** — all three in the chain. Neither side's tests dropped. |
| `server/package.json` | main added reconciliation + bank-match + financial-statements contract tests; t002 added lineage test | **Union**, and kept main's `test:reconciliation` script that t002's side omitted. |
| `index.html` (t003) | both-added CSS at the same offset, no semantic overlap | Kept **both** blocks. |
| `index.html` (t004) | t004 rewrites the entire `<style>` | Took **t004's** stylesheet — consolidation is the point of the change — then re-applied the two things it could not know about: t003's bank CSS block, and main's `<script src="./refs-build.js">` build stamp, which t004 lacked because it was cut from `122f475`. Verified both present after merge. |

**The build stamp is the one to double-check on review.** t004 was based on a commit
predating it, so a naive `--theirs` would have silently dropped the Pages build stamp and
broken live SHA verification. It is restored immediately before `</head>`.

---

## Gates — all exit 0, run on the merged tree

| Gate | Result |
|---|---|
| `npm run build` | 0 |
| `npm run test:ssr` | 0 — `components=27 failed=0` |
| `npm run test:audit` | 0 — `entities=119/119 jes=2121 fails=0` |
| `npm run test:visual` | 0 — **41/41** verifiers (39 base + t003 + t002) |
| `node verify-global-visible-english.mjs` | 0 |
| `npm run test:wbs-mcp-lineage` | 0 — 34/34 |
| `npm run test:navigation-a11y` | 0 — multi-expand + mobile drawer intact |
| `npm run test` (20-script chain) | 0 — see note |
| server `node --test` wbs suite | 0 — 61/61 |
| `git diff --check` | 0 |

The 20-script chain cannot run as one process in this sandbox (any process outliving a
45s tool call is killed). It was run as **four consecutive foreground segments covering
all 20 scripts**, every segment exit 0. Run it as a single command before release.

### Mojibake / CJK
Reported as a concern from an earlier attempt. Checked directly on the merged tree:
zero CJK codepoints and zero replacement/mis-decoded byte sequences across `src/*.js`,
`src/*.jsx`, `index.html`. `verify-global-visible-english.mjs` exits 0.

---

## Not verified

**No page has been rendered.** No browser in the sandbox and `file://` is blocked from the
operator's Chrome. Every visual and responsive claim is static analysis of CSS and JSX.
Task 004's required evidence — ten workspaces at 1440×1000, 1280×720, 768×900, 360×800
with overflow and console checks — is **still outstanding** and needs a reviewer with a
browser. `docs/preview/shell-preview.html` (inlines the stylesheet verbatim, reads icon
paths from source, so it cannot drift) and `dist/index.html` are both available to open.

## Highest remaining risk

`.main` is now `#FFFFFF`, so white cards sit on white behind a 0.8px hairline. That matches
the measurement of QB, but if it reads too faint the effect is flat rather than calm across
nine workspaces. One-line revert: `.main{background:var(--qb-canvas)}`.

## Statement

No accounting calculation, source classification, state machine, API/OpenAPI contract,
migration, or authorization change. No push, no merge to `main`, no release. No claim of
QuickBooks parity or equivalence; no QuickBooks asset copied.
