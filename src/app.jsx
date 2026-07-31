import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast, Btn } from './ui.jsx';
import { ENTITIES, USERS, PERIODS, COA, VENDORS, CUSTOMERS } from './data.js';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, BANK_TXNS, nextId, bumpId } from './seed.js';
import { jeTotals } from './engine.js';
import { Dashboard, JEWorkspace, LoanWorkspace, PMPickup, ClosingWorkspace, ExceptionCenter, CloseMgmt } from './modules-core.jsx';
import { GLTrialBalance, Reports, ARModule, CashModule, LoanRegister, ProjectCost, Assets, Intercompany, IntegrationHub, MasterData, MappingCenter, RuleCenter, AdminModule } from './modules-more.jsx';
import { APWorkspace } from './module-ap.jsx';
import { BankRec2 } from './module-bankrec.jsx';
import { COAWorkspace } from './module-coa.jsx';
import { AutoBankRec, CheckMgmt } from './module-wbs.jsx';
import { BankTransactions } from './module-banktx.jsx';
import { AccountRegister } from './module-register.jsx';
import { ARWorkspace } from './module-ar.jsx';
import { repo } from './repo.js';

const ROLE_PERMS = {
  CONTROLLER: '*',
  ACCT_MANAGER: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.APPROVE','GL.COA.CREATE','AP.INVOICE.CREATE','AP.INVOICE.APPROVE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF','PERIOD.PERIOD.CLOSE','CASH.RECON.SIGNOFF'],
  SENIOR_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.POST','AP.INVOICE.CREATE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF','CASH.RECON.SIGNOFF'],
  STAFF_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW','AP.INVOICE.CREATE'],
  PROJECT_ACCT: ['GL.JE.CREATE','AP.INVOICE.CREATE','PERIOD.CLOSE.SIGNOFF'],
  PROPERTY_ACCT: ['GL.JE.CREATE','AP.INVOICE.CREATE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF'],
  TREASURY: ['GL.JE.CREATE','AP.PAYMENT.CREATE','CASH.RECON.SIGNOFF'],
  AP: ['AP.INVOICE.CREATE'], AR: ['GL.JE.CREATE'],
  REVIEWER: ['GL.JE.REVIEW','GL.JE.APPROVE','AP.INVOICE.APPROVE'],
  AUDITOR: [], READ_ONLY: [], SYS_ADMIN: [],
};
const NAV = [
  {group:'Home', icon:'⌂', items:[['dashboard','Dashboard'],['approvals','Approvals']]},
  {group:'Transactions', icon:'⇄', items:[['banktx','Bank Transactions'],['je','Journal Entries'],['checks','Checks & Payments'],['autobankrec','Auto Reconciliation']]},
  {group:'Sales & Receivables', icon:'⬓', items:[['ar','Customers & Invoices']]},
  {group:'Expenses & Payables', icon:'⬒', items:[['ap','Vendors & Bills']]},
  {group:'Projects & Properties', icon:'▦', items:[['masterdata','Projects & Properties'],['cost','Project Cost']]},
  {group:'Construction Finance', icon:'▲', items:[['loan','Construction Loans'],['loanreg','Loan Register']]},
  {group:'Property Operations', icon:'⌂', items:[['pmpickup','PM Pickup'],['mapping','Charge Code Mapping']]},
  {group:'Closings', icon:'⚖', items:[['closing','Closing Workspace']]},
  {group:'Accounting', icon:'☰', items:[['coa','Chart of Accounts'],['register','Account Register'],['gl','General Ledger'],['bankrec','Reconciliation'],['assets','Fixed Assets'],['intercompany','Intercompany'],['close','Period Close']]},
  {group:'Reports', icon:'▤', items:[['reports','Reports Center']]},
  {group:'Controls', icon:'⚠', items:[['exceptions','Exception Center'],['audit','Audit Log']]},
  {group:'System', icon:'⚙', adminOnly:true, items:[['integration','Integration Hub'],['rules','Accounting Rules'],['cash','Cash Accounts'],['admin','Users & Settings']]},
];
const COMP = { dashboard:Dashboard, je:JEWorkspace, banktx:BankTransactions, register:AccountRegister, audit:AuditLog, approvals:Approvals, gl:GLTrialBalance, coa:COAWorkspace, loan:LoanWorkspace, loanreg:LoanRegister,
  pmpickup:PMPickup, closing:ClosingWorkspace, cost:ProjectCost, assets:Assets, ap:APWorkspace, ar:ARWorkspace,
  cash:CashModule, bankrec:BankRec2, autobankrec:AutoBankRec, checks:CheckMgmt, intercompany:Intercompany, integration:IntegrationHub, masterdata:MasterData,
  mapping:MappingCenter, rules:RuleCenter, exceptions:ExceptionCenter, close:CloseMgmt, reports:Reports, admin:AdminModule };
