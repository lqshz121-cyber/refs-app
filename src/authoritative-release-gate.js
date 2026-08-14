// The public readiness response is the only release identity the browser can
// inspect without an OIDC token.  Confirm it before starting identity or
// requesting accounting rows so a partially promoted Render deployment cannot
// be mistaken for an accounting-data protocol failure.
const GIT_SHA = /^[0-9a-f]{7,64}$/i;

const releaseStamp = value => typeof value === 'string' && GIT_SHA.test(value.trim()) ? value.trim().toLowerCase() : null;

export const releaseStampsMatch = (clientRelease, apiRelease) => {
  const client = releaseStamp(clientRelease);
  const api = releaseStamp(apiRelease);
  return Boolean(client && api && (client === api || client.startsWith(api) || api.startsWith(client)));
};

const failure = (code, message) => ({ ok:false, code, message });

export async function verifyAuthoritativeApiRelease({ environment = globalThis, config, fetcher = globalThis.fetch } = {}) {
  const clientRelease = releaseStamp(environment?.__BUILD?.sha);
  if (!clientRelease) {
    return failure('RUNTIME_BUILD_STAMP_MISSING', 'The published client does not expose a valid build release stamp.');
  }
  if (!config?.baseUrl || typeof fetcher !== 'function') {
    return failure('CONFIGURATION_REQUIRED', 'No authoritative accounting API is configured for this deployment.');
  }
  let response;
  try {
    response = await fetcher(`${config.baseUrl}/health/ready`, {
      method:'GET',
      headers:{ accept:'application/json', 'cache-control':'no-cache' },
      cache:'no-store',
      credentials:'omit',
    });
  } catch {
    return failure('ACCOUNTING_API_UNREACHABLE', 'The accounting API readiness endpoint produced no HTTP response.');
  }
  if (!response?.ok) {
    return failure('ACCOUNTING_API_UNREACHABLE', 'The accounting API readiness endpoint did not return HTTP 200.');
  }
  let body;
  try { body = await response.json(); } catch {
    return failure('ACCOUNTING_API_RELEASE_UNSTAMPED', 'The accounting API readiness response was not valid JSON with a release stamp.');
  }
  const apiRelease = releaseStamp(body?.release);
  if (body?.ok !== true || body?.status !== 'ready' || !apiRelease) {
    return failure('ACCOUNTING_API_RELEASE_UNSTAMPED', 'The accounting API readiness response did not attest a valid ready release.');
  }
  if (!releaseStampsMatch(clientRelease, apiRelease)) {
    return failure('ACCOUNTING_API_RELEASE_MISMATCH', `The client release ${clientRelease} and API release ${apiRelease} are different.`);
  }
  return { ok:true, clientRelease, apiRelease };
}
