// R30 / L15: production GO/NO-GO report generated from the acceptance matrix.
// Any P0 row that is not both offline-evidenced and LIVE_VERIFIED, any GAP or
// BLOCKED row, or any missing input (matrix, release notes, deploy gate) yields
// NO-GO. The report never upgrades evidence; it only reads what the matrix says.
// Usage: node tools/go-no-go-report.mjs [matrix.md] [--json]
import {readFileSync,existsSync} from 'node:fs';
const [matrixPath='ACCEPTANCE-TRACEABILITY-MATRIX.md',...flags]=process.argv.slice(2);
const json=flags.includes('--json');
const blockers=[],warnings=[];
if(!existsSync(matrixPath)){blockers.push('matrix missing');}
const matrix=existsSync(matrixPath)?readFileSync(matrixPath,'utf8'):'';
const rows=matrix.split('\n').filter(l=>/^\| [A-F]\d+ \|/.test(l)).map(l=>{const c=l.split('|').map(x=>x.trim());return {id:c[1],req:c[2],live:c[7],status:c[8],owner:c[9]};});
const P0=/^A\d+|^B[1-4]$|^C[12]$|^D1$|^E[12]$/;
for(const r of rows){
  const s=r.status||'';
  if(/^GAP|^BLOCKED/.test(s))blockers.push(`${r.id} ${s.split('(')[0].trim()} — ${r.req.slice(0,70)}`);
  else if(/^PARTIAL/.test(s)&&P0.test(r.id))blockers.push(`${r.id} PARTIAL — ${r.req.slice(0,70)}`);
  else if(P0.test(r.id)&&!/^LIVE_VERIFIED/.test(r.live))blockers.push(`${r.id} no live read-back — ${r.req.slice(0,70)}`);
  else if(/^PARTIAL/.test(s))warnings.push(`${r.id} PARTIAL (P1) — ${r.req.slice(0,60)}`);
  if(/^DONE/.test(s)&&!/☑/.test(r.owner))blockers.push(`${r.id} marked DONE without Owner tick`);
}
for(const f of ['RELEASE-NOTES-2026-09-CANDIDATE.md','RELEASE-GATES.md','server/PRODUCTION-RECOVERY-RUNBOOK.md','verify-release-deploy-gate.mjs'])if(!existsSync(f))blockers.push(`required release document missing: ${f}`);
if(!/Production Blueprint exists[^\n]*\| (EVIDENCED|DONE)/.test(matrix))blockers.push('no verified production Blueprint (A9)');
const decision=blockers.length?'NO-GO':'GO';
const report={generated_at:new Date().toISOString(),matrix:matrixPath,rows:rows.length,decision,blockers,warnings,rule:'any GAP/BLOCKED row, any P0 row without LIVE_VERIFIED read-back, any DONE without Owner tick, or any missing release document => NO-GO'};
if(json)console.log(JSON.stringify(report,null,2));else{console.log(`# Production GO/NO-GO — ${decision}\n\nGenerated ${report.generated_at} from ${matrixPath} (${rows.length} rows)\n\n## Blockers (${blockers.length})\n${blockers.map(b=>'- '+b).join('\n')||'- none'}\n\n## Warnings (${warnings.length})\n${warnings.map(w=>'- '+w).join('\n')||'- none'}\n\nRule: ${report.rule}`);}
process.exitCode=decision==='GO'?0:3;
