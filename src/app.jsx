import { useState, useEffect, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast, Btn, Icon, StateBlock } from './ui.jsx';
import { ENTITIES, USERS, PERIODS, COA, VENDORS, CUSTOMERS } from './data.js';
import { periodControlExceptions, periodStatusLabel, resolvePostingPeriod } from './period-control.js';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, BANK_TXNS, FY2026, nextId, bumpId } from './seed.js';
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
import { SubsidiaryLedger } from './module-subledger.jsx';
import { UnitCostLedger } from './module-unitcost.jsx';
import { CompanySetting } from './module-setting.jsx';
import { AIAudit } from './module-aiaudit.jsx';
import { AIJEWorkbench } from './module-ai-je-workbench.jsx';
import { AccrualCenter, AmortizationCenter } from './module-amortization-accrual.jsx';
import { StagingCenter } from './module-staging.jsx';
import { UnitTransfer } from './module-unittransfer.jsx';
import { SourceDocs } from './module-sourcedocs.jsx';
import { repo } from './repo.js';
import { AuthoritativeAdjustmentSummary, AuthoritativeCreditApplicationForm, AuthoritativeDocumentTable, AuthoritativeDraftForm, AuthoritativeRefundForm, AuthoritativeRuntimeLock, AuthoritativeWorkflowAdjustmentTable, AuthoritativeWorkflowTable, validateAuthoritativeDocumentDraft } from './authoritative-workspace.jsx';
import { AuthoritativeApp, authoritativeRuntimeConfigured } from './authoritative-app.jsx';
import { retainActiveNavigationGroup, toggleNavigationGroup } from './navigation-open-state.js';
import { RuntimeErrorPage } from './runtime-error-page.jsx';
import { SURFACE_DEMONSTRATION, SURFACE_ERROR, resolveRuntimeBoundary } from './runtime-mode.mjs';

class ErrorBoundary extends Component {
  constructor(p){ super(p); this.state={err:null}; }
  static getDerivedStateFromError(err){ return {err}; }
  componentDidUpdate(prev){ if(prev.routeKey!==this.props.routeKey && this.state.err) this.setState({err:null}); }
  render(){
    if(this.state.err){
      return (
        <StateBlock tone="error" title="Page failed to load">
          <div className="muted sm">This module could not render. The rest of the application remains available; switch pages or refresh to retry.</div>
          <pre style={{whiteSpace:'pre-wrap',fontSize:12,margin:'10px 0 0',overflow:'auto'}}>{String(this.state.err && this.state.err.message || this.state.err)}</pre>
        </StateBlock>
      );
    }
    return this.props.children;
  }
}

