// C. Real-estate specific tests + completeness of the close checklist.
import { ALL, POSTED, ENTITIES, ENT, LOANS, PM_ROWS, MAPPINGS, BANK_TXNS, BANK_ACCOUNTS, IC_TXNS, LOAN_TXNS, SOURCE_DOCS, memberOf, drOf, crOf, fmt } from './_ledger.js';
const out=[]; const P=s=>out.push(s);
const bal = code => POSTED.reduce((s,j)=>s+j.lines.filter(l=>l.account_code===code).reduce((t,l)=>t+Math.round(drOf(l)*100)-Math.round(crOf(l)*100),0),0)/100;
const lines = code => { const r=[]; POSTED.forEach(j=>j.lines.forEach(l=>{if(l.account_code===code)r.push({j,l});})); return r; };

P('== A. OPENING BALANCES / PRIOR PERIOD ==');
['370200','370300','371000','372000','351000','352000','380101','380104','380400','380300'].forEach(c=>{
  const n=lines(c).length; if(n) P(`  ${c}: lines=${n} balance(dr-cr)=${fmt(bal(c))}`);
});
P(`  equity accounts with ANY posting: ${['370200','370300','371000','372000','351000','352000','380101','380102','380104','380110','380200','380300','380310','380400','381101'].filter(c=>lines(c).length).join(', ')||'NONE except those listed above'}`);
P(`  total equity postings across all 119 entities: ${['370200','370300','371000','372000','351000','352000','380101','380102','380104','380110','380200','380300','380310','380400','381101'].reduce((s,c)=>s+lines(c).length,0)} lines`);
P('  => there is NO opening trial balance and NO retained-earnings carry-forward. First posted JE is 2026-01.');

P('\n== B. LOAN ACCOUNTING ==');
['260100','260101','260200','270100','270101','270200','270700','289500'].forEach(c=>{const n=lines(c).length; if(n)P(`  loan acct ${c}: lines=${n} balance ${fmt(bal(c))}`);});
P(`  LOANS master: ${LOANS.length} loans, principal outstanding per master = ${fmt(LOANS.reduce((s,l)=>s+l.current_principal,0))}`);
P(`  GL construction+mortgage loan payable (270100+270200+260100+260200) = ${fmt(-(bal('270100')+bal('270200')+bal('260100')+bal('260200')))} credit`);
P(`  => GL vs loan master difference = ${fmt(LOANS.reduce((s,l)=>s+l.current_principal,0) - (-(bal('270100')+bal('270200'))))}`);
// draw discipline
P('\n  -- Loan draw discipline (Dr Cash / Cr Loan Payable per engine.js R-LOAN-01) --');
lines('270100').forEach(({j,l})=>{
  if(crOf(l)>0){
    const others=j.lines.filter(x=>x!==l).map(x=>`${x.account_code} dr${x.debit_amount||0}`).join(' + ');
    P(`    ${j.je_number} e${j.entity_id} rule=${j.rule_code||'-'} Cr 270100 ${fmt(crOf(l))} <= Dr ${others}`);
  }
});
P('\n  -- Interest: capitalised (164500) vs expensed (795000) --');
P(`    164500 CWIP-Capitalized interest: lines=${lines('164500').length} balance ${fmt(bal('164500'))}`);
P(`    795000 Interest Expense:          lines=${lines('795000').length} balance ${fmt(bal('795000'))}`);
P(`    220410 Interest Payable:          lines=${lines('220410').length} balance ${fmt(-bal('220410'))} credit`);
P(`    661000 Mortgage Interest:         lines=${lines('661000').length}`);
const inServiceLoans=LOANS.filter(l=>{const p=l.project_id;return p===2;});
P(`    Loans on IN_SERVICE projects (interest must be EXPENSED): ${inServiceLoans.map(l=>l.loan_code).join(',')} principal ${fmt(inServiceLoans.reduce((s,l)=>s+l.current_principal,0))} @ ${inServiceLoans.map(l=>(l.interest_rate*100).toFixed(2)+'%')}`);
P(`    7 months of interest that SHOULD be accrued on the 2 master loans = ${fmt(LOANS.reduce((s,l)=>s+l.current_principal*l.interest_rate*7/12,0))}; actually accrued = ${fmt(bal('164500')+bal('795000'))}`);

