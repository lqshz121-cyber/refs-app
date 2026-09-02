import {pathToFileURL} from 'node:url';
import {HttpOutboxPublisher} from './outbox-dispatcher.mjs';
import {outboxDispatchConfig} from './start-outbox-dispatch-worker.mjs';

export function verifyOutboxDispatchReleaseConfig(env=process.env){
  const config=outboxDispatchConfig(env);
  new HttpOutboxPublisher({...config.publisher,timeoutMs:config.timeoutMs,nodeEnv:env.NODE_ENV,fetcher:async()=>{throw new Error('release configuration validation must not use the network');}});
  return Object.freeze({schema_version:'OUTBOX_DISPATCH_RELEASE_CONFIG_V1',ready:true,scope_count:config.scopes.length,tenant_count:new Set(config.scopes.map(scope=>scope.tenantId)).size});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{console.log(JSON.stringify(verifyOutboxDispatchReleaseConfig()));}
  catch(error){console.error(JSON.stringify({schema_version:'OUTBOX_DISPATCH_RELEASE_CONFIG_V1',ready:false,error_code:/^[A-Z0-9_]{3,80}$/.test(error?.code||'')?error.code:'OUTBOX_DISPATCH_CONFIG_INVALID'}));process.exitCode=1;}
}