const ADMIN_ROLES = ['CONTROLLER','SYS_ADMIN','AUDITOR'];

// ---- seed AP bills & bank rec model ----
const SEED_BILLS = [
  {bill_id:9001, bill_no:'BILL-2026-9001', vendor_id:2, vendor_name:'BluePeak Utilities', invoice_no:'INV-77821', bill_date:'2026-07-10', due_date:'2026-08-09', account_code:'6020', amount:3200, status:'PAID', created_by:'sam', approved_by:'ricky', je_number:'JE-2026-07-1005', pay_je_number:'JE-PAY-9001'},
  {bill_id:9002, bill_no:'BILL-2026-9002', vendor_id:1, vendor_name:'Summit General Contractors', invoice_no:'APP-014', bill_date:'2026-07-25', due_date:'2026-08-24', account_code:'1400', amount:185000, status:'APPROVED', created_by:'pat', approved_by:'ricky', je_number:'JE-2026-07-9002'},
  {bill_id:9003, bill_no:'BILL-2026-9003', vendor_id:3, vendor_name:'WanBridge Property Mgmt (RP)', invoice_no:'PMF-2026-07', bill_date:'2026-07-31', due_date:'2026-08-15', account_code:'6000', amount:2400, status:'PENDING_APPROVAL', created_by:'sam'},
];
const SEED_BANK = {
  accounts: {
    'BA-003': { bank_name:'Pacific Bank', period:'2026-07', stmt_date:'2026-07-31',
      stmt_begin:118400, stmt_end:162565, gl_book_balance:163650, recorded_adj:0,
      outstanding_checks:[{ref:'CHK-1088',amount:2400}], deposits_in_transit:[{ref:'DEP-0731',amount:2400}],
      txns:[
        {bank_txn_id:1, external_id:'BANKTXN-Z-4460', txn_date:'2026-07-06', amount:46000, direction:'CREDIT', reference:'ACH RENT P0020', match_status:'MATCHED', matched_je:'JE-2026-07-1004'},
        {bank_txn_id:2, external_id:'BANKTXN-Z-4471', txn_date:'2026-07-30', amount:1250, direction:'CREDIT', reference:'ACH UNKNOWN TENANT', match_status:'UNMATCHED', suggest:'MATCH'},
        {bank_txn_id:5, external_id:'BANKTXN-Z-4480', txn_date:'2026-07-31', amount:85, direction:'DEBIT', reference:'MONTHLY SERVICE FEE', match_status:'UNMATCHED', suggest:'FEE'},
        {bank_txn_id:6, external_id:'BANKTXN-Z-4481', txn_date:'2026-07-31', amount:250, direction:'CREDIT', reference:'INTEREST INCOME', match_status:'UNMATCHED', suggest:'INTEREST'},
      ]},
    'BA-001': { bank_name:'First National Bank', period:'2026-07', stmt_date:'2026-07-31',
      stmt_begin:410000, stmt_end:910000, gl_book_balance:910000, recorded_adj:0,
      outstanding_checks:[], deposits_in_transit:[],
      txns:[
        {bank_txn_id:3, external_id:'BANKTXN-A-1002', txn_date:'2026-07-05', amount:500000, direction:'CREDIT', reference:'LOAN DRAW FNB', match_status:'MATCHED', matched_je:'JE-2026-07-1001'},
      ]},
  }, history: [],
};

