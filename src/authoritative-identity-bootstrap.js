export async function bootstrapAuthoritativeIdentity(oidcClient, isActive = () => true) {
  const result = await oidcClient.completeRedirect();
  if (!isActive()) return { cancelled: true, redirectStarted: false, result: null };
  if (!result.ok && result.code === 'OIDC_LOGIN_REQUIRED') {
    try {
      await oidcClient.startLogin();
      return { cancelled: false, redirectStarted: true, result: null };
    } catch {
      return { cancelled: false, redirectStarted: false, result };
    }
  }
  return { cancelled: false, redirectStarted: false, result };
}
