# Full-stack staging integration plan

## Preconditions

This is a plan only. Do not start the merge until independent audit confirms
that `main@b2c30361af4a5f95f56106f614ff97b0cb04ccf8` has no `server/` tree and
that `b330cd5bfcf29214c889620bb2ebc5d25c85196d` contains the reviewed full-stack
tree. Do not force-push any branch.

## Inputs and integration order

1. Create a new integration worktree and branch from
   `b330cd5bfcf29214c889620bb2ebc5d25c85196d`.
2. Record a clean baseline: `git status --short`, `git diff --check`, and the
   baseline SHA.
3. Merge the current reviewed UI release as one non-fast-forward merge:
   `git merge --no-ff --no-commit b2c30361af4a5f95f56106f614ff97b0cb04ccf8`.
   This preserves the deployed UI lineage (`ffc11d1`, `ac427e3`, `b2c3036`) and
   avoids cherry-picking only part of a Pages release.
4. Resolve only audited UI conflicts, run the validation gates below, commit a
   new frozen integration SHA, then submit it for independent audit.

## Expected conflict review set

Audit these paths if Git reports a conflict; do not use `ours` or `theirs`
without reviewing the semantic result:

- `index.html` — shared English/readability and responsive topbar/Table CSS.
- `src/app.jsx`, `src/ui.jsx`, `src/modules-core.jsx`, `src/modules-more.jsx` —
  shell, Dashboard business-fit navigation, and report layout.
- `src/module-ap.jsx`, `src/module-ar.jsx`, `src/module-banktx.jsx`,
  `src/module-bankrec.jsx`, `src/module-coa.jsx` — previously divergent UI
  surfaces; retain the `b330cd5` API/accounting boundary and the reviewed UI
  presentation only.
- `package.json`, `package-lock.json`, `.gitignore`, verifier scripts — retain
  deterministic full-stack scripts from `b330cd5`; do not accept unrelated
  dirty package changes.

## Required validation before any staging deploy

```powershell
git status --short
git diff --check
npm ci
npm run build
# Run the integrated root frontend suite once its script is present.
npm test
Set-Location server
npm ci
npm test
npm run test:postgres:fresh
# Repeat PostgreSQL 15 and 16 under the audited fresh runner.
```

Then run the source/dist English/no-mojibake verifier and the eight-page live
UI gate against the SHA-specific preview. Only after Platform/Ops supplies the
HTTPS API/OIDC/S3/scanner/WBS receipt configuration may the staging env
validator and authenticated smoke be counted as passing.

## Safe rollback

Before the merge, create and push a named integration baseline branch. During
the uncommitted merge, use `git merge --abort` if a conflict cannot be resolved
without changing accounting behavior. After a committed candidate, revert the
single merge commit with `git revert -m 1 <merge-sha>`; never reset, force-push,
or overwrite `main`, `release/b874bc0-staging`, or the deployed Pages branch.