function Login({onLogin}) {
  const [u, setU] = useState('ricky');
  return <div className="login-wrap">
    <div className="login-card">
      <div className="login-logo">◈ REFS</div>
      <div className="login-sub">WanBridge Real Estate Financial System</div>
      <label className="login-label">登录账号（演示环境 · 角色由账号决定）</label>
      <select value={u} onChange={e=>setU(e.target.value)}>
        {USERS.map(x=><option key={x.user_id} value={x.user_id}>{x.name} · {x.role_code}</option>)}
      </select>
      <button className="btn btn-primary login-btn" onClick={()=>onLogin(u)}>登录 Sign in</button>
      <div className="login-note">生产环境将接入 SSO/OIDC。角色与权限来自登录身份，页面内不可切换。</div>
    </div>
  </div>;
}

function App() {
  const load=(k,d)=>{try{const v=localStorage.getItem('refs_'+k);return v?JSON.parse(v):d;}catch(e){return d;}};
  const [userId, setUserId] = useState(()=>load('user',null));
  const [route, setRoute] = useState('dashboard');
  const [jes, setJes] = useState(()=>load('jes',JOURNAL_ENTRIES));
  const [exceptions, setExceptions] = useState(()=>load('exc',EXCEPTIONS));
  const [closeTasks, setCloseTasks] = useState(()=>load('close',CLOSE_TASKS));
  const [ap, setAp] = useState(()=>load('ap',{bills:SEED_BILLS, dupBlocked:0}));
  const [bank, setBank] = useState(()=>load('bank',SEED_BANK));
  const [coa, setCoa] = useState(()=>load('coa',COA.map(a=>({...a}))));
  const [ar, setAr] = useState(()=>load('ar',{invoices:[
    {inv_id:8001, inv_no:'INV-2026-8001', customer_id:1, customer_name:'Tenant - Unit A-203', inv_date:'2026-07-01', due_date:'2026-07-15', amount:2000, status:'OPEN', je_number:'20260701000009'},
    {inv_id:8002, inv_no:'INV-2026-8002', customer_id:2, customer_name:'WanBridge OpCo (Owner)', inv_date:'2026-07-10', due_date:'2026-08-10', amount:12500, status:'PAID', je_number:'20260710000012', pay_je_number:'20260728000031'},
  ]}));
  const [entity, setEntity] = useState(0);
  const [dark, setDark] = useState(false);
  const [toast, setToastS] = useState(null);
  const [palette, setPalette] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [openGroups, setOpenGroups] = useState({Home:true, Transactions:true});
  const [q, setQ] = useState('');

  const user = USERS.find(u=>u.user_id===userId);
  const period = PERIODS.find(p=>p.entity_id===(entity||2) && p.period_code==='2026-07') || {period_code:'2026-07', status:'OPEN'};
  const showToast = (msg,tone='ok') => { setToastS({msg,tone}); setTimeout(()=>setToastS(null),3000); };
  const can = (perm) => { if(!user) return false; const p = ROLE_PERMS[user.role_code]; return p==='*' || (p||[]).includes(perm); };

  useEffect(()=>{ document.body.className = dark?'dark':''; },[dark]);
  const persist=(k,v)=>{try{localStorage.setItem('refs_'+k,JSON.stringify(v))}catch(e){}};
  useEffect(()=>{persist('jes',jes)},[jes]); useEffect(()=>{persist('exc',exceptions)},[exceptions]);
  useEffect(()=>{persist('close',closeTasks)},[closeTasks]); useEffect(()=>{persist('ap',ap)},[ap]);
  useEffect(()=>{persist('bank',bank)},[bank]); useEffect(()=>{persist('coa',coa)},[coa]); useEffect(()=>{persist('ar',ar)},[ar]);
  useEffect(()=>{ if(userId) persist('user',userId); },[userId]);
  useEffect(()=>{ bumpId(Math.max(9000,...jes.map(j=>+j.je_id||0),...ap.bills.map(b=>+b.bill_id||0))); },[]);
  useEffect(()=>{
    const h = (e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); setPalette(p=>!p);} if(e.key==='Escape') setPalette(false); };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[]);

  const audit = (action, objectType, objectRef, detail) => repo.audit(userId, action, objectType, objectRef, detail);
  const mkJE = (spec) => { const id = nextId(); return {je_id:id, je_number:'20260731'+String(id).padStart(6,'0'), period_code:'2026-07', posting_status:'DRAFT', je_date:'2026-07-31', created_by:userId, history:[{a:'CREATE',by:userId,at:'2026-07-31'}], ...spec}; };
  const actions = {
    newJE: () => { const je = mkJE({entity_id:entity||2, je_type:'MANUAL', description:'', source_system:'MAN', has_attachment:false,
      lines:[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}]}); setJes(js=>[je,...js]); return je.je_id; },
    newJEFromRule: (spec) => { const je = mkJE({...spec}); setJes(js=>[je,...js]); return je.je_id; },
    copyJE: (id) => { const src = jes.find(j=>j.je_id===id); const je = mkJE({...structuredClone(src), posting_status:'DRAFT', description:'COPY: '+src.description}); je.history=[{a:'COPY of '+src.je_number,by:userId,at:'2026-07-31'}]; setJes(js=>[je,...js]); return je.je_id; },
    updateJE: (id, producer) => setJes(js=>js.map(j=>{ if(j.je_id!==id) return j; const d=structuredClone(j); producer(d); return d; })),
    advanceJE: (id, next, label) => { audit(label||next,'JE','#'+id,''); return setJes(js=>js.map(j=>{
      if(j.je_id!==id) return j;
      if((next==='APPROVED'||next==='POSTED') && j.created_by===userId && user.role_code!=='CONTROLLER'){
        showToast('SoD 拦截 [4009]：创建人不可审批/过账本分录','bad'); return j; }
      return {...j, posting_status:next, history:[...(j.history||[]),{a:label||next,by:userId,at:'2026-07-31'}]};
    })); },
    reverseJE: (id) => setJes(js=>{ const src = js.find(j=>j.je_id===id); const nid=nextId();
      const rev = {...structuredClone(src), je_id:nid, je_number:'JE-REV-'+nid, posting_status:'POSTED', je_type:'REVERSAL',
        description:'红字反冲: '+src.description, history:[{a:'REVERSAL of '+src.je_number,by:userId,at:'2026-07-31'}],
        lines:src.lines.map(l=>({...l, debit_amount:l.credit_amount, credit_amount:l.debit_amount}))};
      return js.map(j=>j.je_id===id?{...j, posting_status:'REVERSED'}:j).concat(rev); }),
    ensureException: (spec) => setExceptions(xs=>{ if(xs.some(e=>e.exception_type===spec.exception_type && e.object_ref===spec.object_ref && e.status!=='CLOSED')) return xs;
      return [{exception_id:nextId(), occurred_date:'2026-07-31', aging_days:0, status:'OPEN', resolution:'', ...spec}, ...xs]; }),
    resolveException: (id, resolution) => setExceptions(xs=>xs.map(e=>e.exception_id===id?{...e, status:'CLOSED', resolution, closed_by:userId}:e)),
    signoffTask: (id) => setCloseTasks(ts=>ts.map(t=>t.close_task_id===id?{...t, status:'SIGNED_OFF', signed_off_by:userId}:t)),
    // ---- AP ----
    addBill: (f) => { const dup = ap.bills.find(b=>b.vendor_id===f.vendor_id && b.invoice_no.trim().toLowerCase()===f.invoice_no.trim().toLowerCase());
      if (dup){ setAp(s=>({...s, dupBlocked:(s.dupBlocked||0)+1})); return {dup:dup.bill_no}; }
      const id=nextId(); const v=VENDORS.find(x=>x.vendor_id===f.vendor_id);
      setAp(s=>({...s, bills:[{bill_id:id, bill_no:'BILL-2026-'+id, vendor_name:v.vendor_name, status:'PENDING_APPROVAL', created_by:userId, ...f}, ...s.bills]})); return {ok:true}; },
    approveBill: (id) => { const b = ap.bills.find(x=>x.bill_id===id);
      const je = mkJE({entity_id:entity||4, je_type:'AUTO', source_system:'AP', description:`AP Bill ${b.bill_no} · ${b.vendor_name}`, posting_status:'POSTED',
        lines:[{account_code:b.account_code, debit_amount:b.amount, credit_amount:0, vendor_id:b.vendor_id, property_id:b.property_id},
               {account_code:'2000', debit_amount:0, credit_amount:b.amount, vendor_id:b.vendor_id}]});
      setJes(js=>[je,...js]);
      setAp(s=>({...s, bills:s.bills.map(x=>x.bill_id===id?{...x, status:'APPROVED', approved_by:userId, je_number:je.je_number}:x)})); },
    payBills: (ids) => { ids.forEach(id=>{ const b = ap.bills.find(x=>x.bill_id===id);
        const je = mkJE({entity_id:entity||4, je_type:'AUTO', source_system:'AP', description:`Payment ${b.bill_no} · ${b.vendor_name}`, posting_status:'POSTED',
          lines:[{account_code:'2000', debit_amount:b.amount, credit_amount:0, vendor_id:b.vendor_id},
                 {account_code:'1000', debit_amount:0, credit_amount:b.amount}]});
        setJes(js=>[je,...js]);
        setAp(s=>({...s, bills:s.bills.map(x=>x.bill_id===id?{...x, status:'PAID', pay_je_number:je.je_number}:x)})); }); },
    addInvoice: (f) => { const id=nextId(); const c=CUSTOMERS.find(x=>x.customer_id===f.customer_id);
      const je = mkJE({entity_id:entity||4, je_type:'AUTO', source_system:'AR', posting_status:'POSTED', description:`Invoice INV-2026-${id} · ${c.customer_name}`,
        lines:[{account_code:'1200',debit_amount:f.amount,credit_amount:0},{account_code:'4000',debit_amount:0,credit_amount:f.amount}]});
      setJes(js=>[je,...js]); audit('CREATE','INVOICE','INV-2026-'+id, '$'+f.amount);
      setAr(s=>({...s, invoices:[{inv_id:id, inv_no:'INV-2026-'+id, customer_name:c.customer_name, status:'OPEN', je_number:je.je_number, ...f}, ...s.invoices]})); },
    receivePayment: (id) => { const inv=ar.invoices.find(i=>i.inv_id===id);
      const je = mkJE({entity_id:entity||4, je_type:'AUTO', source_system:'AR', posting_status:'POSTED', description:`Payment received ${inv.inv_no}`,
        lines:[{account_code:'1000',debit_amount:inv.amount,credit_amount:0},{account_code:'1200',debit_amount:0,credit_amount:inv.amount}]});
      setJes(js=>[je,...js]); audit('PAYMENT','INVOICE',inv.inv_no,'$'+inv.amount);
      setAr(s=>({...s, invoices:s.invoices.map(i=>i.inv_id===id?{...i,status:'PAID',pay_je_number:je.je_number}:i)})); },
    bankExclude: (acctCode, txnId) => { audit('EXCLUDE','BANK_TXN','#'+txnId,''); setBank(s=>{const a=structuredClone(s); const t=a.accounts[acctCode].txns.find(x=>x.bank_txn_id===txnId); t.ui_status='Excluded'; return a;}); },
    bankUndo: (acctCode, txnId) => setBank(s=>{const a=structuredClone(s); const acc=a.accounts[acctCode]; const t=acc.txns.find(x=>x.bank_txn_id===txnId);
      if(t.match_status==='MATCHED'){ const adj=t.direction==='CREDIT'?t.amount:-t.amount; acc.recorded_adj=(acc.recorded_adj||0)-adj; }
      t.ui_status=null; t.match_status='UNMATCHED'; t.matched_je=null; return a;}),
    // ---- Bank ----
    bankRecord: (acctCode, txnId) => setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
      const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED';
      const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj;
      t.matched_je = t.suggest==='FEE'?'Dr Bank Fee / Cr Cash':'Dr Cash / Cr Interest Income'; return a; }),
    bankMatch: (acctCode, txnId) => setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
      const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='手工匹配';
      const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; }),
    bankSuspense: (acctCode, txnId) => { setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
        const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='→ 9000 Suspense';
        const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; });
      actions.ensureException({exception_type:'SUSPENSE_BALANCE', severity:'MEDIUM', object_type:'BANK_TXN', object_ref:'txn#'+txnId, entity_id:entity||4, owner:'TREASURY', root_cause:'银行交易无法识别，暂挂 Suspense'}); },
    bankSignoff: (acctCode) => setBank(s=>({...s, history:[{id:Date.now(), account:acctCode, period:s.accounts[acctCode].period, diff:0, by:userId, at:'2026-07-31'}, ...s.history]})),
    // ---- COA ----
    addAccount: (f) => { if (coa.some(a=>a.account_code===f.account_code)) return {dup:true};
      setCoa(cs=>[...cs, f].sort((a,b)=>a.account_code.localeCompare(b.account_code))); return {ok:true}; },
    toggleAccount: (code) => setCoa(cs=>cs.map(a=>a.account_code===code?{...a, inactive:!a.inactive}:a)),
    resetData: () => { try{['jes','exc','close','ap','bank','coa','user'].forEach(k=>localStorage.removeItem('refs_'+k))}catch(e){} location.reload(); },
    logout: () => { try{localStorage.removeItem('refs_user')}catch(e){} setUserId(null); },
  };

  if (!user) return <Login onLogin={setUserId} />;

  const isAdmin = ADMIN_ROLES.includes(user.role_code);
  const nav = NAV.filter(g=>!g.adminOnly || isAdmin);
  const flat = nav.flatMap(g=>g.items.map(([k,l])=>[k,'·',l]));
  const ctx = {jes, exceptions, closeTasks, ap, bank, coa, user, entity, period, can, actions, toast:showToast, goto:setRoute};
  const Comp = COMP[route] || Dashboard;
  const paletteItems = flat.filter(([k,ic,l])=>l.toLowerCase().includes(q.toLowerCase())||k.includes(q.toLowerCase()));

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="logo">◈</span> REFS<span className="brand-sub">WanBridge</span></div>
      <button className="new-btn" onClick={()=>setNewMenu(true)}>＋ New 新建</button>
      <nav>{nav.map(g=>{ const opened = openGroups[g.group] ?? g.items.some(([k])=>route===k);
        return <div key={g.group} className="nav-group">
        <button className="nav-group-h" onClick={()=>setOpenGroups(o=>({...o,[g.group]:!opened}))}>
          <span className="nav-ic">{g.icon}</span>{g.group}<span className="nav-caret">{opened?'▾':'▸'}</span></button>
        {opened && g.items.map(([k,l])=><button key={k} className={`nav-item nav-sub ${route===k?'nav-on':''}`} onClick={()=>setRoute(k)}>{l}</button>)}
      </div>;})}</nav>
    </aside>
    <div className="main">
      <header className="topbar">
        <label className="sw"><select value={entity} onChange={e=>setEntity(+e.target.value)}><option value={0}>全部实体 All Entities</option>{ENTITIES.map(en=><option key={en.entity_id} value={en.entity_id}>{en.entity_code} {en.entity_name}</option>)}</select></label>
        <button className="cmdk" onClick={()=>setPalette(true)}>⌘K 全局搜索 / 跳转</button>
        <div className="top-right">
          <span className="sw">期间 <b>2026-07</b> <span className={`badge badge-${period.status==='OPEN'?'ok':'muted'}`}>{period.status}</span></span>
          <button className="icon-btn" title="帮助" onClick={()=>showToast('帮助中心(原型)')}>?</button>
          <button className="icon-btn" title="通知" onClick={()=>setRoute('exceptions')}>🔔</button>
          <button className="icon-btn" onClick={()=>actions.resetData()} title="重置演示数据">⟲</button>
          <button className="icon-btn" onClick={()=>setDark(d=>!d)} title="明/暗">{dark?'☀':'☾'}</button>
          <div className="user-chip" title={'角色 '+user.role_code}>
            <span className="user-av">{user.name[0]}</span>
            <span className="user-nm">{user.name}<span className="muted sm"> · {user.role_code}</span></span>
            <button className="link-btn" onClick={actions.logout}>退出</button>
          </div>
        </div>
      </header>
      <main className="content"><Comp ctx={ctx} /></main>
    </div>
    {newMenu && <div className="newmenu-scrim" onClick={()=>setNewMenu(false)}>
      <div className="newmenu" onClick={e=>e.stopPropagation()}>
        <div><h5>总账 Accounting</h5>
          <button onClick={()=>{actions.newJE(); setRoute('je'); setNewMenu(false);}}>Journal Entry 手工分录</button>
          <button onClick={()=>{setRoute('coa'); setNewMenu(false);}}>Account 科目</button>
          <button onClick={()=>{setRoute('close'); setNewMenu(false);}}>Close Task 月结任务</button></div>
        <div><h5>支出 Expenses</h5>
          <button onClick={()=>{setRoute('ap'); setNewMenu(false);}}>Bill 应付账单</button>
          <button onClick={()=>{setRoute('checks'); setNewMenu(false);}}>Check 支票</button>
          <button onClick={()=>{setRoute('ap'); setNewMenu(false);}}>Pay Bills 付款批次</button></div>
        <div><h5>房地产 Real Estate</h5>
          <button onClick={()=>{setRoute('loan'); setNewMenu(false);}}>Loan Draw 提款</button>
          <button onClick={()=>{setRoute('pmpickup'); setNewMenu(false);}}>PM Pickup 批次</button>
          <button onClick={()=>{setRoute('closing'); setNewMenu(false);}}>Closing 交割</button></div>
        <div><h5>其他 Other</h5>
          <button onClick={()=>{setRoute('bankrec'); setNewMenu(false);}}>Reconcile 对账</button>
          <button onClick={()=>{setRoute('exceptions'); setNewMenu(false);}}>Exception 异常</button>
          <button onClick={()=>{setRoute('reports'); setNewMenu(false);}}>Report 报表</button></div>
      </div>
    </div>}
    {palette && <div className="pal-scrim" onClick={()=>setPalette(false)}>
      <div className="pal" onClick={e=>e.stopPropagation()}>
        <input autoFocus placeholder="跳转到模块…" value={q} onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&paletteItems[0]){setRoute(paletteItems[0][0]); setPalette(false); setQ('');}}}/>
        <div className="pal-list">{paletteItems.map(([k,ic,l])=>
          <button key={k} onClick={()=>{setRoute(k); setPalette(false); setQ('');}}>{ic} {l}<span className="muted sm">{k}</span></button>)}</div>
      </div>
    </div>}
    {toast && <Toast msg={toast.msg} tone={toast.tone} />}
  </div>;
}


