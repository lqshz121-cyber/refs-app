// ===========================================================================
// Runtime error surface.
//
// This is the only screen a deployed REFS client shows when it cannot serve
// authoritative accounting data. It replaces the previous behaviour where an
// unconfigured or failing runtime could reach a seed-backed demonstration.
//
// Every state below is one REFS can actually distinguish from the browser:
//
//   - a transport failure (no HTTP response was produced at all)
//   - an HTTP status the API returned (401, 403, 404, 429, other 4xx, 5xx)
//   - a response whose shape does not satisfy the read contract
//   - a deployment whose published assets are missing, unrecognised or
//     mutually inconsistent
//
// It never states a cause it cannot observe. "Cannot reach the API" is not
// reported as "the API is down": the browser cannot tell a stopped service
// from DNS, TLS, a proxy or a lost network, so the copy says exactly that.
// Retry is offered only where repeating the same request could plausibly
// succeed without the reader changing something first.
// ===========================================================================
import { StateBlock } from './ui.jsx';

const RETRY = 'RETRY';
const SIGN_IN = 'SIGN_IN';

// happened: what REFS observed. next: what the reader can do about it.
const STATES = {
  RUNTIME_CONFIG_MISSING: {
    title: 'Runtime configuration did not load',
    happened:
      'This page loaded without a runtime mode. The deployment adapter ' +
      '(refs-runtime-config.js) or the runtime lock (refs-runtime-lock.js) did not ' +
      'execute, so REFS has no instruction about which accounting service to read.',
    next:
      'Reload the page once. If the state persists the published asset set is ' +
      'incomplete and the deployment has to be republished; REFS will not show ' +
      'accounting data until it does.',
    offer: RETRY,
  },
  RUNTIME_MODE_UNRECOGNISED: {
    title: 'Runtime configuration is not recognised',
    happened:
      'The deployment adapter declared a runtime mode this client build does not ' +
      'implement. REFS refuses an unknown mode instead of guessing one.',
    next:
      'The deployed adapter and the deployed client bundle are from different ' +
      'releases. Republish both from the same build. No accounting data is shown ' +
      'until they match.',
    offer: null,
  },
  RUNTIME_CHANNEL_UNRECOGNISED: {
    title: 'Build stamp is not recognised',
    happened:
      'The build stamp (refs-build.js) declares a release channel this client does ' +
      'not implement, so REFS cannot confirm what this deployment is meant to be.',
    next:
      'Republish the deployment. The build stamp and the client bundle must come ' +
      'from the same build.',
    offer: null,
  },
  RUNTIME_CHANNEL_MISMATCH: {
    title: 'Deployment assets disagree',
    happened:
      'The build stamp and the deployment adapter describe different kinds of ' +
      'deployment. One says this is the public demonstration build; the other says ' +
      'it is an authoritative deployment. REFS will not run a demonstration ' +
      'data set under an authoritative build, and will not present a demonstration ' +
      'build as authoritative.',
    next:
      'Republish the site so that refs-build.js and refs-runtime-config.js are ' +
      'produced by the same build step. Until then no data of either kind is shown.',
    offer: null,
  },
  CONFIGURATION_REQUIRED: {
    title: 'Authoritative API required',
    happened:
      'This deployment requires an authoritative accounting API, but the published ' +
      'adapter carries no usable HTTPS API base and OIDC provider, or the values it ' +
      'carries did not pass validation.',
    next:
      'The deployment needs its public API and OIDC configuration values supplied ' +
      'and the site republished. This is a deployment change, not something that ' +
      'can be corrected from this page.',
    offer: null,
  },
  AUTHENTICATION_REQUIRED: {
    title: 'Sign in again to continue',
    happened:
      'The accounting API did not accept the current session. Either no access ' +
      'token was held, or the token had expired before the request was made.',
    next:
      'Sign in with the configured identity provider. Your place in the application ' +
      'is kept and you return to the same page.',
    offer: SIGN_IN,
  },
  AUTHORIZATION_DENIED: {
    title: 'Not authorised for this entity',
    happened:
      'You are signed in, and the accounting API refused this request for the ' +
      'entity and tenant this deployment is configured to read.',
    next:
      'Signing in again will not change this. Ask an administrator to review the ' +
      'access your account holds for this entity. REFS does not report what other ' +
      'entities exist or what access other accounts hold.',
    offer: null,
  },
  ACCOUNTING_API_UNREACHABLE: {
    title: 'Cannot reach the accounting API',
    happened:
      'The request to the configured accounting API produced no HTTP response at ' +
      'all. From the browser this looks the same whether the network dropped, DNS ' +
      'or TLS failed, a proxy intervened, or the service is not running. REFS ' +
      'cannot tell which, and will not guess.',
    next:
      'Retry. If it keeps failing, the API endpoint has to be checked from outside ' +
      'the browser. No cached or local accounting data is substituted.',
    offer: RETRY,
  },
  ACCOUNTING_API_SERVER_ERROR: {
    title: 'The accounting API reported a server error',
    happened:
      'The API responded with a 5xx status. The request reached the service and the ' +
      'service failed to complete it. The reason is on the server, not in this page.',
    next: 'Retry. If it persists, the service logs hold the cause.',
    offer: RETRY,
  },
  ACCOUNTING_API_RATE_LIMITED: {
    title: 'The accounting API is rate limiting this client',
    happened: 'The API responded with 429. This client sent more requests than it is allowed.',
    next: 'Wait a moment and retry.',
    offer: RETRY,
  },
  ACCOUNTING_API_SCOPE_NOT_FOUND: {
    title: 'Configured entity or period was not found',
    happened:
      'The API responded that the entity, period or record this deployment is ' +
      'configured to read does not exist on that service.',
    next:
      'The deployment is pointed at coordinates the API does not hold. The entity ' +
      'and period configuration must be corrected and the site republished.',
    offer: null,
  },
  ACCOUNTING_API_REQUEST_REJECTED: {
    title: 'The accounting API rejected the request',
    happened:
      'The API responded with a client-error status other than 401, 403, 404 or 429. ' +
      'The request was understood and refused.',
    next:
      'Retry once. If the same refusal returns, the request this page makes is not ' +
      'valid against the deployed API version and both must be brought to the same ' +
      'release.',
    offer: RETRY,
  },
  ACCOUNTING_API_PROTOCOL: {
    title: 'The accounting API returned an unusable response',
    happened:
      'A response arrived but it did not satisfy the read contract this client ' +
      'validates. REFS discards a response it cannot fully validate rather than ' +
      'displaying part of it as accounting data.',
    next:
      'Retry. If it persists, the deployed API and this client are on different ' +
      'contract versions and must be republished together.',
    offer: RETRY,
  },
  ACCOUNTING_API_SCOPE_INVALID: {
    title: 'The requested scope is not valid',
    happened:
      'This page asked the API for a scope it could not accept, such as an account ' +
      'reference, date range or row limit outside the permitted bounds.',
    next: 'Narrow the selection on the page and try again.',
    offer: null,
  },
  ACCOUNTING_API_COMMAND_INVALID: {
    title: 'The command was not sent',
    happened:
      'This client refused to send the command because its own preconditions were ' +
      'not met. Nothing was submitted to the accounting API.',
    next: 'Correct the entry on the page and submit again.',
    offer: null,
  },
  OIDC_CONFIGURATION_REQUIRED: {
    title: 'Identity provider is not configured',
    happened:
      'A secure PKCE sign-in could not be started. The published OIDC coordinates ' +
      'are absent or incomplete, or this browser does not expose the cryptography ' +
      'and session storage the flow requires.',
    next:
      'If other pages work in this browser, the deployment is missing its OIDC ' +
      'configuration and must be republished.',
    offer: null,
  },
  OIDC_LOGIN_REQUIRED: {
    title: 'Sign in to continue',
    happened: 'No identity session is held in this browser tab.',
    next: 'Sign in with the configured identity provider.',
    offer: SIGN_IN,
  },
  OIDC_LOGIN_REJECTED: {
    title: 'Sign-in was not completed',
    happened: 'The identity provider returned an error instead of an authorization code.',
    next: 'Start sign-in again. If it keeps failing, the provider holds the reason.',
    offer: SIGN_IN,
  },
  OIDC_STATE_INVALID: {
    title: 'Sign-in could not be verified',
    happened:
      'The value returned from the identity provider did not match the one this tab ' +
      'started with, or it arrived too late. REFS discarded it rather than accepting ' +
      'an unverified sign-in.',
    next: 'Start sign-in again from this tab.',
    offer: SIGN_IN,
  },
  OIDC_TOKEN_UNAVAILABLE: {
    title: 'Could not reach the identity provider',
    happened:
      'The token request produced no usable response. As with any transport failure ' +
      'this looks the same from the browser whatever the underlying cause.',
    next: 'Retry sign-in.',
    offer: SIGN_IN,
  },
  OIDC_TOKEN_INVALID: {
    title: 'The identity provider returned an unusable token',
    happened:
      'A token arrived but failed validation: issuer, audience, type or expiry did ' +
      'not match what this deployment is configured to accept. It was discarded.',
    next:
      'Start sign-in again. If it persists, the deployed OIDC configuration and the ' +
      'provider do not agree and the deployment must be corrected.',
    offer: SIGN_IN,
  },
  OIDC_SESSION_EXPIRING: {
    title: 'This sign-in is about to expire',
    happened:
      'The access token this tab holds expires shortly and REFS could not renew it in the background. You are still signed in; this is not an access refusal.',
    next: 'Finish or copy anything unsaved, then sign in again before the current token expires.',
    offer: SIGN_IN,
  },
  OIDC_SESSION_EXPIRED: {
    title: 'This sign-in has expired',
    happened:
      'The access token this tab held has expired. REFS will not send an expired token, so no further authoritative read or write can succeed from this page.',
    next: 'Copy anything unsaved, then sign in again. Your retained route returns after authentication.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_UNAVAILABLE: {
    title: 'Background renewal was not attempted',
    happened: 'The current verified session or browser runtime could not support a subject-bound PKCE renewal.',
    next: 'Sign in again before the current token expires.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_REFUSED: {
    title: 'The identity provider refused background renewal',
    happened: 'The provider answered the prompt-free renewal with an error. This is a session-lifetime condition, not an access decision.',
    next: 'Sign in again.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_BLOCKED: {
    title: 'Background renewal did not answer',
    happened: 'The hidden renewal request produced no answer before REFS stopped waiting.',
    next: 'Sign in again; silent renewal is unavailable in this browser and provider pairing.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_UNREACHABLE: {
    title: 'Could not reach the identity provider to renew',
    happened: 'The renewal token request produced no usable HTTP response.',
    next: 'Sign in again. The existing session remains unchanged until it expires.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_INVALID: {
    title: 'The renewed token was not usable',
    happened: 'The renewal response failed the same issuer, audience, subject, token-type or expiry checks as interactive sign-in and was discarded.',
    next: 'Sign in again. If this repeats, correct the OIDC deployment configuration.',
    offer: SIGN_IN,
  },
  OIDC_RENEWAL_SUBJECT_MISMATCH: {
    title: 'The renewed token named a different person',
    happened: 'The provider returned a token for a different subject. REFS discarded it and preserved the existing session.',
    next: 'Sign in again and investigate the provider configuration if this recurs.',
    offer: SIGN_IN,
  },
  OIDC_FRAMED_CONTEXT: {
    title: 'REFS will not run inside a frame',
    happened: 'This document is embedded in another page. REFS refuses to complete sign-in or read accounting data from that framed context.',
    next: 'Open REFS in its own tab.',
    offer: null,
  },
};

