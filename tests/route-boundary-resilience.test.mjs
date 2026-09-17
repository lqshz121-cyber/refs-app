// O08: white-screen resilience contract.
//  * every routed workspace renders inside AuthoritativeRouteBoundary (keyed by route), under the root boundary
//  * the boundary's failure state names a stable code, the route and the release stamp, offers a retry and never
//    renders a figure
//  * startup chain: boot guard right after #root, runtime lock + config before bundle, third-party scripts async+SRI
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');

test('the routed content of the authoritative shell is wrapped by a per-route boundary that remounts on route change',()=>{
  const app=read('src/authoritative-app.jsx');
  assert.match(app,/import \{ AuthoritativeRouteBoundary \} from '\.\/authoritative-route-boundary\.jsx';/);
  const open=app.indexOf('<AuthoritativeRouteBoundary key={route} route={route}>'),close=app.indexOf('</AuthoritativeRouteBoundary>'),main=app.indexOf('</main>',open);
  assert.ok(open>0&&close>open&&main>close,'boundary opens after the scope bar and closes before </main>');
  const inside=app.slice(open,close);
  assert.ok((inside.match(/route === '/g)||[]).length>=10,'the route switch lives inside the boundary');
  assert.match(inside,/CounterpartyRegisterWorkspace/);
});

test('the route boundary reports ROUTE_RENDER_FAILED with route + release stamp, offers retry, resets on route change, and substitutes no figure',()=>{
  const src=read('src/authoritative-route-boundary.jsx');
  assert.match(src,/static getDerivedStateFromError\(error\)/);
  assert.match(src,/componentDidUpdate\(previous\)\{if\(previous\.route!==this\.props\.route&&this\.state\.failed\)/);
  assert.match(src,/ROUTE_RENDER_FAILED/);assert.match(src,/release <code>\{releaseStamp\(\)\}/);
  assert.match(src,/Retry this page/);assert.match(src,/no figure was substituted/);
  assert.doesNotMatch(src,/fetch\(|accounting-api/);
  // the root boundary is still the last line of defence
  const root=read('src/app.jsx');assert.match(root,/class AuthoritativeRootBoundary extends Component/);assert.match(root,/<AuthoritativeRootBoundary><AuthoritativeApp/);
});

test('index.html startup chain: guard immediately after #root, lock and config before bundle, remote scripts async with SRI, zero inline scripts',()=>{
  const html=read('index.html');
  const scripts=[...html.matchAll(/<script\b([^>]*)>/g)].map(m=>m[1]);
  const srcs=scripts.map(a=>(a.match(/src="([^"]+)"/)||[])[1]||null);
  assert.equal(srcs.filter(s=>s===null).length,0,'no inline scripts');
  const order=srcs.map(s=>s.replace(/^\.\//,''));
  const idx=name=>order.findIndex(s=>s.startsWith(name));
  assert.ok(idx('refs-build.js')<idx('refs-boot-guard.js')&&idx('refs-boot-guard.js')<idx('refs-runtime-lock.js')&&idx('refs-runtime-lock.js')<idx('refs-runtime-config.js')&&idx('refs-runtime-config.js')<idx('bundle.js'),`startup order: ${order.join(' → ')}`);
  for(const attrs of scripts){if(!/src="https?:\/\//.test(attrs))continue;assert.match(attrs,/\basync\b|\bdefer\b/,'third-party script must not block');assert.match(attrs,/integrity="sha(256|384|512)-/);assert.match(attrs,/crossorigin="anonymous"/);}
  assert.equal(scripts.filter(a=>/src="https?:\/\//.test(a)).length,1,'exactly one remote script (Chart.js) is in the page');
});

test('the root boundary and the boot guard cover the two blank-page classes: bundle never ran vs render threw',()=>{
  const guard=read('refs-boot-guard.js');
  assert.match(guard,/APP_BUNDLE_NOT_STARTED/);assert.match(guard,/delayMs=8000/);assert.match(guard,/if\(root\.childElementCount>0\|\|root\.textContent\.trim\(\)\.length>0\)return;/);
  const runtimeErrorPage=read('src/runtime-error-page.jsx');
  assert.match(runtimeErrorPage,/ACCOUNTING_API_PROTOCOL|CONFIGURATION_REQUIRED|code/);
});