function AuditLog({ctx}) {
  const log = repo.auditLog();
  const T = ctx ? null : null;
  return <div className="full-bleed"><h2 className="page-h">Audit Log</h2>
    {log.length===0 ? <div className="empty">尚无审计记录——所有关键动作(审批/过账/付款/排除)都会记录在这里</div> :
    <table className="tbl"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Ref</th><th>Detail</th></tr></thead>
    <tbody>{log.map((e,i)=><tr key={i}><td>{e.ts}</td><td>{e.user}</td><td><span className="badge badge-muted">{e.action}</span></td><td>{e.objectType}</td><td>{e.objectRef}</td><td>{e.detail}</td></tr>)}</tbody></table>}
  </div>;
}
function Approvals({ctx}) {
  const {jes, ap, actions, can, toast, goto} = ctx;
  const pj = jes.filter(j=>['PENDING_REVIEW','PENDING_APPROVAL'].includes(j.posting_status));
  const pb = ap.bills.filter(b=>b.status==='PENDING_APPROVAL');
  return <div><h2 className="page-h">Approvals</h2>
    <h3 style={{fontSize:17}}>Journal Entries ({pj.length})</h3>
    {pj.map(j=><div key={j.je_id} className="appr-row"><span>{j.je_number} · {j.description}</span>
      <span className="row-acts"><button className="btn btn-sm" onClick={()=>goto('je')}>Open</button>
      {can('GL.JE.APPROVE') && <button className="btn btn-primary btn-sm" onClick={()=>actions.advanceJE(j.je_id, j.posting_status==='PENDING_REVIEW'?'PENDING_APPROVAL':'APPROVED','APPROVE')}>Approve</button>}</span></div>)}
    {pj.length===0 && <div className="empty">没有待审批分录</div>}
    <h3 style={{fontSize:17, marginTop:22}}>Bills ({pb.length})</h3>
    {pb.map(b=><div key={b.bill_id} className="appr-row"><span>{b.bill_no} · {b.vendor_name} · ${b.amount.toLocaleString()}</span>
      <span className="row-acts"><button className="btn btn-sm" onClick={()=>goto('ap')}>Open</button>
      {can('AP.INVOICE.APPROVE') && <button className="btn btn-primary btn-sm" onClick={()=>{actions.approveBill(b.bill_id); toast('Bill approved');}}>Approve</button>}</span></div>)}
    {pb.length===0 && <div className="empty">没有待审批 Bill</div>}
  </div>;
}

export { App };
if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App/>);
}