function SingletonNavigationDirect({goto}){
  useEffect(()=>{
    const directRoutes={'Journal Entry':'je',Reports:'reports'};
    const onClick=(event)=>{
      const header=event.target?.closest?.('.nav-group-h');
      if(!header) return;
      const route=directRoutes[header.textContent?.replace(/[????]/g,'').trim()];
      if(!route) return;
      event.preventDefault(); event.stopImmediatePropagation();
      goto(route);
    };
    document.addEventListener('click',onClick,true);
    return ()=>document.removeEventListener('click',onClick,true);
  },[goto]);
  return null;
}

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
// `short` is the 11px rail label; `glyph` selects a self-authored stroke icon.
const NAV = [
  {group:'Control Center', short:'Control', glyph:'gauge', icon:'◉', items:[['dashboard','Dashboard'],['approvals','Action Required'],['aireview','AI Audit Center'],['aijeworkbench','AI JE Workbench']]},
  {group:'Accounting Settings', short:'Settings', glyph:'gear', icon:'⚙', items:[['setting','Core settings'],['rules','Rule Center'],['mapping','Mapping Center']]},
  {group:'Source & Staging', short:'Sources', glyph:'inbox', icon:'⇅', items:[['staging','Accounting Staging'],['sourcedocs','Source Documents'],['integration','Integration Hub'],['exceptions','Mapping Exceptions']]},
  {group:'Auto Reconciliation', short:'Reconcile', glyph:'cycle', icon:'⟳', items:[['autobankrec','Bank Batch Pipeline'],['banktx','Bank Transaction Matching'],['bankrec','Reconciliation Worksheet'],['checks','Checks & Payments']]},
  {group:'Journal Entry', short:'Journals', glyph:'document', icon:'✎', items:[['je','Journal Entries']]},
  {group:'General Ledger', short:'Ledger', glyph:'lines', icon:'☰', items:[['gl','GL / TB / BS / IS'],['register','Account Inquiry'],['subledger','Subsidiary ledger'],['coa','Chart of Accounts']]},
  {group:'Accounting Operations', short:'Operations', glyph:'layers', icon:'▲', items:[['cost','Project Cost & CWIP'],['unitcost','Unit Cost Ledger'],['unittransfer','Unit Transfer'],['loan','Construction Loan'],['loanreg','Loan Register'],['pmpickup','Property Ops Pickup'],['closing','Closing Accounting'],['intercompany','Intercompany'],['assets','Fixed Assets']]},
  {group:'Close', short:'Close', glyph:'calendar', icon:'☑', items:[['close','Month-End Close']]},
  {group:'Reports', short:'Reports', glyph:'bars', icon:'▤', railBreak:true, items:[['reports','Reports Center']]},
  {group:'Admin', short:'Admin', glyph:'shield', icon:'◈', adminOnly:true, items:[['masterdata','Master Data'],['ap','AP (legacy)'],['ar','AR (legacy)'],['cash','Bank Accounts'],['audit','Audit Log'],['admin','Users & Settings']]},
];
NAV.find(group => group.group === 'Accounting Operations')?.items.splice(3, 0, ['amortization', 'Amortization Center'], ['accruals', 'Accrual Center']);
const COMP = { dashboard:Dashboard, je:JEWorkspace, banktx:BankTransactions, register:AccountRegister, subledger:SubsidiaryLedger, unitcost:UnitCostLedger, setting:CompanySetting, aireview:AIAudit, aijeworkbench:AIJEWorkbench, staging:StagingCenter, unittransfer:UnitTransfer, sourcedocs:SourceDocs, audit:AuditLog, approvals:Approvals, gl:GLTrialBalance, coa:COAWorkspace, loan:LoanWorkspace, loanreg:LoanRegister,
  pmpickup:PMPickup, closing:ClosingWorkspace, cost:ProjectCost, assets:Assets, ap:APWorkspace, ar:ARWorkspace,
  cash:CashModule, bankrec:BankRec2, autobankrec:AutoBankRec, checks:CheckMgmt, intercompany:Intercompany, integration:IntegrationHub, masterdata:MasterData,
  mapping:MappingCenter, rules:RuleCenter, exceptions:ExceptionCenter, close:CloseMgmt, reports:Reports, admin:AdminModule };
COMP.amortization = AmortizationCenter;
COMP.accruals = AccrualCenter;
const IA_HIDDEN_ROUTES = new Set(['cost','unitcost','unittransfer','loan','loanreg','pmpickup']);
const ADMIN_ROLES = ['CONTROLLER','SYS_ADMIN','AUDITOR'];

