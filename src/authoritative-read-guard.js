// Each accounting read owns a generation. Scope changes and sign-out revoke
// outstanding generations before their asynchronous responses can update UI.
export function createAuthoritativeReadGuard() {
  let generation = 0;
  const requests = new Map();
  return {
    capture() { return generation; },
    invalidate() { generation += 1; requests.clear(); },
    begin(channel = 'refresh', expectedGeneration = generation) {
      if (expectedGeneration !== generation) return () => false;
      const scopeGeneration = generation;
      const request = Symbol(channel);
      requests.set(channel, request);
      return () => scopeGeneration === generation && requests.get(channel) === request;
    },
  };
}
