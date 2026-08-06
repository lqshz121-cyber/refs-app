// Replace this file during deployment; do not place access tokens or secrets here.
// The API must be HTTPS and authenticate the browser session at the gateway.
// scripts/write-runtime-config.mjs regenerates dist/refs-runtime-config.js from
// deployment environment values and stamps the matching release channel onto
// dist/refs-build.js. The two must agree or the client renders an error page.
window.__REFS_OIDC__ = null;
window.__REFS_ACCOUNTING_API__ = null;
// Production/static deployments are fail-closed until an authoritative API is configured.
window.__REFS_RUNTIME_MODE__ = 'REQUIRES_AUTHORITATIVE_API';
// Example:
// window.__REFS_ACCOUNTING_API__ = {
//   baseUrl: 'https://accounting.example.internal',
//   entityId: '00000000-0000-4000-8000-000000000000',
//   periodId: '00000000-0000-4000-8000-000000000000',
//   cashAccountCode: '111000',
//   // Install this provider from the OIDC/PKCE bootstrap. Never hard-code a token here.
//   getAccessToken: async () => window.refsOidcClient.getAccessToken()
// };