const FALLBACK = {
  title: 'Accounting data could not be loaded',
  happened:
    'REFS received a failure it does not classify. It is shown here with its code ' +
    'rather than being described as something it might not be.',
  next: 'Retry. If it persists, report the code above.',
  offer: RETRY,
};

export const runtimeErrorState = code => STATES[code] || FALLBACK;
export const runtimeErrorCodes = () => Object.keys(STATES);

// `detail` is the message the API or client attached to the failure. It is
// shown verbatim and labelled as reported detail, never rewritten into a cause.
export function RuntimeErrorPanel({ code, detail, onRetry, onSignIn, extraActions = null }) {
  const state = runtimeErrorState(code);
  const label = typeof code === 'string' && code ? code : 'UNCLASSIFIED';
  const retry = state.offer === RETRY && typeof onRetry === 'function';
  const signIn = state.offer === SIGN_IN && typeof onSignIn === 'function';
  const actions = retry || signIn || extraActions
    ? <>
        {retry && <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>Try again</button>}
        {signIn && <button type="button" className="btn btn-sm btn-primary" onClick={onSignIn}>Sign in</button>}
        {extraActions}
      </>
    : null;
  return <StateBlock tone="error" title={state.title} label={`Runtime error ${label}`} actions={actions}>
    <p>{state.happened}</p>
    <p>{state.next}</p>
    {detail ? <p className="muted sm">Reported detail: {detail}</p> : null}
    <p className="muted sm">Error code: {label}</p>
    <p className="muted sm">No demonstration or browser-stored data is shown in place of accounting data.</p>
  </StateBlock>;
}

// Full-page variant used when the failure happens before any workspace can be
// entered. It reuses the sign-in shell so the framing matches the rest of the
// application in both light and dark themes.
export function RuntimeErrorPage({ code, detail, onRetry, onSignIn, extraActions = null }) {
  return <main className="login-shell">
    <section className="login-card">
      <div className="login-logo" aria-hidden="true">REFS</div>
      <h1 className="login-sub">Real Estate Financial System</h1>
      <RuntimeErrorPanel code={code} detail={detail} onRetry={onRetry} onSignIn={onSignIn} extraActions={extraActions}/>
    </section>
  </main>;
}