P('\n== C. CWIP / INVENTORY / COGS ==');
['161000','163000','164100','164200','164400','164500','165100','162000'].forEach(c=>{const n=lines(c).length; if(n)P(`  ${c}: lines=${n} balance ${fmt(bal(c))}`);});
P(`  510000 COGS: lines=${lines('510000').length} balance ${fmt(bal('510000'))}`);
P(`  491800 Sales of Product Income: lines=${lines('491800').length} balance ${fmt(-bal('491800'))} credit`);
P(`  Gross margin on closings = ${fmt(-bal('491800')-bal('510000'))} (${(100*(-bal('491800')-bal('510000'))/-bal('491800')).toFixed(1)}%)`);
P('  -- CWIP to Inventory transfer (164xxx -> 163000/165100) --');
let xfer=0; POSTED.forEach(j=>{const codes=j.lines.map(l=>l.account_code); if(codes.some(c=>c.startsWith('164'))&&codes.some(c=>c==='163000'||c==='165100'||c==='161000')) xfer++;});
P(`    JEs moving CWIP into finished inventory: ${xfer}`);
P('  -- Unit-level COGS cap: does relief on a unit exceed cost accumulated on that unit? --');
const unitCost={}, unitRelief={};
POSTED.forEach(j=>j.lines.forEach(l=>{
  const u=l.unit_code; if(!u) return; const k=`${j.entity_id}|${u}`;
  if(l.account_code==='164400'&&drOf(l)>0) unitCost[k]=(unitCost[k]||0)+drOf(l);
  if(l.account_code==='164400'&&crOf(l)>0) unitRelief[k]=(unitRelief[k]||0)+crOf(l);
}));
const breaches=Object.keys(unitRelief).filter(k=>(unitRelief[k]||0)>(unitCost[k]||0)+0.005)
  .map(k=>({k,cost:unitCost[k]||0,relief:unitRelief[k],over:unitRelief[k]-(unitCost[k]||0)}))
  .sort((a,b)=>b.over-a.over);
P(`    units with cost relief EXCEEDING accumulated unit cost: ${breaches.length} of ${Object.keys(unitRelief).length} relieved units`);
P(`    total over-relief: ${fmt(breaches.reduce((s,b)=>s+b.over,0))}`);
breaches.slice(0,8).forEach(b=>P(`      ${b.k}: cost ${fmt(b.cost)} relieved ${fmt(b.relief)} OVER by ${fmt(b.over)}`));
// units sold with zero cost at all
const zeroCost=Object.keys(unitRelief).filter(k=>!unitCost[k]);
P(`    units relieved that carry NO accumulated cost at all: ${zeroCost.length} e.g. ${zeroCost.slice(0,4).join(' ; ')}`);
// residual CWIP by entity vs unit detail
P(`    164400 residual balance ${fmt(bal('164400'))} over ${new Set(Object.keys(unitCost).map(k=>k.split('|')[0])).size} entities`);

P('\n== D. SECURITY DEPOSITS ==');
P(`  225000 Security Deposit liability: lines=${lines('225000').length} balance ${fmt(-bal('225000'))}`);
P(`  225001/117001/227200 lines: ${['225001','117001','227200'].map(c=>c+'='+lines(c).length).join(' ')}`);
P(`  PM feed contains a SEC_DEPOSIT row: ${PM_ROWS.filter(r=>r.charge_code==='SEC_DEPOSIT').map(r=>`${r.external_id} ${fmt(r.amount)}`).join(', ')} -> mapping says ${MAPPINGS.find(m=>m.source_code==='SEC_DEPOSIT')?.owner_gl_account_code} (${MAPPINGS.find(m=>m.source_code==='SEC_DEPOSIT')?.rev_exp_flag})`);
P('  => rule is correct in code, but NO deposit has ever been posted; the control is untested by data.');

