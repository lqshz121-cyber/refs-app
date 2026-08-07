// H. Consolidated position, Jan-Jul 2026, all 119 entities.
import { POSTED, COA, WBS_COA_MAP, drOf, crOf, fmt } from './_ledger.js';
const out=[]; const P=s=>out.push(s);
const nm=c=>(COA.find(a=>a.account_code===c)||{}).account_name||WBS_COA_MAP[c]?.name||'?';
const ty=c=>{const a=COA.find(x=>x.account_code===c); if(a)return a.account_type; return c[0]==='1'?'ASSET':c[0]==='2'?'LIABILITY':c[0]==='3'?'EQUITY':c[0]==='4'?'REVENUE':'EXPENSE';};
const tb={}; POSTED.forEach(j=>j.lines.forEach(l=>{const k=l.account_code; tb[k]=tb[k]||{d:0,c:0}; tb[k].d+=Math.round(drOf(l)*100); tb[k].c+=Math.round(crOf(l)*100);}));
P('CONSOLIDATED TRIAL BALANCE · 119 entities · 2026-01 to 2026-07 · no eliminations');
P('  ACCT   NAME                                  TYPE            DEBIT            CREDIT           BALANCE');
let TD=0,TC=0;
Object.keys(tb).sort().forEach(k=>{const r=tb[k];TD+=r.d;TC+=r.c;
  P(`  ${k} ${nm(k).slice(0,36).padEnd(36)} ${ty(k).padEnd(9)} ${fmt(r.d/100).padStart(16)} ${fmt(r.c/100).padStart(16)} ${fmt((r.d-r.c)/100).padStart(16)}`);});
P(`  ${''.padEnd(55)} ${fmt(TD/100).padStart(16)} ${fmt(TC/100).padStart(16)}   ties=${TD===TC}`);
const g=t=>Object.keys(tb).filter(k=>ty(k)===t).reduce((s,k)=>s+tb[k].d-tb[k].c,0)/100;
const A=g('ASSET'),L=-g('LIABILITY'),E=-g('EQUITY'),R=-g('REVENUE'),X=g('EXPENSE');
P(`\nAssets ${fmt(A)} = Liabilities ${fmt(L)} + Equity ${fmt(E)} + Earnings ${fmt(R-X)}  -> ${fmt(L+E+R-X)}  ties=${Math.abs(A-(L+E+R-X))<0.005}`);
P(`Revenue ${fmt(R)}  Expense ${fmt(X)}  Net income ${fmt(R-X)}  net margin ${(100*(R-X)/R).toFixed(1)}%`);
// This block used to claim the intercompany accounts "do NOT net to zero". They
// do - and always did - because the group's due-froms equal its due-tos. Netting
// to zero was never the point. The defect this file was reporting is that the
// GROSS balances are still on the balance sheet: $10.5m of intercompany
// receivable and $10.5m of intercompany payable, both counted, on a statement
// that "balances". This is a SUM OF ENTITY LEDGERS, not a consolidation.
const ic=['125000','291000','291001'].reduce((s,c)=>s+(tb[c]?tb[c].d-tb[c].c:0),0)/100;
const gross=['125000','291000','291001'].reduce((s,c)=>s+Math.abs(tb[c]?tb[c].d-tb[c].c:0),0)/100;
P('');
P('NOT A CONSOLIDATION. Nothing above is eliminated.');
P(`  125000 + 291000 + 291001 net = ${fmt(ic)} - they always net, because every due from has a mirror due to.`);
P(`  What is wrong is the GROSS: ${fmt(gross)} of intercompany balance is still carried on this balance sheet,`);
P('  and the intercompany revenue and expense above are still in the result twice over.');
P('  For the consolidated position, with the elimination ledger and the drill-back:');
P('    tools/analysis/consolidation.js   (measurement, exits 1 on any failure)');
P('    src/consolidation.js              (engine)   docs/CONSOLIDATION.md');
console.log(out.join('\n'));
