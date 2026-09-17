// O07: one vocabulary for "no data / not imported / no permission / not configured / service error / loading" across
// the authoritative workspaces.
//  * a failed GET keeps its failure object (code + message); `error:result.message` would throw the code away and make
//    NO_PERMISSION indistinguishable from a network failure
//  * every ERROR render goes through AuthoritativeReadFailure or shows the error code
//  * the diagnostic vocabulary names every client failure code the API client can emit
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const srcDir=fileURLToPath(new URL('../src/',import.meta.url));
const files=readdirSync(srcDir).filter(name=>/^authoritative-.*\.jsx$/.test(name));
const src=name=>readFileSync(`${srcDir}${name}`,'utf8');

test('no authoritative workspace discards the failure code when it records a failed read',()=>{
  const offenders=files.filter(name=>/phase:'ERROR'[^}]*error:result\.message\}/.test(src(name)));
  assert.deepEqual(offenders,[],`these files store only the message: ${offenders.join(', ')}`);
});

test('every ERROR render either uses AuthoritativeReadFailure or surfaces the error code',()=>{
  const offenders=[];
  for(const name of files){
    const s=src(name);
    if(!/phase==='ERROR'/.test(s))continue;
    const lines=s.split('\n');
    lines.forEach((line,index)=>{
      if(!/phase==='ERROR'/.test(line))return;
      const window=lines.slice(index,index+2).join('\n');
      if(!/AuthoritativeReadFailure|ReadError|error\?\.code|error\.code|diagnostic|phase!=='ERROR'|!=='ERROR'|readFailure/.test(window))offenders.push(`${name}:${index+1}`);
    });
  }
  // Known remaining ad-hoc renders (detail panels and asset sub-views) are listed here so a regression on any register
  // fails loudly while the backlog stays visible; shrink this list, never grow it.
  const backlog=new Set(["authoritative-accrual-workspace.jsx:35","authoritative-asset-acquisition.jsx:31","authoritative-asset-depreciation.jsx:69","authoritative-asset-disposal.jsx:28","authoritative-bank-workspace.jsx:232","authoritative-bank-workspace.jsx:328","authoritative-bank-workspace.jsx:368","authoritative-bank-workspace.jsx:382","authoritative-bank-workspace.jsx:393","authoritative-capitalization-panel.jsx:15","authoritative-cash-transfer-workspace.jsx:33","authoritative-cash-transfer-workspace.jsx:49","authoritative-construction-loan-panel.jsx:17","authoritative-expense-panel.jsx:14","authoritative-fixed-asset-movements.jsx:33","authoritative-recurring-transactions-workspace.jsx:5","authoritative-revenue-recognition-workspace.jsx:18","authoritative-rules-workspace.jsx:7","authoritative-source-documents-workspace.jsx:58"]);
  const unexpected=offenders.filter(item=>!backlog.has(item));
  assert.deepEqual(unexpected,[],`ad-hoc ERROR renders outside the recorded backlog: ${unexpected.join(', ')}`);
  const resolved=[...backlog].filter(item=>!offenders.includes(item));
  assert.deepEqual(resolved,[],`backlog entries now resolved — remove them from the list: ${resolved.join(', ')}`);
});

test('the shared diagnostic names every failure code the API client can emit',async()=>{
  const {authoritativeReadFailureDiagnostic,AUTHORITATIVE_READ_BLOCKED_CODES}=await import('../src/authoritative-read-state.jsx').catch(()=>({}));
  const readState=src('authoritative-read-state.jsx');
  for(const code of ['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED','ACCOUNTING_API_SCOPE_INVALID','ACCOUNTING_API_SCOPE_NOT_FOUND','ACCOUNTING_API_PROTOCOL','CONFIGURATION_REQUIRED','ACCOUNTING_API_UNREACHABLE','ACCOUNTING_API_SERVER_ERROR','ACCOUNTING_API_RATE_LIMITED','ACCOUNTING_API_REQUEST_REJECTED'])assert.ok(readState.includes(`${code}:{status:`)||readState.includes(`code==='${code}'`),`diagnostic missing ${code}`);
  // blocked codes (access/config/scope/protocol) never fall into the retryable ERROR class
  for(const code of ['AUTHENTICATION_REQUIRED','AUTHORIZATION_DENIED','CONFIGURATION_REQUIRED','ACCOUNTING_API_PROTOCOL'])assert.match(readState,new RegExp(`'${code}'`));
  assert.match(readState,/Do not treat this view as accounting evidence/);
  assert.match(readState,/A zero row count and a failed GET are materially different accounting facts/);
});
