# Fixed asset acquisition browser evidence

Run `npm run test:fixed-asset-acquisition-browser:e2e` from `server` after installing the root and server dependencies. Set `POSTGRES_IMAGE` to the required PostgreSQL version, `REFS_ASSET_ACQUISITION_BROWSER_OUTPUT` to a fresh absolute evidence directory, and `REFS_PLAYWRIGHT_MODULE` when Playwright is installed outside the repository.

The runner refuses an existing evidence directory or a dirty worktree. It launches a fresh owned PostgreSQL container, uses the real accounting API handler and HTTP, and drives isolated Chromium through asset list, detail, acquisition options, one Draft POST, and a fresh Journal read. The browser begins in another open period; the handoff must read the Draft from the source period returned by acquisition options. The receipt then records independent Submit, Review, Approve, and Post roles and reconciles the two posted ledger lines to the Trial Balance and retained source.

The browser identity is a test-only bearer mapped to a real database grant and context. This evidence does not prove production OIDC, deployed routing, or business acceptance. Same-company period switching while a movement source drill is open is covered separately after the movement workspace scope fix is integrated.
