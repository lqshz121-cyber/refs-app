// ===========================================================================
// Runtime boundary resolution.
//
// A published REFS client carries three independent facts:
//
//   1. dist/refs-runtime-lock.js  - installs the runtime-mode slot and refuses
//      to hold any value that is not an enumerated mode.
//   2. dist/refs-runtime-config.js - the deployment adapter. It declares the
//      mode and, in authoritative deployments, the API and OIDC coordinates.
//   3. dist/refs-build.js - the build stamp. scripts/write-runtime-config.mjs
//      stamps it with the release channel that the same build step used to
//      render the adapter.
//
// The demonstration surface (src/seed.js + localStorage) may render only when
// facts 2 and 3 agree that this build was produced as a public demonstration.
// Every other combination - a missing mode, an unrecognised mode, a mock
// adapter served by an authoritative build, an authoritative adapter served by
// a demonstration build - resolves to an explicit error surface. There is no
// combination that resolves to the demonstration surface by omission.
//
// This module is pure: it reads an environment object and returns a decision.
// It performs no I/O so that verify-runtime-fail-closed.mjs can execute every
// branch without a browser.
// ===========================================================================

export const AUTHORITATIVE_MODE = 'REQUIRES_AUTHORITATIVE_API';
export const DEMONSTRATION_MODE = 'LOCAL_MOCK';
// An explicitly built internal-test client may use the same deterministic
// fixture surface without carrying a provider token.  It is a separate mode
// so a public demonstration build can never be mistaken for an internal test.
export const INTERNAL_TEST_MODE = 'INTERNAL_TEST';
export const INTERNAL_TEST_READONLY_MODE = 'INTERNAL_TEST_READONLY';
export const INTERNAL_TEST_FULL_MODE = 'INTERNAL_TEST_FULL';
export const AUTHORITATIVE_CHANNEL = 'AUTHORITATIVE';
export const DEMONSTRATION_CHANNEL = 'PUBLIC_DEMONSTRATION';
export const RUNTIME_MODES = [AUTHORITATIVE_MODE, DEMONSTRATION_MODE, INTERNAL_TEST_MODE, INTERNAL_TEST_READONLY_MODE, INTERNAL_TEST_FULL_MODE];
export const RUNTIME_CHANNELS = [AUTHORITATIVE_CHANNEL, DEMONSTRATION_CHANNEL, INTERNAL_TEST_MODE, INTERNAL_TEST_READONLY_MODE, INTERNAL_TEST_FULL_MODE];

// The value refs-runtime-lock.js stores when an adapter tries to install a mode
// that is not enumerated. It is deliberately not one of RUNTIME_MODES.
export const REJECTED_MODE = 'RUNTIME_MODE_REJECTED';

export const SURFACE_AUTHORITATIVE = 'AUTHORITATIVE';
export const SURFACE_DEMONSTRATION = 'DEMONSTRATION';
export const SURFACE_INTERNAL_TEST = 'INTERNAL_TEST';
export const SURFACE_INTERNAL_TEST_READONLY = 'INTERNAL_TEST_READONLY';
export const SURFACE_INTERNAL_TEST_FULL = 'INTERNAL_TEST_FULL';
export const SURFACE_ERROR = 'ERROR';

const channelOf = environment => {
  const stamp = environment && environment.__BUILD;
  if (!stamp || typeof stamp !== 'object') return null;
  return typeof stamp.channel === 'string' && stamp.channel ? stamp.channel : null;
};

export function resolveRuntimeBoundary(environment = globalThis) {
  const mode = environment ? environment.__REFS_RUNTIME_MODE__ : undefined;
  const channel = channelOf(environment);
  const base = { mode: typeof mode === 'string' ? mode : null, channel };

  if (typeof mode !== 'string' || !mode.trim()) {
    return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CONFIG_MISSING' };
  }
  if (!RUNTIME_MODES.includes(mode)) {
    return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_MODE_UNRECOGNISED' };
  }
  if (channel !== null && !RUNTIME_CHANNELS.includes(channel)) {
    return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_UNRECOGNISED' };
  }
  if (mode === DEMONSTRATION_MODE) {
    // A demonstration adapter is honoured only by a build that was itself
    // stamped as a public demonstration. An unstamped build is not evidence,
    // so it does not qualify.
    if (channel !== DEMONSTRATION_CHANNEL) {
      return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_MISMATCH' };
    }
    return { ...base, surface: SURFACE_DEMONSTRATION, code: null };
  }
  if (mode === INTERNAL_TEST_READONLY_MODE) {
    if (channel !== INTERNAL_TEST_READONLY_MODE) return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_MISMATCH' };
    return { ...base, surface: SURFACE_INTERNAL_TEST_READONLY, code: null };
  }
  if (mode === INTERNAL_TEST_FULL_MODE) {
    if (channel !== INTERNAL_TEST_FULL_MODE) return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_MISMATCH' };
    return { ...base, surface: SURFACE_INTERNAL_TEST_FULL, code: null };
  }
  if (mode === INTERNAL_TEST_MODE) {
    // Internal-test must be deliberately stamped.  Like the public fixture
    // mode, it may not coexist with authoritative API/OIDC coordinates.
    if (channel !== INTERNAL_TEST_MODE) {
      return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_MISMATCH' };
    }
    return { ...base, surface: SURFACE_INTERNAL_TEST, code: null };
  }
  if (channel === DEMONSTRATION_CHANNEL) {
    return { ...base, surface: SURFACE_ERROR, code: 'RUNTIME_CHANNEL_MISMATCH' };
  }
  return { ...base, surface: SURFACE_AUTHORITATIVE, code: null };
}
