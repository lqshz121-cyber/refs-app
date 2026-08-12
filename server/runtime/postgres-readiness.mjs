const TRANSIENT_CONNECTION_CODES=new Set(['57P03','ECONNREFUSED','ECONNRESET','ECONNABORTED','EPIPE','ETIMEDOUT']);
const TRANSIENT_CONNECTION_MESSAGES=new Set(['Connection terminated unexpectedly']);

export function isTransientPostgresStartupError(error){
  return TRANSIENT_CONNECTION_CODES.has(error?.code)||(!error?.code&&TRANSIENT_CONNECTION_MESSAGES.has(error?.message));
}

export async function waitForPostgresReadiness({probe,timeoutMs=30_000,intervalMs=250,sleep=delay=>new Promise(resolve=>setTimeout(resolve,delay)),now=Date.now}={}){
  if(typeof probe!=='function')throw new TypeError('PostgreSQL readiness probe is required');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new TypeError('PostgreSQL readiness timeout must be a positive safe integer');
  if(!Number.isSafeInteger(intervalMs)||intervalMs<=0)throw new TypeError('PostgreSQL readiness interval must be a positive safe integer');
  const startedAt=now();
  let attempts=0;
  while(true){
    attempts+=1;
    try{
      await probe();
      return {attempts,elapsedMs:now()-startedAt};
    }catch(error){
      if(!isTransientPostgresStartupError(error))throw error;
      const elapsedMs=now()-startedAt;
      if(elapsedMs>=timeoutMs){
        const timeout=new Error(`PostgreSQL did not become ready within ${timeoutMs}ms after ${attempts} attempts: ${error.code||error.name}`);
        timeout.code='PG_READINESS_TIMEOUT';
        timeout.cause=error;
        throw timeout;
      }
      await sleep(Math.min(intervalMs,timeoutMs-elapsedMs));
    }
  }
}
