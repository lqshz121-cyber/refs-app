import {createHash,randomBytes} from 'node:crypto';
import {KernelError,requireRow,withTransaction} from './db.mjs';

const tokenHash=token=>'sha256:'+createHash('sha256').update(token).digest('hex');

function trustedPrincipal(principal){
  if(!principal||principal.trusted!==true||!principal.actorId)throw new KernelError('AUTHENTICATED_PRINCIPAL_REQUIRED','Context issuance requires an authenticated server-side principal');
  return principal;
}

export class PostgresContextIssuer{
  constructor(pool,{principalProvider}={}){
    if(typeof principalProvider!=='function')throw new KernelError('PRINCIPAL_PROVIDER_REQUIRED','Issuer requires authenticated middleware');
    this.pool=pool;this.principalProvider=principalProvider;
  }

  async issue({tenantId,ttlSeconds=300}){
    const principal=trustedPrincipal(await this.principalProvider());
    const contextToken=randomBytes(32).toString('base64url');
    const hash=tokenHash(contextToken);
    const issued=await withTransaction(this.pool,async client=>requireRow(await client.query(
      'SELECT (refs_issue_context($1,$2,$3,$4)).*',[principal.actorId,tenantId,hash,ttlSeconds]
    ),'CONTEXT_ISSUE_FAILED','Context issuer did not return a capability'));
    return {trusted:true,contextToken,expiresAt:issued.expires_at};
  }

  async revoke({contextToken,reason}){
    if(typeof contextToken!=='string'||contextToken.length<32)throw new KernelError('CONTEXT_TOKEN_REQUIRED','A context token is required');
    return withTransaction(this.pool,async client=>requireRow(await client.query(
      'SELECT refs_revoke_context($1,$2) AS revoked',[tokenHash(contextToken),reason||'Revoked by authenticated service']
    ),'CONTEXT_REVOKE_FAILED','Context revoke did not return a result').revoked);
  }

  async cleanup({retention='1 day'}={}){
    return withTransaction(this.pool,async client=>requireRow(await client.query(
      'SELECT refs_cleanup_contexts($1::interval) AS deleted',[retention]
    ),'CONTEXT_CLEANUP_FAILED','Context cleanup did not return a result').deleted);
  }
}

export const hashContextToken=tokenHash;
