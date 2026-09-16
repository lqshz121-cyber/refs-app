// S11 / E2E-BROWSER-MATRIX B12: when bundle.js never runs, the page must not
// stay blank. refs-boot-guard.js is CSP-compatible (external, same origin) and
// must (a) speak after the delay when #root is still empty, (b) stay silent
// when the app mounted, (c) name the release stamp and a stable code.
// A tiny DOM stub keeps this dependency-free (no jsdom in the tree).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../refs-boot-guard.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function element(tag){const el={tag,attrs:{},children:[],style:{},innerHTML:'',get childElementCount(){return this.children.length;},get textContent(){return this.children.map(c=>c.innerHTML.replace(/<[^>]+>/g,' ')).join(' ')+this.innerHTML.replace(/<[^>]+>/g,' ');},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;},appendChild(c){this.children.push(c);return c;}};return el;}
function boot({mounted=false,build=true}={}){
  const root=element('div');if(mounted){root.children.push(Object.assign(element('main'),{innerHTML:'app'}));}
  let fire=null;
  const window={document:{getElementById:id=>id==='root'?root:null,createElement:element},setTimeout:(fn,ms)=>{fire={fn,ms};return 1;}};
  if(build)window.__BUILD={sha:'8d340a50c598cc31618bb8b49811b7ee5f6e54e4',channel:'AUTHORITATIVE'};
  window.window=window;vm.runInNewContext(src,window);
  return {root,fire};
}
test('index.html loads the guard right after #root, before the runtime adapter chain, and keeps zero inline scripts',()=>{
  const guard=html.indexOf('./refs-boot-guard.js'),lock=html.indexOf('./refs-runtime-lock.js'),root=html.indexOf('<div id="root">');
  assert.ok(root>0&&root<guard&&guard<lock);
  assert.equal((html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)||[]).length,0);
});
test('blank #root after the delay becomes a visible notice with a stable code and the release stamp',()=>{
  const {root,fire}=boot();assert.equal(fire.ms,8000);fire.fn();
  const alert=root.children[0];assert.ok(alert,'notice rendered');
  assert.equal(alert.getAttribute('role'),'alert');assert.equal(alert.getAttribute('data-refs-boot-guard'),'APP_BUNDLE_NOT_STARTED');
  assert.match(alert.innerHTML,/8d340a50c598/);assert.match(alert.innerHTML,/not an accounting state/);
});
test('a mounted app is never touched',()=>{const {root,fire}=boot({mounted:true});fire.fn();assert.equal(root.children.length,1);assert.equal(root.children[0].tag,'main');});
test('missing build stamp degrades to "unknown" rather than throwing',()=>{const {root,fire}=boot({build:false});fire.fn();assert.match(root.children[0].innerHTML,/release <code>unknown<\/code>/);});
test('build copies the guard into dist and the asset verifier requires it in order',()=>{
  assert.match(readFileSync(new URL('../build.mjs',import.meta.url),'utf8'),/refs-boot-guard\.js/);
  assert.match(readFileSync(new URL('../scripts/verify-runtime-deployment-assets.mjs',import.meta.url),'utf8'),/'refs-boot-guard\.js'/);
});
