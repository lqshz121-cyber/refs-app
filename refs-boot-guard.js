// Boot guard: the only thing that can speak when bundle.js never runs (404,
// blocked, cache key mismatch, module-level throw before createRoot). Loaded
// as an external same-origin script so the CSP (no unsafe-inline) allows it.
// It never touches the app once #root has content; React replaces the notice.
(function(){
  'use strict';
  var root=document.getElementById('root');if(!root)return;
  var delayMs=8000;
  function stamp(){try{var b=window.__BUILD||null;var sha=b&&b.sha;return sha?String(sha).slice(0,12):'unknown';}catch(e){return 'unknown';}}
  function notice(){
    if(root.childElementCount>0||root.textContent.trim().length>0)return;
    var box=document.createElement('div');
    box.setAttribute('role','alert');box.setAttribute('data-refs-boot-guard','APP_BUNDLE_NOT_STARTED');
    box.style.cssText='max-width:560px;margin:15vh auto;padding:24px;font:15px/1.5 system-ui,sans-serif;color:#1f2933;border:1px solid #d9dde3;border-radius:8px;background:#fff';
    box.innerHTML='<h1 style="font-size:18px;margin:0 0 8px">REFS did not start</h1>'+
      '<p style="margin:0 0 8px">The application bundle did not run within '+(delayMs/1000)+' seconds. This is a deployment or network problem, not an accounting state.</p>'+
      '<p style="margin:0 0 8px">Code: <code>APP_BUNDLE_NOT_STARTED</code> · release <code>'+stamp()+'</code></p>'+
      '<p style="margin:0">Reload the page. If it persists, report the code and release above to the release owner.</p>';
    root.appendChild(box);
  }
  window.setTimeout(notice,delayMs);
})();
