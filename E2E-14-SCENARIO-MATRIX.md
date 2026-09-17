# S16 — 14-scenario E2E matrix (headless tier executed, browser tier specified)

Candidate SHA `8d340a50c598cc31618bb8b49811b7ee5f6e54e4`.

This environment has **no browser runtime** (`google-chrome`, `chromium`,
Playwright browsers: all absent). Nothing here claims a browser result. The
matrix is split into two tiers and each scenario states exactly which tier
produced its evidence:

- **Tier H (headless, executed here).** React components are rendered in Node
  (`esbuild` → `renderToStaticMarkup` / `react-dom/test-utils`) against fake API
  responses. Proves component contracts, empty/loading/error/denied states,
  navigation model, and API-client request shapes. Does **not** prove anything
  about a real browser: no CSP enforcement, no real network, no real OIDC
  redirect, no file picker, no layout/paint.
- **Tier B (browser, NOT executed).** Steps written for S33 to run on staging
  with a dedicated test identity. Anything only Tier B can prove is marked
  BLOCKED here, not "passed".

This file complements `E2E-BROWSER-MATRIX.md` (T14), which enumerates blank-page
failure paths B1–B14. This one enumerates the 14 *functional* scenarios S16
asks for.

## Tier H results (this run)

| ID | Scenario | Gate command | Exit | What it actually asserts |
|---|---|---|---|---|
| E00 | shell renders at all (no blank) | `npm run test:ssr` | 0 | 29 components render server-side, 0 failures — a module-level throw cannot reach a release. |
| E01 | Login / identity | `npm run test:oidc` | 0 | Identity bootstrap + OIDC client against fakes: 12 silent-renewal outcomes, discovery/callback/state handling. |
| E02 | Overview | `npm run test:authoritative-overview` | 0 | API-only dashboard hierarchy with explicit ready / empty / loading / access-denied states. |
| E03 | Chart of accounts | `npm run test:authoritative-coa-register` | 0 | Filters, paging, exact Back context, container scoping. |
| E04 | Journal entry | `npm run test:authoritative-journals` | 0 | Journal register, full-page evidence surface, Back/focus return. |
| E05 | Posting workflow | `npm run test:workflow` | 0 | Draft/Submit/Approve/Post/Reverse transitions as the UI models them. |
| E06 | AP — bills & payments | `npm run test:authoritative-bill-payments` | 0 | Bill/payment register contract + client + workspace render. |
| E07 | AR — receipts | `npm run test:authoritative-receipts` | 0 | Receipt register contract + client + workspace render. |
| E08 | Banking | `npm run test:authoritative-bank` | 0 | Bank workspace, settlement handoff, denial and stale-scope surfaces. |
| E09 | Reconcile | `npm run test:autorecon` | 0 | Auto-reconciliation fail-closed; no hard-coded payments or check numbers. |
| E10 | Report drilldown | `npm run test:authoritative-lineage-drill` | 0 | GET-only source → Journal → GL → report return chain. |
| E11 | WBS read-only | `npm run test:authoritative-wbs-payable` | 0 | Admitted review and reviewed-evidence Draft separation. |
| E12 | Attachments | `npm run test:attachment-client` | 0 | Attachment API client request/response contract against fakes. |
| E13 | Error surfaces | `npm run test:startup-surface` | 0 | Startup surface matrix: config missing / mode rejected / channel mismatch / render throw all produce a coded error page. |
| E14 | Logout | `npm run test:authoritative-full-shell` | 0 | Topbar renders a sign-out control and the shell wires it to the real OIDC `logout` command. |

Logs: `outputs/s16-2026-09-16-<session>/E00..E14.log`, index `summary.psv`.

## What Tier H does **not** prove (BLOCKED — for S33 on staging)

| ID | Browser-only step | Why Tier H is insufficient |
|---|---|---|
| E01-B | Real OIDC redirect, callback, `code=` cleanup from the URL, token in `Authorization` | Tier H uses a fake authorization server; no redirect ever happens. |
| E05-B | Post a Draft end to end against a live API and observe the ledger effect | Tier H asserts UI transitions against fake responses only. |
| E12-B | Choose a file, upload to presigned S3, scan verdict, download authorization | No file picker, no S3, no scanner. Also depends on the S09 container blocker. |
| E13-B | CSP enforcement, SRI, blocked-CDN behaviour, console error budget | CSP and SRI are enforced by the browser, never by Node rendering. |
| E14-B | Sign out clears the session and a protected route then refuses | Tier H only asserts the handler is wired (a source regex — the weakest evidence in this matrix). |
| All | Layout at 360–1440 px, zoom 80–150 %, back/forward, reload mid-workflow | Requires a real viewport and history stack. |

## Execution instructions for the browser tier (S33)

1. Build the candidate and serve `dist/` (`npm ci && npm run build`); record the
   `release_sha` returned by `/health/ready` in the report header.
2. Run E01-B … E14-B against staging with the dedicated test identity, never a
   real accounting identity and never a real period.
3. Every row records: URL, UTC timestamp, screenshot or log path, exit code,
   console error count. A blank `#root` is a release blocker, not a UI bug.
4. A failed row creates a defect entry; it must not be re-labelled "passed" on
   the strength of the Tier H result for the same scenario.

## Honest status

14/14 scenarios have Tier H coverage and all 15 gates (E00–E14) pass at
`8d340a50`. **Zero** scenarios have browser evidence. S16 is therefore
"headless tier complete, browser tier blocked on a browser runtime"; it is not
an acceptance of the 14 scenarios.