P('\n== E. INTERCOMPANY ==');
const icAll=['125000','291000','291001','291002','291003','291004','291005','291006','291007','291031','158001'];
icAll.forEach(c=>{const n=lines(c).length; if(n)P(`  ${c}: lines=${n} net(dr-cr) ${fmt(bal(c))}`);});
const icNet=icAll.reduce((s,c)=>s+bal(c),0);
P(`  CONSOLIDATED intercompany net (should be 0.00): ${fmt(icNet)}`);
P('  -- mirror test: for each (entity, counterparty) pair, does the opposite side exist? --');
const pair={};
POSTED.forEach(j=>j.lines.forEach(l=>{
  if(!['291000','291001','125000'].includes(l.account_code)) return;
  const m=memberOf(l)||'(none)';
  const k=`${ENT[j.entity_id].entity_name} -> ${m}`;
  pair[k]=(pair[k]||0)+Math.round(drOf(l)*100)-Math.round(crOf(l)*100);
}));
const named=new Set(ENTITIES.map(e=>e.entity_name));
const internal=Object.entries(pair).filter(([k])=>named.has(k.split(' -> ')[1]));
P(`    distinct (entity -> counterparty) IC relationships: ${Object.keys(pair).length}`);
P(`    ...where the counterparty is itself a REFS entity (i.e. eliminable): ${internal.length}`);
let mirrored=0, unmirrored=[];
internal.forEach(([k,v])=>{
  const [a,b]=k.split(' -> ');
  const rev=pair[`${b} -> ${a}`];
  if(rev!==undefined && rev===-v) mirrored++;
  else unmirrored.push(`${k}: ${fmt(v/100)} | reverse side ${rev===undefined?'DOES NOT EXIST':fmt(rev/100)}`);
});
P(`    exactly mirrored pairs: ${mirrored}`);
P(`    unmirrored / one-sided pairs: ${unmirrored.length}`);
unmirrored.slice(0,10).forEach(x=>P('      '+x));
const wbdeDue = POSTED.filter(j=>j.entity_id===3).reduce((s,j)=>s+j.lines.filter(l=>['291000','291001','125000'].includes(l.account_code)).reduce((t,l)=>t+Math.round(drOf(l)*100)-Math.round(crOf(l)*100),0),0)/100;
P(`    Wan Bridge Development LLC (e3) own IC balance: ${fmt(wbdeDue)} — but it is named as counterparty on ${Object.entries(pair).filter(([k])=>k.endsWith('Wan Bridge Development LLC')).reduce((s,[,v])=>s+v,0)/100 && fmt(Object.entries(pair).filter(([k])=>k.endsWith('-> Wan Bridge Development LLC')).reduce((s,[,v])=>s+v,0)/100)} of other entities' balances`);

P('\n== F. SUSPENSE / CLEARING ==');
['142000','115000','221010','227100','123300','124000','666600'].forEach(c=>P(`  ${c}: lines=${lines(c).length} balance ${fmt(bal(c))}`));
P('  -- 291001 "Due to/from" used as the AP settlement clearing account (settings.js:payable_setting Credit -> 291001) --');
const byMember291={};
lines('291001').forEach(({j,l})=>{const m=memberOf(l)||'(none)'; byMember291[m]=(byMember291[m]||0)+Math.round(crOf(l)*100)-Math.round(drOf(l)*100);});
const aged=Object.entries(byMember291).filter(([,v])=>v!==0).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
P(`    291001 members with a NON-ZERO residual (never cleared): ${aged.length} of ${Object.keys(byMember291).length}`);
aged.slice(0,12).forEach(([m,v])=>P(`      ${m.padEnd(38)} ${fmt(v/100)}`));
P(`    291001 total uncleared residual: ${fmt(aged.reduce((s,[,v])=>s+v,0)/100)}`);

P('\n== G. ACCRUALS / DEPRECIATION / PREPAID / TAX ==');
const grp = (label,codes)=>{const n=codes.reduce((s,c)=>s+lines(c).length,0); const b=codes.reduce((s,c)=>s+bal(c),0); P(`  ${label.padEnd(42)} lines=${String(n).padStart(4)} balance ${fmt(b)}`);};
grp('Depreciation expense (785000-787003,789000)',['785000','785500','786000','787000','787003','789000']);
grp('Accumulated depreciation (168001-168006)',['168001','168002','168003','168004','168005','168006']);
grp('Fixed assets (165000,165500-165902)',['165000','165500','165600','165700','165800','165900','165901','165902']);
grp('Prepaid (140100-140600,142600,142800)',['140100','140101','140200','140300','140400','140500','140600','142600','142800']);
grp('Property tax expense/accrual (635000,220400)',['635000','220400']);
grp('Insurance expense/accrual (632000,220450)',['632000','632001','632011','220450']);
grp('Interest accrual (220410,220451)',['220410','220451']);
grp('Income/franchise tax (688100,701200,220204)',['688100','701200','220204']);
grp('Escrow / restricted cash (112000-112007,113000)',['112000','112001','112002','112003','112004','112005','112006','112007','113000']);
grp('Loan closing costs & amortisation (161201,161202,164700,164800,270800,270900)',['161201','161202','164700','164800','270800','270900']);
grp('Rental income (420500,421802,421803)',['420500','421802','421803']);
grp('AP Retention (220100)',['220100']);
grp('Allowance for doubtful accounts (121001,125003)',['121001','125003']);