// ---- seed AP bills & bank rec model ----
const SEED_BILLS = [
  {bill_id:9001, bill_no:'BILL-2026-9001', vendor_id:2, vendor_name:'BluePeak Utilities', invoice_no:'INV-77821', bill_date:'2026-07-10', due_date:'2026-08-09', account_code:'641600', amount:3200, status:'PAID', created_by:'sam', approved_by:'ricky', je_number:'JE-2026-07-1005', pay_je_number:'JE-PAY-9001'},
  {bill_id:9002, bill_no:'BILL-2026-9002', vendor_id:1, vendor_name:'Summit General Contractors', invoice_no:'APP-014', bill_date:'2026-07-25', due_date:'2026-08-24', account_code:'164200', amount:185000, status:'APPROVED', created_by:'pat', approved_by:'ricky', je_number:'JE-2026-07-9002'},
  {bill_id:9003, bill_no:'BILL-2026-9003', vendor_id:3, vendor_name:'WanBridge Property Mgmt (RP)', invoice_no:'PMF-2026-07', bill_date:'2026-07-31', due_date:'2026-08-15', account_code:'682000', amount:2400, status:'PENDING_APPROVAL', created_by:'sam'},
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
      <label className="login-label">Sign-in account (demo environment · role is determined by the account)</label>
      <select value={u} onChange={e=>setU(e.target.value)}>
        {USERS.map(x=><option key={x.user_id} value={x.user_id}>{x.name} · {x.role_code}</option>)}
      </select>
      <button className="btn btn-primary login-btn" onClick={()=>onLogin(u)}>Sign in</button>
      <div className="login-note">Production uses SSO/OIDC. Role and access derive from the sign-in identity and cannot be changed on this page.</div>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// The single data boundary of the deployed client.
//
// resolveRuntimeBoundary reads the published runtime assets and returns one of
// three surfaces. Only SURFACE_DEMONSTRATION reaches the seed-backed tree in
// this file, and it is reachable only when the deployment adapter and the build
// stamp both state that this build is the public demonstration. Everything else
// - a runtime configuration that did not load, a mode this build does not
// implement, a mock adapter under an authoritative build stamp - renders the
// runtime error page. No unknown condition resolves to demonstration data.
// ---------------------------------------------------------------------------

// The demonstration ledger's working period. It is named once so that period
// control resolves the same code everywhere instead of repeating the literal.
const CURRENT_PERIOD = '2026-07';

function App() {
  const boundary = resolveRuntimeBoundary(globalThis);
  if (boundary.surface === SURFACE_ERROR) return <RuntimeErrorPage code={boundary.code}/>;
  if (boundary.surface !== SURFACE_DEMONSTRATION) return <AuthoritativeApp environment={globalThis}/>;
  const SEED_V='v10';
  const load=(k,d)=>{try{ if(localStorage.getItem('refs_seedv')!==SEED_V){['jes','exc','close','ap','bank','coa','ar'].forEach(x=>localStorage.removeItem('refs_'+x)); localStorage.setItem('refs_seedv',SEED_V);} const v=localStorage.getItem('refs_'+k);return v?JSON.parse(v):d;}catch(e){return d;}};
  const [userId, setUserId] = useState(()=>load('user',null));
  const [route, setRoute] = useState('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [navContext, setNavContext] = useState(null);
  const [jes, setJes] = useState(()=>load('jes',[...JOURNAL_ENTRIES, ...FY2026]));
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
  const [openGroups, setOpenGroups] = useState({});
  const [q, setQ] = useState('');

  const user = USERS.find(u=>u.user_id===userId);
  // Period control fails closed. There is deliberately no `|| {status:'OPEN'}`
  // fallback here: a missing period master row means nobody opened that period,
  // which is the opposite of permission to post. The resolver returns a period
  // object whose status is NOT_CONFIGURED so the screen can say exactly that.
  const periodControl = resolvePostingPeriod(PERIODS, {entity_id:entity||2, period_code:CURRENT_PERIOD});
  const period = periodControl.period;
  const showToast = (msg,tone='ok') => { setToastS({msg,tone}); setTimeout(()=>setToastS(null),3000); };
  // Every posting path resolves the period that the entry itself claims, not
  // the period of whichever entity the header happens to have selected.
  const resolvePeriodFor = (target) => resolvePostingPeriod(PERIODS, target);
  const guardPosting = (target, what) => {
    const resolved = resolvePostingPeriod(PERIODS, target);
    if (!resolved.ok) showToast(`${what} blocked [${resolved.code}]: ${resolved.message}`,'bad');
    return resolved;
  };
  const can = (perm) => { if(!user) return false; const p = ROLE_PERMS[user.role_code]; return p==='*' || (p||[]).includes(perm); };
  const goto = (next, context=null) => { setNavContext(context); setRoute(next); setMobileNav(false); window.scrollTo({top:0,behavior:'smooth'}); };

  useEffect(()=>{ document.body.className = dark?'dark':''; },[dark]);
  const persist=(k,v)=>{try{localStorage.setItem('refs_'+k,JSON.stringify(v))}catch(e){}};
  useEffect(()=>{ const t=setTimeout(()=>persist('jes',jes), 400); return ()=>clearTimeout(t); },[jes]); useEffect(()=>{persist('exc',exceptions)},[exceptions]);
  useEffect(()=>{persist('close',closeTasks)},[closeTasks]); useEffect(()=>{persist('ap',ap)},[ap]);
  useEffect(()=>{persist('bank',bank)},[bank]); useEffect(()=>{persist('coa',coa)},[coa]); useEffect(()=>{persist('ar',ar)},[ar]);
  useEffect(()=>{ if(userId) persist('user',userId); },[userId]);
  useEffect(()=>{ bumpId(Math.max(9000,...jes.map(j=>+j.je_id||0),...ap.bills.map(b=>+b.bill_id||0))); },[]);
  useEffect(()=>{
    const groups = [...NAV,{group:'Payables & Receivables',items:[['ap','Accounts Payable'],['ar','Accounts Receivable']]}];
    setOpenGroups(current=>retainActiveNavigationGroup(current,groups,route));
  },[route]);
  useEffect(()=>{
    const h = (e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); setPalette(p=>!p);} if(e.key==='Escape') setPalette(false); };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[]);

  const audit = (action, objectType, objectRef, detail) => repo.audit(userId, action, objectType, objectRef, detail);
  const mkJE = (spec) => { const id = nextId(); return {je_id:id, je_number:'20260731'+String(id).padStart(6,'0'), period_code:CURRENT_PERIOD, posting_status:'DRAFT', je_date:'2026-07-31', created_by:userId, history:[{a:'CREATE',by:userId,at:'2026-07-31'}], ...spec}; };
  // Any action that puts a journal entry into POSTED, or moves it forward
  // toward POSTED, must first prove the owning period is open. Returning null
  // means the guard has already told the user exactly why it refused.
  const postedJE = (spec, what) => guardPosting({entity_id:spec.entity_id, period_code:spec.period_code || CURRENT_PERIOD}, what).ok ? mkJE(spec) : null;
  const actions = {
    newJE: () => { const je = mkJE({entity_id:entity||2, je_type:'MANUAL', description:'', source_system:'MAN', has_attachment:false,
      lines:[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}]}); setJes(js=>[je,...js]); return je.je_id; },
    // A rule may create a Draft in any period; only an entry that arrives
    // already POSTED has to clear period control before it is written.
    newJEFromRule: (spec) => { const je = spec.posting_status==='POSTED' ? postedJE({...spec},'Rule-generated posting') : mkJE({...spec});
      if (!je) return null; setJes(js=>[je,...js]); return je.je_id; },
    copyJE: (id) => { const src = jes.find(j=>j.je_id===id); const je = mkJE({...structuredClone(src), posting_status:'DRAFT', description:'COPY: '+src.description}); je.history=[{a:'COPY of '+src.je_number,by:userId,at:'2026-07-31'}]; setJes(js=>[je,...js]); return je.je_id; },
    updateJE: (id, producer) => setJes(js=>js.map(j=>{ if(j.je_id!==id) return j; const d=structuredClone(j); producer(d); return d; })),
    advanceJE: (id, next, label) => {
      const target = jes.find(j=>j.je_id===id);
      // A workflow move toward POSTED is a posting act. Returning to DRAFT is
      // not, so a rejection is never blocked by period control.
      if (target && next!=='DRAFT' && !guardPosting(target,'Journal entry workflow').ok) return;
      audit(label||next,'JE','#'+id,''); return setJes(js=>js.map(j=>{
      if(j.je_id!==id) return j;
      if((next==='APPROVED'||next==='POSTED') && j.created_by===userId && user.role_code!=='CONTROLLER'){
        showToast('SoD blocked [4009]: the creator cannot approve or post this journal entry.','bad'); return j; }
      return {...j, posting_status:next, history:[...(j.history||[]),{a:label||next,by:userId,at:'2026-07-31'}]};
    })); },
    // A reversal is itself a posting. It is booked in the period the source
    // entry claims, so if that period is closed or unconfigured the reversal is
    // refused here rather than silently re-dated into an open period.
    reverseJE: (id) => { const source = jes.find(j=>j.je_id===id);
      if (source && !guardPosting(source,'Reversal').ok) return;
      return setJes(js=>{ const src = js.find(j=>j.je_id===id); const nid=nextId();
      const rev = {...structuredClone(src), je_id:nid, je_number:'JE-REV-'+nid, posting_status:'POSTED', je_type:'REVERSAL',
        description:'Reversal: '+src.description, history:[{a:'REVERSAL of '+src.je_number,by:userId,at:'2026-07-31'}],
        lines:src.lines.map(l=>({...l, debit_amount:l.credit_amount, credit_amount:l.debit_amount}))};
      return js.map(j=>j.je_id===id?{...j, posting_status:'REVERSED'}:j).concat(rev); }); },
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
      const je = postedJE({entity_id:entity||4, je_type:'AUTO', source_system:'PAYABLE', payee:b.vendor_name, description:`${b.bill_no} · ${b.vendor_name}`, posting_status:'POSTED',
        lines:[{account_code:b.account_code, debit_amount:b.amount, credit_amount:0, vendor_id:b.vendor_id, property_id:b.property_id, description:b.invoice_no},
               {account_code:'291001', debit_amount:0, credit_amount:b.amount, vendor_id:b.vendor_id, description:'Due to/from_'+b.vendor_name}]},'Bill approval posting');
      if (!je) return;
      setJes(js=>[je,...js]);
      setAp(s=>({...s, bills:s.bills.map(x=>x.bill_id===id?{...x, status:'APPROVED', approved_by:userId, je_number:je.je_number}:x)})); },
    payBills: (ids) => { ids.forEach(id=>{ const b = ap.bills.find(x=>x.bill_id===id);
        const je = postedJE({entity_id:entity||4, je_type:'AUTO', source_system:'EXPA', payee:b.vendor_name, description:`ACH payment ${b.bill_no} · auto-matched bank feed`, posting_status:'POSTED',
          lines:[{account_code:'291001', debit_amount:b.amount, credit_amount:0, vendor_id:b.vendor_id, description:'Due to/from_'+b.vendor_name+' (clear)'},
                 {account_code:'111000', debit_amount:0, credit_amount:b.amount, description:'Operating Cash'}]},'Bill payment posting');
        if (!je) return;
        setJes(js=>[je,...js]);
        setAp(s=>({...s, bills:s.bills.map(x=>x.bill_id===id?{...x, status:'PAID', pay_je_number:je.je_number}:x)})); }); },
    addInvoice: (f) => { const id=nextId(); const c=CUSTOMERS.find(x=>x.customer_id===f.customer_id);
      const je = postedJE({entity_id:entity||4, je_type:'AUTO', source_system:'AR', posting_status:'POSTED', description:`Invoice INV-2026-${id} · ${c.customer_name}`,
        lines:[{account_code:'120200',debit_amount:f.amount,credit_amount:0},{account_code:'421803',debit_amount:0,credit_amount:f.amount}]},'Invoice posting');
      if (!je) return;
      setJes(js=>[je,...js]); audit('CREATE','INVOICE','INV-2026-'+id, '$'+f.amount);
      setAr(s=>({...s, invoices:[{inv_id:id, inv_no:'INV-2026-'+id, customer_name:c.customer_name, status:'OPEN', je_number:je.je_number, ...f}, ...s.invoices]})); },
    receivePayment: (id) => { const inv=ar.invoices.find(i=>i.inv_id===id);
      const je = postedJE({entity_id:entity||4, je_type:'AUTO', source_system:'AR', posting_status:'POSTED', description:`Payment received ${inv.inv_no}`,
        lines:[{account_code:'111000',debit_amount:inv.amount,credit_amount:0},{account_code:'120200',debit_amount:0,credit_amount:inv.amount}]},'Receipt posting');
      if (!je) return;
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
      const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='Manual match';
      const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; }),
    bankSuspense: (acctCode, txnId) => { setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
        const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='→ 9000 Suspense';
        const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; });
      actions.ensureException({exception_type:'SUSPENSE_BALANCE', severity:'MEDIUM', object_type:'BANK_TXN', object_ref:'txn#'+txnId, entity_id:entity||4, owner:'TREASURY', root_cause:'Unrecognized bank transaction held in suspense'}); },
    bankSignoff: (acctCode) => setBank(s=>({...s, history:[{id:Date.now(), account:acctCode, period:s.accounts[acctCode].period, diff:0, by:userId, at:'2026-07-31'}, ...s.history]})),
    // ---- COA ----
    addAccount: (f) => { if (coa.some(a=>a.account_code===f.account_code)) return {dup:true};
      setCoa(cs=>[...cs, f].sort((a,b)=>a.account_code.localeCompare(b.account_code))); return {ok:true}; },
    toggleAccount: (code) => setCoa(cs=>cs.map(a=>a.account_code===code?{...a, inactive:!a.inactive}:a)),
    resetData: () => { try{['jes','exc','close','ap','bank','coa','user'].forEach(k=>localStorage.removeItem('refs_'+k))}catch(e){} location.reload(); },
    logout: () => { try{localStorage.removeItem('refs_user')}catch(e){} setUserId(null); },
  };

  if (!user) return <Login onLogin={setUserId}/>;

  const isAdmin = ADMIN_ROLES.includes(user.role_code);
  const nav = [...NAV,{group:'Payables & Receivables',short:'AP / AR',glyph:'exchange',icon:'▣',items:[['ap','Accounts Payable'],['ar','Accounts Receivable']]}].filter(g=>!g.adminOnly || isAdmin).map(g=>({...g,items:g.items.filter(([k])=>!IA_HIDDEN_ROUTES.has(k))})).filter(g=>g.items.length);
  const flat = nav.flatMap(g=>g.items.map(([k,l])=>[k,'·',l]));
  // Derived, read-only. Detected from the retained ledger every render rather
  // than seeded, so it can never drift from what is actually posted. Nothing
  // here modifies a Posted entry.
  const periodExceptions = periodControlExceptions({journals:jes, periods:PERIODS});
  const ctx = {jes, exceptions, closeTasks, ap, ar, bank, coa, user, entity, period, periods:PERIODS, periodControl, periodExceptions, resolvePeriodFor, can, actions, toast:showToast, goto, navContext};
  const Comp = COMP[route] || Dashboard;
  const paletteItems = flat.filter(([k,ic,l])=>l.toLowerCase().includes(q.toLowerCase())||k.includes(q.toLowerCase()));
  const jeHits = q.length>=3 ? jes.filter(j=>(j.je_number||'').includes(q)||((j.payee||'').toLowerCase().includes(q.toLowerCase()))).slice(0,5) : [];

  return <div className="app"><SingletonNavigationDirect goto={goto}/>
    <aside id="primary-navigation" className={`sidebar ${mobileNav?'mobile-open':''}`}>
      {/* Two-part navigation: a 74px icon rail carrying the groups, and a white
          second-level panel listing the pages of every group that is open. A
          group opens and closes only from its own rail item, so several groups
          stay open at once and selecting a page never collapses another. */}
      <div className="nav-rail">
        <span className="rail-logo" aria-hidden="true">◈</span>
        {nav.map(g=>{ const isSingleton = g.items.length === 1; const opened = isSingleton ? false : (openGroups[g.group] ?? g.items.some(([k])=>route===k)); const groupPanelId=`nav-group-${g.group.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`; const inGroup = g.items.some(([k])=>route===k);
          return <div key={g.group} className="nav-group">
            {g.railBreak && <span className="rail-sep" aria-hidden="true"/>}
            <button className={`nav-group-h ${inGroup?'rail-on':''}`} title={g.group} aria-expanded={isSingleton?undefined:opened} aria-controls={isSingleton?undefined:groupPanelId} aria-current={isSingleton&&route===g.items[0][0]?'page':undefined} onClick={()=>isSingleton ? goto(g.items[0][0]) : setOpenGroups(o=>toggleNavigationGroup(o,g.group))}>
              <span className="rail-glyph" aria-hidden="true"><Icon name={g.glyph}/></span>
              <span className="rail-label">{g.short||g.group}</span>
              {!isSingleton && <span className="nav-caret" aria-hidden="true">{opened?'▾':'▸'}</span>}
            </button>
          </div>;})}
      </div>
      <div className="nav-panel">
        <div className="brand"><span className="logo">◈</span> REFS<span className="brand-sub">WanBridge</span></div>
        {mobileNav && <button className="mobile-nav-close" aria-label="Close navigation" onClick={()=>setMobileNav(false)}>Close</button>}
        <button className="new-btn" onClick={()=>setNewMenu(true)}>＋ New</button>
        <nav aria-label="Workspace pages">{nav.map((g,gi)=>{ const isSingleton = g.items.length === 1; const opened = isSingleton ? false : (openGroups[g.group] ?? g.items.some(([k])=>route===k)); const groupPanelId=`nav-group-${g.group.toLowerCase().replace(/[^a-z0-9]+/g,'-')}`;
          if(isSingleton || !opened) return null;
          return <div key={g.group} className={`nav-panel-group nav-tone-${gi%6}`}>
            <div className="nav-panel-title">{g.group}</div>
            <div id={groupPanelId} className="nav-group-items">{g.items.map(([k,l])=>
              <button key={k} aria-current={route===k?'page':undefined} className={`nav-item nav-sub ${route===k?'nav-on':''}`} onClick={()=>goto(k)}>
                <span className="nav-badge" aria-hidden="true">{l.slice(0,1).toUpperCase()}</span>
                <span className="nav-item-label">{l}</span>
                <span className="nav-chev" aria-hidden="true">›</span>
              </button>)}</div>
          </div>;})}
          {nav.every(g=>g.items.length===1 || !(openGroups[g.group] ?? g.items.some(([k])=>route===k))) &&
            <p className="nav-panel-empty">Choose a section in the rail to list its pages.</p>}
        </nav>
      </div>
    </aside>
    {mobileNav && <button className="mobile-nav-scrim" tabIndex={-1} aria-label="Close navigation" onClick={()=>setMobileNav(false)} />}
    <div className="main">
      <header className="topbar">
        <button className="mobile-nav-btn" aria-label="Open navigation" onClick={()=>setMobileNav(true)}>☰</button>
        <label className="sw"><select value={entity} onChange={e=>setEntity(+e.target.value)}><option value={0}>All entities</option>{ENTITIES.map(en=><option key={en.entity_id} value={en.entity_id}>{en.entity_code} {en.entity_name}</option>)}</select></label>
        <button className="cmdk" onClick={()=>setPalette(true)}>⌘K Search or jump</button>
        <div className="top-right">
          <span className="period-chip" title={periodControl.ok ? `Period ${CURRENT_PERIOD} is open for posting for this entity.` : periodControl.message}><span className="period-label">Period</span><b>{CURRENT_PERIOD}</b><span className={`badge badge-${periodControl.ok?'ok':period.status==='CLOSED'?'muted':'bad'}`}>{periodStatusLabel(period)}</span></span>
          {!periodControl.ok && <span className="badge badge-bad" role="status" title={periodControl.message}>Posting blocked</span>}
          <button className="icon-btn" title="Help" onClick={()=>showToast('Help center (prototype)')}>?</button>
          <button className="icon-btn" title="Notifications" onClick={()=>setRoute('exceptions')}>🔔</button>
          <button className="icon-btn" onClick={()=>actions.resetData()} title="Reset demo data">⟲</button>
          <button className="icon-btn" onClick={()=>setDark(d=>!d)} title="Light / dark">{dark?'☀':'☾'}</button>
          <span className="badge badge-warn" title="This build serves browser demonstration data. It is not an accounting record and carries no entity, period, approval or posting authority.">Public demonstration data</span>
          <span className="muted" style={{fontSize:10.5,opacity:.7}} title="commit · build time">{typeof window!=='undefined'&&window.__BUILD?`${window.__BUILD.sha} · ${window.__BUILD.time}`:''}</span>
          <div className="user-chip" title={'Role '+user.role_code}>
            <span className="user-av">{user.name[0]}</span>
            <span className="user-nm">{user.name}<span className="muted sm"> · {user.role_code}</span></span>
            <button className="link-btn" onClick={actions.logout}>Sign out</button>
          </div>
        </div>
      </header>
      <main className="content"><ErrorBoundary routeKey={route}><Comp ctx={ctx} /></ErrorBoundary></main>
    </div>
    {newMenu && <div className="newmenu-scrim" onClick={()=>setNewMenu(false)}>
      <div className="newmenu" onClick={e=>e.stopPropagation()}>
        <div><h5>General Ledger</h5>
          <button onClick={()=>{actions.newJE(); setRoute('je'); setNewMenu(false);}}>Journal entry</button>
          <button onClick={()=>{setRoute('coa'); setNewMenu(false);}}>Accounts</button>
          <button onClick={()=>{setRoute('close'); setNewMenu(false);}}>Month-end close</button></div>
        <div><h5>Expenses</h5>
          <button onClick={()=>{setRoute('ap'); setNewMenu(false);}}>Bills</button>
          <button onClick={()=>{setRoute('checks'); setNewMenu(false);}}>Checks</button>
          <button onClick={()=>{setRoute('ap'); setNewMenu(false);}}>Pay bills</button></div>
        <div><h5>Real Estate</h5>
          <button onClick={()=>{setRoute('loan'); setNewMenu(false);}}>Loan draw</button>
          <button onClick={()=>{setRoute('pmpickup'); setNewMenu(false);}}>PM pickup</button>
          <button onClick={()=>{setRoute('closing'); setNewMenu(false);}}>Closing</button></div>
        <div><h5>Other</h5>
          <button onClick={()=>{setRoute('bankrec'); setNewMenu(false);}}>Reconcile</button>
          <button onClick={()=>{setRoute('exceptions'); setNewMenu(false);}}>Exceptions</button>
          <button onClick={()=>{setRoute('reports'); setNewMenu(false);}}>Reports</button></div>
      </div>
    </div>}
    {palette && <div className="pal-scrim" onClick={()=>setPalette(false)}>
      <div className="pal" onClick={e=>e.stopPropagation()}>
        <input autoFocus placeholder="Go to a workspace…" value={q} onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&paletteItems[0]){setRoute(paletteItems[0][0]); setPalette(false); setQ('');}}}/>
        <div className="pal-list">{jeHits.map(j=><button key={'je'+j.je_id} onClick={()=>{setRoute('je'); setPalette(false); setQ('');}}>✎ {j.je_number} · {(j.payee||j.description||'').slice(0,30)}<span className="muted sm">JE</span></button>)}{paletteItems.map(([k,ic,l])=>
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
    {log.length===0 ? <StateBlock tone="empty" title="No audit records yet">Key approval, posting, payment, and exclusion actions appear here.</StateBlock> :
    <div className="table-wrap" role="region" aria-label="Audit log table" tabIndex={0}>
    <table className="tbl"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>Ref</th><th>Detail</th></tr></thead>
    <tbody>{log.map((e,i)=><tr key={i}><td>{e.ts}</td><td>{e.user}</td><td><span className="badge badge-muted">{e.action}</span></td><td>{e.objectType}</td><td>{e.objectRef}</td><td>{e.detail}</td></tr>)}</tbody></table></div>}
  </div>;
}
function Approvals({ctx}) {
  const {jes, ap, goto} = ctx;
  const pj = jes.filter(j=>['PENDING_REVIEW','PENDING_APPROVAL'].includes(j.posting_status));
  const pb = ap.bills.filter(b=>b.status==='PENDING_APPROVAL');
  return <div><h2 className="page-h">Action Required</h2>
    <p className="page-subtitle">Review retained evidence here. Approval and posting remain in their controlled accounting workflows.</p>
    <h3 className="qb-sec" style={{marginBottom:10}}>Journal Entries ({pj.length})</h3>
    {pj.map(j=><div key={j.je_id} className="appr-row"><span>{j.je_number} · {j.description} · {j.posting_status}</span>
      <span className="row-acts"><button className="btn btn-sm" onClick={()=>goto('je',{jeNumber:j.je_number,actionQueueReturn:{route:'approvals'}})}>Open JE evidence</button></span></div>)}
    {pj.length===0 && <StateBlock tone="empty" title="No journal entries awaiting approval">Entries appear here once they reach the approval step.</StateBlock>}
    <h3 className="qb-sec" style={{margin:'26px 0 10px'}}>Bills ({pb.length})</h3>
    {pb.map(b=><div key={b.bill_id} className="appr-row"><span>{b.bill_no} · {b.vendor_name} · ${b.amount.toLocaleString()} · {b.status}</span>
      <span className="row-acts"><button className="btn btn-sm" onClick={()=>goto('ap',{route:'ap',tab:'Bills',billId:b.bill_id,actionQueueReturn:{route:'approvals'}})}>Open bill evidence</button></span></div>)}
    {pb.length===0 && <StateBlock tone="empty" title="No bills awaiting approval">Bills appear here once they reach the approval step.</StateBlock>}
  </div>;
}

export { App, AuthoritativeApp, authoritativeRuntimeConfigured, AuthoritativeAdjustmentSummary, AuthoritativeCreditApplicationForm, AuthoritativeDocumentTable, AuthoritativeDraftForm, AuthoritativeRefundForm, AuthoritativeWorkflowAdjustmentTable, AuthoritativeWorkflowTable, validateAuthoritativeDocumentDraft };
if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App/>);
}
