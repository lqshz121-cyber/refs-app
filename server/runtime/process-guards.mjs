// R15 / L21: process-level guards shared by the API and the workers.
//
// installProcessGuards: an unhandled promise rejection or uncaught exception
// must never print an object dump and exit 1 silently (the crash-loop class
// found on staging). We log one safe JSON event ({event, code}) — no message,
// no stack, no client objects — run the supplied stop() with a deadline, then
// exit 1 so the platform restarts a clean process. Listeners are installed once.
//
// gracefulClose: server.close() alone waits for idle keep-alive sockets, which
// can outlive the platform's termination grace period. Close idle connections
// immediately and force-close the rest after `timeoutMs`.
import {safeRuntimeFailureLog} from './safe-runtime-log.mjs';

const CODE=/^[A-Z][A-Z0-9_]{2,40}$/;
export const safeErrorCode=error=>{const c=error?.code;if(typeof c==='string'&&CODE.test(c))return c;if(typeof c==='string'&&/^[0-9A-Z]{5}$/.test(c))return c;return 'UNKNOWN';};

export function installProcessGuards({process:proc=process,logger=console,stop=async()=>{},exit=code=>proc.exit(code),stopTimeoutMs=10_000}={}){
  if(proc.__refsProcessGuards)return proc.__refsProcessGuards;
  let terminating=false;
  const terminate=async(event,error)=>{
    try{logger.error?.(JSON.stringify(event==='process_uncaught_exception'?{event:'process_uncaught_exception',code:safeErrorCode(error)}:{event:'process_unhandled_rejection',code:safeErrorCode(error)}));}catch{}
    if(terminating)return;terminating=true;
    const timer=setTimeout(()=>exit(1),stopTimeoutMs);timer.unref?.();
    try{await stop(event);}catch{}
    clearTimeout(timer);exit(1);
  };
  const onRejection=reason=>{terminate('process_unhandled_rejection',reason);};
  const onException=error=>{terminate('process_uncaught_exception',error);};
  proc.on('unhandledRejection',onRejection);proc.on('uncaughtException',onException);
  const guards=Object.freeze({uninstall(){proc.off('unhandledRejection',onRejection);proc.off('uncaughtException',onException);delete proc.__refsProcessGuards;},get terminating(){return terminating;}});
  proc.__refsProcessGuards=guards;return guards;
}

export function gracefulClose(server,{timeoutMs=10_000,setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout}={}){
  return new Promise(resolve=>{
    let done=false;const finish=()=>{if(done)return;done=true;clearTimeoutFn(timer);resolve();};
    const timer=setTimeoutFn(()=>{server.closeAllConnections?.();finish();},timeoutMs);timer.unref?.();
    server.close(()=>finish());
    server.closeIdleConnections?.();
  });
}
export {safeRuntimeFailureLog};