P('\n== H. CONSTRUCTION INVOICE DIMENSIONS ==');
const cw = lines('164400').filter(x=>drOf(x.l)>0);
let withUnit=0, withProj=0, withCC=0, withVendor=0, withDoc=0;
cw.forEach(({j,l})=>{ if(l.unit_code)withUnit++; if(l.project_id)withProj++; if(l.cost_code||j.cost_code)withCC++; if(j.payee)withVendor++; if(j.source_doc_id)withDoc++; });
P(`  164400 debit lines (construction cost): ${cw.length}`);
P(`    carrying unit/WBS code:   ${withUnit} (${(100*withUnit/cw.length).toFixed(0)}%)`);
P(`    carrying project_id:      ${withProj} (${(100*withProj/cw.length).toFixed(0)}%)`);
P(`    carrying a cost code:     ${withCC} (${(100*withCC/cw.length).toFixed(0)}%)  [cost code lives on the SOURCE DOC, not the JE line]`);
P(`    carrying a vendor/payee:  ${withVendor} (${(100*withVendor/cw.length).toFixed(0)}%)`);
P(`    carrying a source_doc_id: ${withDoc} (${(100*withDoc/cw.length).toFixed(0)}%)`);
const anyLineCostCode = POSTED.reduce((s,j)=>s+j.lines.filter(l=>l.cost_code).length,0);
const anyLineProject = POSTED.reduce((s,j)=>s+j.lines.filter(l=>l.project_id).length,0);
P(`  across the WHOLE ledger: JE lines carrying line-level cost_code = ${anyLineCostCode}; project_id = ${anyLineProject}; unit_code = ${POSTED.reduce((s,j)=>s+j.lines.filter(l=>l.unit_code).length,0)}`);
P(`  164100 (land dev) debit lines carrying a unit/project dim: ${lines('164100').filter(x=>drOf(x.l)>0&&(x.l.unit_code||x.l.project_id)).length} of ${lines('164100').filter(x=>drOf(x.l)>0).length}`);

P('\n== I. SOURCE DOCUMENT PROVENANCE ==');
const docTypes={}; Object.values(SOURCE_DOCS).forEach(d=>docTypes[d.type]=(docTypes[d.type]||0)+1);
P(`  source documents generated: ${Object.keys(SOURCE_DOCS).length} -> ${JSON.stringify(docTypes)}`);
P(`  ...of which are DEMO_SOURCE_SNAPSHOT (fabricated at load time, no real document): ${docTypes['DEMO_SOURCE_SNAPSHOT']||0}`);
const demoRule = POSTED.filter(j=>String(j.rule_code||'').startsWith('R-DEMO-')).length;
const stdRule = POSTED.filter(j=>j.rule_code==='R-AP-STD-01').length;
P(`  posted JEs whose rule_code is a fabricated R-DEMO-*: ${demoRule}`);
P(`  posted JEs whose source doc was fabricated as SERVICE_INVOICE/R-AP-STD-01: ${stdRule}`);
P(`  posted JEs with NO setting_used / mapping_used / idempotency_key (server kernel would reject as JE_AUTO_TRACE_MISSING): ${POSTED.filter(j=>j.je_type==='AUTO'&&(!j.setting_used||!j.mapping_used||!j.idempotency_key)).length}`);

P('\n== J. BANK / RECONCILIATION DATA ==');
P(`  BANK_ACCOUNTS master rows: ${BANK_ACCOUNTS.length} (entities ${[...new Set(BANK_ACCOUNTS.map(b=>b.entity_id))].join(',')}) for ${ENTITIES.length} entities`);
P(`  BANK_TXNS (statement lines) available: ${BANK_TXNS.length}; matched ${BANK_TXNS.filter(b=>b.match_status==='MATCHED').length}`);
P(`  GL cash (111000) lines needing reconciliation: ${lines('111000').length}`);
P(`  distinct bank "members" on 111000: ${new Set(lines('111000').map(x=>memberOf(x.l))).size}`);
P(`  => statement coverage = ${BANK_TXNS.length}/${lines('111000').length} = ${(100*BANK_TXNS.length/lines('111000').length).toFixed(2)}% of cash lines`);
P(`  IC_TXNS master rows: ${IC_TXNS.length}; LOAN_TXNS: ${LOAN_TXNS.length}`);
console.log(out.join('\n'));
