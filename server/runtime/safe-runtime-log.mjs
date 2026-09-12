const EVENT=/^[a-z][a-z0-9_]{2,127}$/;
const CODE=/^[A-Z][A-Z0-9_]{2,127}$/;

// Startup and shutdown failures may contain database URLs, credentials, or
// provider responses. Runtime logs expose only a fixed event and code.
export function safeRuntimeFailureLog(event,code){
  if(!EVENT.test(event||'')||!CODE.test(code||''))throw new TypeError('Runtime failure log requires fixed event and code');
  return JSON.stringify({event,code});
}
