import test from 'node:test';
import assert from 'node:assert/strict';
import {readBuildStamp} from '../runtime/read-build-stamp.mjs';
const sha='a'.repeat(40),base=`window.__BUILD={"sha":"${sha}","time":"2026-10-11 16:16 UTC"};\n`;
const suffix='// Release channel stamped by the same build step that rendered the deployment adapter.\nwindow.__BUILD=Object.assign(window.__BUILD||{},{channel:"AUTHORITATIVE",authoritative:true});\n';
test('reads actual two-stage deployment stamp without executing JavaScript',()=>assert.deepEqual(readBuildStamp(base+suffix),{sha,time:'2026-10-11 16:16 UTC',channel:'AUTHORITATIVE',authoritative:true}));
test('preserves single literal stamp and exact complete SHA',()=>assert.deepEqual(readBuildStamp(`window.__BUILD={"sha":"${sha}","channel":"AUTHORITATIVE","authoritative":true};`),{sha,channel:'AUTHORITATIVE',authoritative:true}));
test('unmarked build remains unmarked, not implicitly authoritative',()=>assert.equal(readBuildStamp(base).authoritative,undefined));
test('preserves explicit non-authoritative channel for callers to reject',()=>assert.equal(readBuildStamp(base+suffix.replace('AUTHORITATIVE','PUBLIC_DEMONSTRATION').replace('true','false')).authoritative,false));
test('rejects executable, duplicate, conflicting and malformed stamps',()=>{
  for(const value of [base+suffix+'fetch("https://example.test");',base+base,base+suffix+suffix,'window.__BUILD={"sha":(()=>"x")()};',`window.__BUILD={"sha":"${sha}","channel":"PUBLIC_DEMONSTRATION","authoritative":false};\n`+suffix])assert.throws(()=>readBuildStamp(value));
});
