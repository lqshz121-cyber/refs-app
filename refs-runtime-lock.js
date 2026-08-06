// Static deployments must never silently fall back to browser-local demo data.
//
// This file installs the runtime-mode slot before the deployment adapter runs.
// The slot is non-configurable, so a later script cannot delete or redefine it,
// and its setter accepts only an enumerated mode. An adapter that installs an
// unknown mode leaves the slot holding RUNTIME_MODE_REJECTED, which resolves to
// an explicit error surface - never to the demonstration surface.
(function(){
  var ALLOWED=['REQUIRES_AUTHORITATIVE_API','LOCAL_MOCK'];
  var mode='REQUIRES_AUTHORITATIVE_API';
  try{
    Object.defineProperty(window,'__REFS_RUNTIME_MODE__',{
      configurable:false,
      enumerable:true,
      get:function(){return mode;},
      set:function(next){mode=ALLOWED.indexOf(next)>=0?next:'RUNTIME_MODE_REJECTED';}
    });
  }catch(error){
    window.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';
  }
  window.__REFS_RUNTIME_LOCK__={installed:true,allowed:ALLOWED.slice()};
})();
