import { useState, useEffect, useRef, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast, Btn } from './ui.jsx';
import { ENTITIES, USERS, PERIODS, COA, VENDORS, CUSTOMERS } from './data.js';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, BANK_TXNS, FY2026, nextId, bumpId } from './seed.js';
import { jeTotals, validateJE } from './engine.js';
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
import { StagingCenter } from './module-staging.jsx';
import { UnitTransfer } from './module-unittransfer.jsx';
import { SourceDocs } from './module-sourcedocs.jsx';
import { repo } from './repo.js';
import { accountingApiConfig, applyAuthoritativeCredit, createAuthoritativeAdjustment, createAuthoritativeBusinessDocument, createAuthoritativeSettlement, refreshAuthoritativeDocuments, transitionAuthoritativeJournal } from './accounting-api.js';
import { batchBankTransition, buildBankDraft, buildBankWorkflowException, createBankDraftTransition, excludeBankTransition, matchBankTransition, undoBankTransition, validateBankDraft } from './bank-workflow.js';
import { authorizeJECommand, copyJEAsDraft, createReclassDraft, createRecurringTemplate, createReversal, rejectJETransition, reserveJESources, resolveJEPeriod, saveJEDraft, transitionJE, validateNewJEBatch, validateNewJESpec, verifyAttachmentContent } from './je-workflow.js';
import { approveBillCommand, payBillCommand } from './ap-workflow.js';
import { createInvoiceCommand, receivePaymentCommand } from './ar-workflow.js';
import { applyPostedDocumentTransition, documentJENumber, validateDocumentReversal } from './document-posting.js';

const SEED_V='v13';
const BUILD_SHA = typeof __REFS_BUILD_SHA__ !== 'undefined' ? __REFS_BUILD_SHA__ : 'dev';
const BUILD_TIME = typeof __REFS_BUILD_TIME__ !== 'undefined' ? __REFS_BUILD_TIME__ : 'local';

const attachmentDB = () => new Promise((resolve,reject)=>{const request=indexedDB.open('refs-attachments',1);request.onupgradeneeded=()=>request.result.createObjectStore('blobs');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
const putAttachmentBlob = async (id,blob) => {const db=await attachmentDB();await new Promise((resolve,reject)=>{const tx=db.transaction('blobs','readwrite');tx.objectStore('blobs').put(blob,id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();};
const getAttachmentBlob = async id => {const db=await attachmentDB();const blob=await new Promise((resolve,reject)=>{const request=db.transaction('blobs').objectStore('blobs').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});db.close();return blob;};
const verifyStoredDocuments = (je,documents) => verifyAttachmentContent({je,documents,loadBlob:getAttachmentBlob});

class ErrorBoundary extends Component {
  constructor(p){ super(p); this.state={err:null}; }
  static getDerivedStateFromError(err){ return {err}; }
  componentDidUpdate(prev){ if(prev.routeKey!==this.props.routeKey && this.state.err) this.setState({err:null}); }
  render(){
    if(this.state.err){
      return (
        <div className="empty" style={{margin:24,textAlign:'left',padding:'28px 30px'}}>
          <h3 style={{marginTop:0,color:'var(--bad)'}}>此页面加载出错</h3>
          <div className="muted sm" style={{marginBottom:14}}>该模块渲染异常，应用其余部分仍可正常使用。请切换到其他页面，或刷新重试。</div>
          <pre style={{whiteSpace:'pre-wrap',fontSize:12,color:'var(--text-2)',background:'var(--bg-canvas)',padding:'10px 12px',borderRadius:8,overflow:'auto'}}>{String(this.state.err && this.state.err.message || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const ROLE_PERMS = {
  CONTROLLER: '*',
  ACCT_MANAGER: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.APPROVE','GL.COA.CREATE','AP.INVOICE.CREATE','AP.INVOICE.APPROVE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF','PERIOD.PERIOD.CLOSE','CASH.RECON.SIGNOFF'],
  SENIOR_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.POST','AP.INVOICE.CREATE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF','CASH.RECON.SIGNOFF'],
  STAFF_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW','AP.INVOICE.CREATE'],
  PROJECT_ACCT: ['GL.JE.CREATE','AP.INVOICE.CREATE','PERIOD.CLOSE.SIGNOFF'],
  PROPERTY_ACCT: ['GL.JE.CREATE','AP.INVOICE.CREATE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF'],
  TREASURY: ['GL.JE.CREATE','AP.PAYMENT.CREATE','CASH.RECON.SIGNOFF'],
  AP: ['AP.INVOICE.CREATE'], AR: ['AR.INVOICE.CREATE','AR.PAYMENT.CREATE'],
  REVIEWER: ['GL.JE.REVIEW','GL.JE.APPROVE','AP.INVOICE.APPROVE'],
  AUDITOR: [], READ_ONLY: [], SYS_ADMIN: [],
};
const NAV = [
  {group:'Control Center', icon:'◉', items:[['dashboard','Dashboard'],['approvals','Action Required'],['aireview','AI Audit Center']]},
  {group:'Accounting Settings', icon:'⚙', items:[['setting','四大 Setting'],['rules','Rule Center'],['mapping','Mapping Center']]},
  {group:'Source & Staging', icon:'⇅', items:[['staging','Accounting Staging'],['sourcedocs','Source Documents'],['integration','Integration Hub'],['exceptions','Mapping Exceptions']]},
  {group:'Auto Reconciliation', icon:'⟳', items:[['autobankrec','Bank Batch Pipeline'],['banktx','Bank Transaction Matching'],['bankrec','Reconciliation Worksheet'],['checks','Checks & Payments']]},
  {group:'Journal Entry', icon:'✎', items:[['je','Journal Entries']]},
  {group:'General Ledger', icon:'☰', items:[['gl','GL / TB / BS / IS'],['register','Account Inquiry'],['subledger','辅助核算 Subsidiary'],['coa','Chart of Accounts']]},
  {group:'Real Estate Accounting', icon:'▲', items:[['cost','Project Cost & CWIP'],['unitcost','Unit Cost Ledger'],['unittransfer','Unit Transfer'],['loan','Construction Loan'],['loanreg','Loan Register'],['pmpickup','Property Ops Pickup'],['closing','Closing Accounting'],['intercompany','Intercompany'],['assets','Fixed Assets']]},
  {group:'Close', icon:'☑', items:[['close','Month-End Close']]},
  {group:'Reports', icon:'▤', items:[['reports','Reports Center']]},
  {group:'Admin', icon:'◈', adminOnly:true, items:[['masterdata','Master Data'],['ap','AP (legacy)'],['ar','AR (legacy)'],['cash','Bank Accounts'],['audit','Audit Log'],['admin','Users & Settings']]},
];
const COMP = { dashboard:Dashboard, je:JEWorkspace, banktx:BankTransactions, register:AccountRegister, subledger:SubsidiaryLedger, unitcost:UnitCostLedger, setting:CompanySetting, aireview:AIAudit, staging:StagingCenter, unittransfer:UnitTransfer, sourcedocs:SourceDocs, audit:AuditLog, approvals:Approvals, gl:GLTrialBalance, coa:COAWorkspace, loan:LoanWorkspace, loanreg:LoanRegister,
  pmpickup:PMPickup, closing:ClosingWorkspace, cost:ProjectCost, assets:Assets, ap:APWorkspace, ar:ARWorkspace,
  cash:CashModule, bankrec:BankRec2, autobankrec:AutoBankRec, checks:CheckMgmt, intercompany:Intercompany, integration:IntegrationHub, masterdata:MasterData,
  mapping:MappingCenter, rules:RuleCenter, exceptions:ExceptionCenter, close:CloseMgmt, reports:Reports, admin:AdminModule };
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
        {bank_txn_id:1, external_id:'BANKTXN-Z-4460', txn_date:'2026-07-06', amount:46000, direction:'CREDIT', reference:'ACH RENT P0020', match_status:'MATCHED', processing_type:'MATCH', matched_je_id:1004, matched_je:'JE-2026-07-1004'},
        {bank_txn_id:2, external_id:'BANKTXN-Z-4471', txn_date:'2026-07-30', amount:1250, direction:'CREDIT', reference:'ACH UNKNOWN TENANT', match_status:'UNMATCHED', suggest:'MATCH'},
        {bank_txn_id:5, external_id:'BANKTXN-Z-4480', txn_date:'2026-07-31', amount:85, direction:'DEBIT', reference:'MONTHLY SERVICE FEE', match_status:'UNMATCHED', suggest:'FEE'},
        {bank_txn_id:6, external_id:'BANKTXN-Z-4481', txn_date:'2026-07-31', amount:250, direction:'CREDIT', reference:'INTEREST INCOME', match_status:'UNMATCHED', suggest:'INTEREST'},
      ]},
    'BA-001': { bank_name:'First National Bank', period:'2026-07', stmt_date:'2026-07-31',
      stmt_begin:410000, stmt_end:910000, gl_book_balance:910000, recorded_adj:0,
      outstanding_checks:[], deposits_in_transit:[],
      txns:[
        {bank_txn_id:3, external_id:'BANKTXN-A-1002', txn_date:'2026-07-05', amount:500000, direction:'CREDIT', reference:'LOAN DRAW FNB', match_status:'MATCHED', processing_type:'MATCH', matched_je_id:1001, matched_je:'JE-2026-07-1001'},
      ]},
  },
  matches:[
    {source_doc_id:'BANKTXN-Z-4460',je_id:1004,cash_line_index:0,bank_account_code:'BA-003',by:'system',at:'2026-07-06'},
    {source_doc_id:'BANKTXN-A-1002',je_id:1001,cash_line_index:0,bank_account_code:'BA-001',by:'system',at:'2026-07-05'},
  ],
  draft_links:[], history: [],
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
  repo.ensureSchema(SEED_V);
  const load=(k,d)=>repo.load(k,d);
  const apiConfigured=!!accountingApiConfig();
  const [userId, setUserId] = useState(()=>load('user',null));
  const [route, setRoute] = useState('dashboard');
  const [jes, setJes] = useState(()=>load('jes',[...JOURNAL_ENTRIES, ...FY2026]));
  const [exceptions, setExceptions] = useState(()=>load('exc',EXCEPTIONS));
  const [closeTasks, setCloseTasks] = useState(()=>load('close',CLOSE_TASKS));
  const [ap, setAp] = useState(()=>apiConfigured?{bills:[],adjustments:[],dupBlocked:0}:load('ap',{bills:SEED_BILLS, dupBlocked:0}));
  const [bank, setBank] = useState(()=>load('bank',SEED_BANK));
  const [coa, setCoa] = useState(()=>load('coa',COA.map(a=>({...a}))));
  const [ar, setAr] = useState(()=>apiConfigured?{invoices:[],adjustments:[]}:load('ar',{invoices:[
    {inv_id:8001, inv_no:'INV-2026-8001', customer_id:1, customer_name:'Tenant - Unit A-203', inv_date:'2026-07-01', due_date:'2026-07-15', amount:2000, status:'OPEN', je_number:'20260701000009'},
    {inv_id:8002, inv_no:'INV-2026-8002', customer_id:2, customer_name:'WanBridge OpCo (Owner)', inv_date:'2026-07-10', due_date:'2026-08-10', amount:12500, status:'PAID', je_number:'20260710000012', pay_je_number:'20260728000031'},
  ]}));
  const [recurring, setRecurring] = useState(()=>load('recurring',[]));
  const [documents, setDocuments] = useState(()=>load('documents',[]));
  const [apiStatus,setApiStatus] = useState(()=>apiConfigured?'CONNECTING':'LOCAL_PROTOTYPE');
  const [entity, setEntity] = useState(0);
  const [dark, setDark] = useState(false);
  const [toast, setToastS] = useState(null);
  const [palette, setPalette] = useState(false);
  const [newMenu, setNewMenu] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [narrowViewport, setNarrowViewport] = useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width:1080px)').matches);
  const [openGroups, setOpenGroups] = useState({Home:true, Transactions:true});
  const [q, setQ] = useState('');
  const [jeDirty, setJEDirty] = useState(false);
  const bankSubmitLocks = useRef(new Set());
  const jeActionLocks = useRef(new Set());
  const mobileMenuRef = useRef(null);
  const sidebarRef = useRef(null);
  const mobileWasOpen = useRef(false);
  const sourceStateRef = useRef({ap,ar});
  sourceStateRef.current={ap,ar};

  const user = USERS.find(u=>u.user_id===userId);
  const period = entity?(PERIODS.find(p=>p.entity_id===entity&&p.period_code==='2026-07')||{period_code:'2026-07',status:'UNCONFIGURED'}):{period_code:'2026-07',status:'MULTI'};
  const showToast = (msg,tone='ok') => { setToastS({msg,tone}); setTimeout(()=>setToastS(null),3000); };
  const can = (perm) => { if(!user) return false; const p = ROLE_PERMS[user.role_code]; return p==='*' || (p||[]).includes(perm); };
  const requestLeaveJE = () => {if(!jeDirty)return true;const ok=typeof window==='undefined'||window.confirm('Discard unsaved journal entry changes?');if(ok)setJEDirty(false);return ok;};
  const navigate = next => {if(route==='je'&&!requestLeaveJE())return false;setRoute(next);setMobileNav(false);return true;};
  const trapMobileNav = event => {if(!narrowViewport||!mobileNav||event.key!=='Tab')return;const nodes=[...event.currentTarget.querySelectorAll('button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')];if(!nodes.length)return;const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}};

  useEffect(()=>{ document.body.className = dark?'dark':''; },[dark]);
  useEffect(()=>{if(typeof window==='undefined')return;const media=window.matchMedia('(max-width:1080px)');const sync=()=>{setNarrowViewport(media.matches);if(!media.matches)setMobileNav(false);};sync();media.addEventListener('change',sync);return()=>media.removeEventListener('change',sync);},[]);
  useEffect(()=>{if(!narrowViewport)return;if(mobileNav){requestAnimationFrame(()=>sidebarRef.current?.querySelector('button')?.focus());}else if(mobileWasOpen.current){mobileMenuRef.current?.focus();}mobileWasOpen.current=mobileNav;},[mobileNav,narrowViewport]);
  const persist=(k,v)=>{try{localStorage.setItem('refs_'+k,JSON.stringify(v))}catch(e){}};
  useEffect(()=>{ const t=setTimeout(()=>persist('jes',jes), 400); return ()=>clearTimeout(t); },[jes]); useEffect(()=>{persist('exc',exceptions)},[exceptions]);
  useEffect(()=>{persist('close',closeTasks)},[closeTasks]); useEffect(()=>{persist('ap',ap)},[ap]);
  useEffect(()=>{persist('bank',bank)},[bank]); useEffect(()=>{persist('coa',coa)},[coa]); useEffect(()=>{persist('ar',ar)},[ar]);
  useEffect(()=>{persist('recurring',recurring)},[recurring]);
  useEffect(()=>{persist('documents',documents)},[documents]);
  useEffect(()=>{ if(userId) persist('user',userId); },[userId]);
  useEffect(()=>{ bumpId(Math.max(9000,...jes.map(j=>+j.je_id||0),...ap.bills.map(b=>+b.bill_id||0))); },[]);
  const refreshAuthority = async () => {const result=await refreshAuthoritativeDocuments({config:accountingApiConfig()});if(!result.ok){setApiStatus(result.code);return result;}setAp(result.ap);setAr(result.ar);setApiStatus('READY');return result;};
  useEffect(()=>{if(!userId||!accountingApiConfig())return;let active=true;refreshAuthority().then(result=>{if(active&&!result.ok)showToast(result.message,'bad');});return()=>{active=false;};},[userId]);
  useEffect(()=>{
    const h = (e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); setPalette(p=>!p);} if(e.key==='Escape'){setPalette(false);setMobileNav(false);} };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[]);

  const audit = (action, objectType, objectRef, detail) => repo.audit(userId, action, objectType, objectRef, detail);
  const ownedPeriod = je => resolveJEPeriod(PERIODS,je);
  const mkJE = (spec) => { const id = nextId(); const jeDate=spec?.je_date||'2026-07-31'; return {je_id:id, je_number:documentJENumber(jeDate,id), period_code:'2026-07', posting_status:'DRAFT', je_date:'2026-07-31', created_by:userId, history:[{a:'CREATE',by:userId,at:'2026-07-31'}], ...spec}; };
  const bankFailure = (txn, failure) => {
    const ref=txn?.external_id||'UNKNOWN_BANK_SOURCE';
    setExceptions(xs=>xs.some(e=>e.exception_type===failure.code&&e.object_ref===ref&&e.status!=='CLOSED')?xs:[buildBankWorkflowException({txn,failure,exceptionId:nextId(),entityId:entity||4}),...xs]);
    audit('BANK_WORKFLOW_BLOCKED','BANK_TXN',ref,`${failure.code} · ${failure.message||''}`);
    return failure;
  };
  const applyPostedSource = je => {
    if (je?.posting_status !== 'POSTED' || !je.source_object_type) return {ok:true,skipped:true};
    const result=applyPostedDocumentTransition({...sourceStateRef.current,je});
    if(!result.ok){setExceptions(xs=>xs.some(e=>e.exception_type===result.code&&e.object_type===je.source_object_type&&e.object_ref===String(je.source_object_id)&&e.status==='OPEN')?xs:[{exception_id:nextId(),exception_type:result.code,object_type:je.source_object_type,object_ref:String(je.source_object_id),status:'OPEN',occurred_date:'2026-07-31',severity:'HIGH',description:`Posted source synchronization blocked for ${je.je_number}`},...xs]);audit('SOURCE_STATUS_SYNC_BLOCKED',je.source_object_type,String(je.source_object_id),result.code);return result;}
    sourceStateRef.current={ap:result.ap,ar:result.ar};
    if (je.source_object_type === 'AP_BILL') setAp(result.ap);
    else if (je.source_object_type === 'AR_INVOICE') setAr(result.ar);
    audit('SOURCE_STATUS_SYNC',je.source_object_type,String(je.source_object_id),je.je_number);return result;
  };
  const actions = {
    newJE: () => {const auth=authorizeJECommand({can});if(!auth.ok){showToast(auth.message,'bad');return null;}const entityId=entity||2;const owned=ownedPeriod({entity_id:entityId,period_code:'2026-07'});if(!owned.ok||owned.period.status!=='OPEN'){const failure=owned.ok?{code:'4005',message:`Period ${owned.period.period_code} is ${owned.period.status}.`}:owned;showToast(failure.message,'bad');audit('CREATE_BLOCKED','JE','MANUAL',failure.code);return null;} const je = mkJE({entity_id:entityId, je_type:'MANUAL', description:'', source_system:'MAN', has_attachment:false,attachment_ids:[],
      lines:[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}]}); setJes(js=>[je,...js]);audit('CREATE','JE',je.je_number,'Manual Draft');return je.je_id; },
    newJEFromRule: (spec) => {const reservation=reserveJESources(jeActionLocks.current,[spec]);if(!reservation.ok){showToast(reservation.message,'bad');return null;}const release=()=>reservation.keys.forEach(key=>jeActionLocks.current.delete(key));const validation=validateNewJESpec({spec,existingJEs:jes,can});if(!validation.ok){release();showToast(validation.message,'bad');audit('CREATE_BLOCKED','JE',spec?.source_doc_id||'UNKNOWN',validation.code);return null;}const owned=ownedPeriod({entity_id:spec.entity_id,period_code:spec.period_code||'2026-07'});if(!owned.ok||owned.period.status!=='OPEN'){release();const failure=owned.ok?{code:'4005',message:`Period ${owned.period.period_code} is ${owned.period.status}.`}:owned;showToast(failure.message,'bad');audit('CREATE_BLOCKED','JE',spec.source_doc_id||'UNKNOWN',failure.code);return null;}const je = mkJE({...spec,posting_status:'DRAFT'});setJes(js=>[je,...js]);audit('CREATE','JE',je.je_number,`${je.source_system}:${je.source_doc_id}`);return je.je_id; },
    newJEBatch: specs => {const reservation=reserveJESources(jeActionLocks.current,specs);if(!reservation.ok)return reservation;const validation=validateNewJEBatch({specs,existingJEs:jes,periods:PERIODS,can});if(!validation.ok){reservation.keys.forEach(key=>jeActionLocks.current.delete(key));showToast(validation.message,'bad');audit('BATCH_CREATE_BLOCKED','JE_BATCH',specs?.[0]?.idempotency_key||'UNKNOWN',validation.code);return validation;}const created=specs.map(spec=>mkJE({...spec,posting_status:'DRAFT'}));setJes(js=>[...created,...js]);created.forEach(je=>audit('CREATE_BATCH_DRAFT','JE',je.je_number,`${je.source_system}:${je.source_doc_id}`));return {ok:true,je_ids:created.map(j=>j.je_id)};},
    updateJE: (id, producer) => {const auth=authorizeJECommand({can});if(!auth.ok)return auth;setJes(js=>js.map(j=>{ if(j.je_id!==id||j.posting_status!=='DRAFT') return j; const d=structuredClone(j); producer(d); d.dirty=true; return d; }));return {ok:true};},
    saveJE: (draft) => {const current=jes.find(j=>j.je_id===draft?.je_id);const key=`SAVE:${current?.je_id}:${current?.revision||0}`;if(jeActionLocks.current.has(key))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'This save is already processing.'};const result=saveJEDraft({current,draft,user});
      const auth=authorizeJECommand({can});if(!auth.ok)return auth;if(!result.ok)return result;jeActionLocks.current.add(key);setJes(js=>js.map(j=>j.je_id===draft.je_id?result.je:j));audit(result.je.history.at(-1)?.override?'SAVE_OVERRIDE':'SAVE','JE',result.je.je_number,`revision ${result.je.revision}`);return result;},
    saveAndAdvanceJE: async (draft,next,label) => {if(next==='POSTED')return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Browser-local state cannot post a journal entry; use the authoritative accounting API.'};const current=jes.find(j=>j.je_id===draft?.je_id);const key=`FLOW:${current?.je_id}:${current?.posting_status}:${next}`;if(jeActionLocks.current.has(key))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'This workflow action is already processing.'};const saved=saveJEDraft({current,draft,user});const auth=authorizeJECommand({can});if(!auth.ok)return auth;if(!saved.ok)return saved;const owned=ownedPeriod(saved.je);if(!owned.ok)return owned;jeActionLocks.current.add(key);const storage=await verifyStoredDocuments(saved.je,documents);if(!storage.ok){jeActionLocks.current.delete(key);return storage;}const result=transitionJE({je:saved.je,next,user,period:owned.period,documents,can,label,at:new Date().toISOString()});if(!result.ok){jeActionLocks.current.delete(key);return result;}
      const sourceSync=applyPostedSource(result.je);if(!sourceSync.ok){jeActionLocks.current.delete(key);return sourceSync;}setJes(js=>js.map(j=>j.je_id===draft.je_id?result.je:j));audit(label||next,'JE',result.je.je_number,`${current.posting_status} -> ${next}`);return result;},
    advanceJE: async (id,next,label) => {if(next==='POSTED')return {ok:false,code:'ACCOUNTING_API_UNAVAILABLE',message:'Browser-local state cannot post a journal entry; use the authoritative accounting API.'};const current=jes.find(j=>j.je_id===id);const key=`FLOW:${id}:${current?.posting_status}:${next}`;if(jeActionLocks.current.has(key))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'This workflow action is already processing.'};const owned=ownedPeriod(current);if(!owned.ok)return owned;jeActionLocks.current.add(key);const storage=await verifyStoredDocuments(current,documents);if(!storage.ok){jeActionLocks.current.delete(key);return storage;}const result=transitionJE({je:current,next,user,period:owned.period,documents,can,label,at:new Date().toISOString()});
      if(!result.ok){jeActionLocks.current.delete(key);return result;}const sourceSync=applyPostedSource(result.je);if(!sourceSync.ok){jeActionLocks.current.delete(key);return sourceSync;}setJes(js=>js.map(j=>j.je_id===id?result.je:j));audit(label||next,'JE',result.je.je_number,`${current.posting_status} -> ${next}`);return result;},
    rejectJE: (id,reason) => {const current=jes.find(j=>j.je_id===id);const key=`REJECT:${id}:${current?.posting_status}`;if(jeActionLocks.current.has(key))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'This reject is already processing.'};const result=rejectJETransition({je:current,user,reason,can});
      if(!result.ok)return result;jeActionLocks.current.add(key);setJes(js=>js.map(j=>j.je_id===id?result.je:j));audit('REJECT','JE',result.je.je_number,reason);return result;},
    copyJE: (id) => {const source=jes.find(j=>j.je_id===id);const auth=authorizeJECommand({can});if(!auth.ok)return auth;const owned=ownedPeriod(source);if(!owned.ok)return owned;if(owned.period.status!=='OPEN')return {ok:false,code:'4005',message:`Period ${owned.period.period_code} is ${owned.period.status}.`};const nid=nextId();const result=copyJEAsDraft({source,newId:nid,newNumber:'20260731'+String(nid).padStart(6,'0'),user});
      if(!result.ok)return result;setJes(js=>[result.je,...js]);audit('COPY','JE',result.je.je_number,`from ${source.je_number}`);return {ok:true,je_id:nid};},
    makeRecurringJE: (id,schedule='MONTHLY') => {const key=`RECURRING:${id}:${schedule}`;const source=jes.find(j=>j.je_id===id);const existing=recurring.find(r=>r.source_je_id===id&&r.schedule===schedule&&r.status==='ACTIVE');if(existing)return {ok:true,template:existing,idempotent:true};if(jeActionLocks.current.has(key))return {ok:false,code:'JE_DUPLICATE_ACTION',message:'This recurring template is already processing.'};const result=createRecurringTemplate({source,templateId:'REC-'+nextId(),user,schedule});
      const auth=authorizeJECommand({can});if(!auth.ok)return auth;if(!result.ok)return result;jeActionLocks.current.add(key);setRecurring(rs=>rs.some(r=>r.source_je_id===id&&r.schedule===schedule&&r.status==='ACTIVE')?rs:[result.template,...rs]);audit('CREATE_RECURRING','JE',source.je_number,result.template.template_id);return result;},
    reclassJE: (id) => {const source=jes.find(j=>j.je_id===id);const auth=authorizeJECommand({can});if(!auth.ok)return auth;const owned=ownedPeriod(source);if(!owned.ok)return owned;if(owned.period.status!=='OPEN')return {ok:false,code:'4005',message:`Period ${owned.period.period_code} is ${owned.period.status}.`};const nid=nextId();const result=createReclassDraft({source,newId:nid,newNumber:'20260731'+String(nid).padStart(6,'0'),user});
      if(!result.ok)return result;setJes(js=>[result.je,...js]);audit('RECLASS_DRAFT','JE',result.je.je_number,`from ${source.je_number}`);return {ok:true,je_id:nid};},
    reverseJE: (id) => {const source=jes.find(j=>j.je_id===id);const businessGuard=validateDocumentReversal(source);if(!businessGuard.ok){audit('REVERSE_BLOCKED','JE',source?.je_number||String(id),businessGuard.code);return businessGuard;}const owned=ownedPeriod(source);if(!owned.ok)return owned;const nid=nextId();const result=createReversal({source,newId:nid,user,period:owned.period,can});
      if(!result.ok)return result;setJes(js=>[result.reversal,...js.map(j=>j.je_id===id?result.source:j)]);audit('REVERSE','JE',source.je_number,result.reversal.je_number);return {ok:true,je_id:nid};},
    storeJEDocument: async (file,jeId) => {const auth=authorizeJECommand({can});if(!auth.ok)return auth;const allowed=['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];if(!file||file.size<1||file.size>25*1024*1024)return {ok:false,code:'JE_ATTACHMENT_SIZE',message:'Attachment must be between 1 byte and 25 MB.'};if(!allowed.includes((file.type||'').toLowerCase())||/[\\/\0-\x1f]/.test(file.name||''))return {ok:false,code:'JE_ATTACHMENT_TYPE',message:'Unsupported or unsafe attachment.'};const bytes=await file.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);const hex=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');const document_id='ATT-'+nextId();await putAttachmentBlob(document_id,file);const document={document_id,name:file.name.trim(),type:file.type.toLowerCase(),size:file.size,hash:`sha256:${hex}`,storage_ref:`indexeddb://refs-attachments/${document_id}`,storage_state:'STORED',uploaded_by:userId,uploaded_at:new Date().toISOString()};setDocuments(ds=>[document,...ds]);audit('ATTACH','JE','#'+jeId,`${document.document_id}:${document.hash}`);return {ok:true,document};},
    openJEDocument: async id => {const document=documents.find(d=>d.document_id===id);if(!document)return {ok:false,code:'JE_ATTACHMENT_REFERENCE',message:'Document metadata is missing.'};const blob=await getAttachmentBlob(id);if(!blob)return {ok:false,code:'JE_ATTACHMENT_BLOB',message:'Document content is missing.'};const url=URL.createObjectURL(blob);window.open(url,'_blank','noopener');setTimeout(()=>URL.revokeObjectURL(url),60000);audit('VIEW_ATTACHMENT','DOCUMENT',id,document.hash);return {ok:true};},
    ensureException: (spec) => setExceptions(xs=>{ if(xs.some(e=>e.exception_type===spec.exception_type && e.object_ref===spec.object_ref && e.status!=='CLOSED')) return xs;
      return [{exception_id:nextId(), occurred_date:'2026-07-31', aging_days:0, status:'OPEN', resolution:'', ...spec}, ...xs]; }),
    resolveException: (id, resolution) => setExceptions(xs=>xs.map(e=>e.exception_id===id?{...e, status:'CLOSED', resolution, closed_by:userId}:e)),
    signoffTask: (id) => setCloseTasks(ts=>ts.map(t=>t.close_task_id===id?{...t, status:'SIGNED_OFF', signed_off_by:userId}:t)),
    // ---- AP ----
    refreshAuthoritativeDocuments: refreshAuthority,
    transitionDocumentJournal: async (journalEntryId,revision,action) => {const result=await transitionAuthoritativeJournal({config:accountingApiConfig(),journalEntryId,revision,action});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?result:refreshed;},
    createApVendorCredit: async f => {const config=accountingApiConfig();if(!config)return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Vendor credits require the authoritative accounting API.'};const vendor=VENDORS.find(x=>x.vendor_id===f.vendor_id);const result=await createAuthoritativeAdjustment({config,kind:'AP_VENDOR_CREDIT',idempotencyKey:f.client_request_id,adjustment:{number:f.credit_number,date:f.credit_date,counterpartyRef:f.vendor_id,counterpartyName:vendor?.vendor_name||'',amount:f.amount,lines:[{line_no:1,account_code:f.account_code,amount:f.amount,description:f.reason}],reason:f.reason}});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,adjustment:result.data,idempotent:result.idempotent}:refreshed;},
    applyApVendorCredit: async f => {const config=accountingApiConfig();if(!config)return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Credit application requires the authoritative accounting API.'};const result=await applyAuthoritativeCredit({config,kind:'AP_VENDOR_CREDIT',businessAdjustmentId:f.business_adjustment_id,businessDocumentId:f.business_document_id,amount:f.amount,reason:f.reason,idempotencyKey:f.client_request_id});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,allocation:result.data,idempotent:result.idempotent}:refreshed;},
    createArCreditMemo: async f => {const config=accountingApiConfig();if(!config)return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Credit memos require the authoritative accounting API.'};const customer=CUSTOMERS.find(x=>x.customer_id===f.customer_id);const result=await createAuthoritativeAdjustment({config,kind:'AR_CREDIT_MEMO',idempotencyKey:f.client_request_id,adjustment:{number:f.memo_number,date:f.memo_date,counterpartyRef:f.customer_id,counterpartyName:customer?.customer_name||'',amount:f.amount,lines:[{line_no:1,account_code:f.account_code,amount:f.amount,description:f.reason}],reason:f.reason}});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,adjustment:result.data,idempotent:result.idempotent}:refreshed;},
    applyArCreditMemo: async f => {const config=accountingApiConfig();if(!config)return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Credit application requires the authoritative accounting API.'};const result=await applyAuthoritativeCredit({config,kind:'AR_CREDIT_MEMO',businessAdjustmentId:f.business_adjustment_id,businessDocumentId:f.business_document_id,amount:f.amount,reason:f.reason,idempotencyKey:f.client_request_id});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,allocation:result.data,idempotent:result.idempotent}:refreshed;},
    createArRefund: async f => {const config=accountingApiConfig();if(!config)return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Refunds require the authoritative accounting API.'};const result=await createAuthoritativeAdjustment({config,kind:'AR_REFUND',idempotencyKey:f.client_request_id,adjustment:{sourceAdjustmentId:f.source_adjustment_id,number:f.refund_number,date:f.refund_date,amount:f.amount,reason:f.reason}});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,adjustment:result.data,idempotent:result.idempotent}:refreshed;},
    addBill: async (f) => { const config=accountingApiConfig();if(config){const vendor=VENDORS.find(x=>x.vendor_id===f.vendor_id);const result=await createAuthoritativeBusinessDocument({config,kind:'AP_BILL',idempotencyKey:f.client_request_id,document:{documentNumber:f.invoice_no,counterpartyRef:f.vendor_id,counterpartyName:vendor?.vendor_name||'',currency:'USD',accountingDate:f.bill_date,dueDate:f.due_date,amount:f.amount,offsetAccountCode:f.account_code,description:f.lines?.map(line=>line.description).filter(Boolean).join(' / ')}});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,bill:result.data,idempotent:result.idempotent}:refreshed;}const auth=can('AP.INVOICE.CREATE');if(!auth)return {ok:false,code:'AP_PERMISSION_DENIED',message:'Missing permission AP.INVOICE.CREATE.'};const dup = ap.bills.find(b=>b.vendor_id===f.vendor_id && b.invoice_no.trim().toLowerCase()===f.invoice_no.trim().toLowerCase());
      if (dup){ setAp(s=>({...s, dupBlocked:(s.dupBlocked||0)+1})); return {dup:dup.bill_no}; }
      const id=nextId(); const v=VENDORS.find(x=>x.vendor_id===f.vendor_id);
      const bill={bill_id:id,bill_no:'BILL-2026-'+id,vendor_name:v.vendor_name,status:'PENDING_APPROVAL',created_by:userId,entity_id:entity||4,period_code:String(f.bill_date||'').slice(0,7),accounting_date:f.bill_date,...f};
      setAp(s=>({...s,bills:[bill,...s.bills]}));audit('CREATE','AP_BILL',bill.bill_no,`${bill.vendor_name}:${bill.amount}`);return {ok:true,bill}; },
    approveBill: (id) => {if(accountingApiConfig())return {ok:false,code:'ACCOUNTING_API_WRITE_REQUIRED',message:'Approve Bills through the authoritative accounting API.'};const actionKey=`DOC:AP_BILL:${id}:APPROVE`;if(jeActionLocks.current.has(actionKey))return {ok:false,code:'AP_DUPLICATE_ACTION',message:'Bill approval is already processing.'};jeActionLocks.current.add(actionKey);const release=()=>jeActionLocks.current.delete(actionKey);const bill=ap.bills.find(x=>x.bill_id===id);const normalized=bill?{...bill,entity_id:bill.entity_id||entity||4,period_code:bill.period_code||'2026-07',accounting_date:bill.accounting_date||bill.bill_date,lines:bill.lines?.length?bill.lines:[{account_code:bill.account_code,amount:bill.amount,description:bill.invoice_no,property_id:bill.property_id}]}:bill;const owned=ownedPeriod(normalized);const jeId=nextId();const result=approveBillCommand({bill:normalized,user,can,period:owned.ok?owned.period:null,existingJEs:jes,jeId,jeNumber:documentJENumber(normalized?.accounting_date,jeId)});
      if(!result.ok){release();audit('APPROVE_BLOCKED','AP_BILL',String(id),result.code);return result;}const errs=validateJE(result.draftJE,owned.period);if(errs.length){release();const failure={ok:false,code:errs[0].code,message:errs[0].msg};audit('APPROVE_BLOCKED','AP_BILL',String(id),failure.code);return failure;}setJes(js=>[result.draftJE,...js]);setAp(s=>({...s,bills:s.bills.map(x=>x.bill_id===id?result.nextDocument:x)}));audit('CREATE_DRAFT','AP_BILL',result.nextDocument.bill_no,result.draftJE.source_doc_id);return result; },
    payBills: async (ids,bankMember='Operating Cash_BA-003',paymentDate='2026-07-31') => {const config=accountingApiConfig();if(config){const results=[];for(const id of ids){const bill=ap.bills.find(row=>row.bill_id===id);const result=await createAuthoritativeSettlement({config,kind:'AP_PAYMENT',businessDocumentId:id,accountingDate:paymentDate,amount:bill?.open_balance,idempotencyKey:`AP-PAY-${id}-${paymentDate}`});results.push({...result,id});}const refreshed=results.every(result=>result.ok)?await refreshAuthority():null;return refreshed&&!refreshed.ok?refreshed:{ok:results.some(result=>result.ok),created:results.filter(result=>result.ok).length,blocked:results.filter(result=>!result.ok).length,results};}let nextJes=[...jes];let nextBills=ap.bills.map(b=>({...b}));const results=[];const paymentPeriodCode=String(paymentDate).slice(0,7);for(const id of ids){const actionKey=`DOC:AP_BILL:${id}:PAY`;if(jeActionLocks.current.has(actionKey)){results.push({ok:false,id,code:'AP_DUPLICATE_ACTION',message:'Bill payment is already processing.'});continue;}jeActionLocks.current.add(actionKey);const index=nextBills.findIndex(x=>x.bill_id===id);const bill=index>=0?{...nextBills[index],entity_id:nextBills[index].entity_id||entity||4,bank_member:bankMember}:null;const owned=ownedPeriod({entity_id:bill?.entity_id,period_code:paymentPeriodCode});const jeId=nextId();const paymentId=`PAY-${id}-${jeId}`;const result=payBillCommand({bill,user,can,period:owned.ok?owned.period:null,existingJEs:nextJes,jeId,jeNumber:documentJENumber(paymentDate,jeId),paymentId,paymentDate,paymentPeriodCode});if(result.ok){const errs=validateJE(result.draftJE,owned.period);if(errs.length){jeActionLocks.current.delete(actionKey);results.push({ok:false,id,code:errs[0].code,message:errs[0].msg});continue;}nextJes=[result.draftJE,...nextJes];nextBills[index]=result.nextDocument;results.push({...result,id});}else{jeActionLocks.current.delete(actionKey);results.push({...result,id});}}
      const created=results.filter(r=>r.ok).length;if(created){setJes(nextJes);setAp(s=>({...s,bills:nextBills}));}results.forEach(r=>audit(r.ok?'CREATE_PAYMENT_DRAFT':'PAYMENT_BLOCKED','AP_BILL',String(r.id),r.ok?r.draftJE.source_doc_id:r.code));return {ok:created>0,created,blocked:results.length-created,results}; },
    addInvoice: async (f) => {const config=accountingApiConfig();if(config){const customer=CUSTOMERS.find(x=>x.customer_id===f.customer_id);const result=await createAuthoritativeBusinessDocument({config,kind:'AR_INVOICE',idempotencyKey:`AR-INVOICE-${f.client_request_id}`,document:{documentNumber:f.memo||f.client_request_id,counterpartyRef:f.customer_id,counterpartyName:customer?.customer_name||'',currency:'USD',accountingDate:f.inv_date,dueDate:f.due_date,amount:f.amount,offsetAccountCode:'411100',description:f.memo}});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?{ok:true,invoice:result.data,idempotent:result.idempotent}:refreshed;}const actionKey=`DOC:AR_CREATE:${f?.client_request_id||'MISSING'}`;if(jeActionLocks.current.has(actionKey))return {ok:false,code:'AR_DUPLICATE_ACTION',message:'Invoice creation is already processing.'};jeActionLocks.current.add(actionKey);const release=()=>jeActionLocks.current.delete(actionKey);const id=nextId();const c=CUSTOMERS.find(x=>x.customer_id===f.customer_id);const invoice={inv_id:id,inv_no:'INV-2026-'+id,customer_name:c?.customer_name,status:'DRAFT',created_by:userId,entity_id:entity||4,period_code:String(f.inv_date||'').slice(0,7),accounting_date:f.inv_date,...f};const owned=ownedPeriod(invoice);const jeId=nextId();const result=createInvoiceCommand({invoice,user,can,period:owned.ok?owned.period:null,existingJEs:jes,jeId,jeNumber:documentJENumber(invoice.accounting_date,jeId)});if(!result.ok){release();audit('CREATE_BLOCKED','AR_INVOICE',invoice.inv_no,result.code);return result;}const errs=validateJE(result.draftJE,owned.period);if(errs.length){release();return {ok:false,code:errs[0].code,message:errs[0].msg};}setJes(js=>[result.draftJE,...js]);setAr(s=>({...s,invoices:[result.nextDocument,...s.invoices]}));audit('CREATE_DRAFT','AR_INVOICE',invoice.inv_no,result.draftJE.source_doc_id);return result; },
    receivePayment: async (id,bankMember='Operating Cash_BA-003',paymentDate='2026-07-31') => {const config=accountingApiConfig();if(config){const invoice=ar.invoices.find(row=>row.inv_id===id);const result=await createAuthoritativeSettlement({config,kind:'AR_RECEIPT',businessDocumentId:id,accountingDate:paymentDate,amount:invoice?.open_balance,idempotencyKey:`AR-RCPT-${id}-${paymentDate}`});if(!result.ok)return result;const refreshed=await refreshAuthority();return refreshed.ok?result:refreshed;}const actionKey=`DOC:AR_INVOICE:${id}:RECEIVE`;if(jeActionLocks.current.has(actionKey))return {ok:false,code:'AR_DUPLICATE_ACTION',message:'Invoice receipt is already processing.'};jeActionLocks.current.add(actionKey);const release=()=>jeActionLocks.current.delete(actionKey);const source=ar.invoices.find(i=>i.inv_id===id);const invoice=source?{...source,entity_id:source.entity_id||entity||4,bank_member:bankMember}:null;const paymentPeriodCode=String(paymentDate).slice(0,7);const owned=ownedPeriod({entity_id:invoice?.entity_id,period_code:paymentPeriodCode});const jeId=nextId();const paymentId=`RCPT-${id}-${jeId}`;const result=receivePaymentCommand({invoice,user,can,period:owned.ok?owned.period:null,existingJEs:jes,jeId,jeNumber:documentJENumber(paymentDate,jeId),paymentId,paymentDate,paymentPeriodCode});if(!result.ok){release();audit('PAYMENT_BLOCKED','AR_INVOICE',String(id),result.code);return result;}const errs=validateJE(result.draftJE,owned.period);if(errs.length){release();return {ok:false,code:errs[0].code,message:errs[0].msg};}setJes(js=>[result.draftJE,...js]);setAr(s=>({...s,invoices:s.invoices.map(i=>i.inv_id===id?result.nextDocument:i)}));audit('CREATE_PAYMENT_DRAFT','AR_INVOICE',String(id),result.draftJE.source_doc_id);return result; },
    legacyBankExclude: (acctCode, txnId) => { audit('EXCLUDE','BANK_TXN','#'+txnId,''); setBank(s=>{const a=structuredClone(s); const t=a.accounts[acctCode].txns.find(x=>x.bank_txn_id===txnId); t.ui_status='Excluded'; return a;}); },
    legacyBankUndo: (acctCode, txnId) => setBank(s=>{const a=structuredClone(s); const acc=a.accounts[acctCode]; const t=acc.txns.find(x=>x.bank_txn_id===txnId);
      if(t.match_status==='MATCHED'){ const adj=t.direction==='CREDIT'?t.amount:-t.amount; acc.recorded_adj=(acc.recorded_adj||0)-adj; }
      t.ui_status=null; t.match_status='UNMATCHED'; t.matched_je=null; return a;}),
    // ---- Bank ----
    legacyBankRecord: (acctCode, txnId) => setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
      const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED';
      const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj;
      t.matched_je = t.suggest==='FEE'?'Dr Bank Fee / Cr Cash':'Dr Cash / Cr Interest Income'; return a; }),
    legacyBankMatch: (acctCode, txnId) => setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
      const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='手工匹配';
      const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; }),
    legacyBankSuspense: (acctCode, txnId) => { setBank(s=>{ const a=structuredClone(s); const acc=a.accounts[acctCode];
        const t=acc.txns.find(x=>x.bank_txn_id===txnId); t.match_status='MATCHED'; t.matched_je='→ 9000 Suspense';
        const adj = t.direction==='CREDIT'? t.amount : -t.amount; acc.recorded_adj=(acc.recorded_adj||0)+adj; return a; });
      actions.ensureException({exception_type:'SUSPENSE_BALANCE', severity:'MEDIUM', object_type:'BANK_TXN', object_ref:'txn#'+txnId, entity_id:entity||4, owner:'TREASURY', root_cause:'银行交易无法识别，暂挂 Suspense'}); },
    bankCreateDraft: (acctCode,txnId,spec) => {
      const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      const sourceKey=txn?.external_id||`${acctCode}:${txnId}`;
      if(bankSubmitLocks.current.has(sourceKey)) return bankFailure(txn,{ok:false,code:'BANK_DUPLICATE_SOURCE',message:'This source is already being processed.'});
      const validation=validateBankDraft({txn,spec,jes});
      if(!validation.ok) return bankFailure(txn,validation);
      bankSubmitLocks.current.add(sourceKey);
      const je=mkJE({...spec,posting_status:'DRAFT'});
      const result=createBankDraftTransition({bank,jes,acctCode,txnId,spec,je});
      if(!result.ok){bankSubmitLocks.current.delete(sourceKey);return bankFailure(txn,result);}
      setBank(result.bank);setJes(result.jes);
      audit('CREATE_DRAFT','BANK_TXN',sourceKey,`${je.je_number} · ${spec.rule_code}`);
      return {ok:true,je_id:je.je_id,je_number:je.je_number};
    },
    bankMatch: (acctCode,txnId,candidate) => {
      const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      const sourceKey=txn?.external_id||`${acctCode}:${txnId}`;
      if(bankSubmitLocks.current.has(sourceKey)) return bankFailure(txn,{ok:false,code:'BANK_MATCH_OCCUPIED',message:'This source is already being processed.'});
      const result=matchBankTransition({bank,jes,acctCode,txnId,candidate,entityId:entity||4,userId});
      if(!result.ok) return bankFailure(txn,result);
      bankSubmitLocks.current.add(sourceKey);setBank(result.bank);
      audit('MATCH','BANK_TXN',sourceKey,`${candidate.je_number} · cash line ${candidate.cash_line_index+1}`);
      return {ok:true,je_number:candidate.je_number};
    },
    bankBatchAccept: (acctCode,items) => {
      const ready=[];const preblocked=[];
      items.forEach(item=>{const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===item.txnId);const key=txn?.external_id||`${acctCode}:${item.txnId}`;
        if(bankSubmitLocks.current.has(key))preblocked.push({...bankFailure(txn,{ok:false,code:'BANK_DUPLICATE_SOURCE',message:'This source is already being processed.'}),txnId:item.txnId,mode:item.mode});
        else ready.push(item);});
      const batch=batchBankTransition({bank,jes,acctCode,items:ready,entityId:entity||4,userId,makeJE:spec=>mkJE({...spec,posting_status:'DRAFT'})});
      if(batch.ok){setBank(batch.bank);setJes(batch.jes);}
      batch.results.forEach(result=>{const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===result.txnId);
        if(result.ok){bankSubmitLocks.current.add(txn.external_id);audit(result.mode==='MATCH'?'MATCH':'CREATE_DRAFT','BANK_TXN',txn.external_id,result.je_number||result.je?.je_number||'Batch accepted');}
        else bankFailure(txn,result);});
      const results=[...batch.results,...preblocked];
      return {ok:results.some(r=>r.ok),results,created:results.filter(r=>r.ok&&r.mode==='DRAFT').length,matched:results.filter(r=>r.ok&&r.mode==='MATCH').length,blocked:results.filter(r=>!r.ok).length};
    },
    bankUndo: (acctCode,txnId) => {
      const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      const result=undoBankTransition({bank,jes,acctCode,txnId});
      if(!result.ok) return bankFailure(txn,result);
      setBank(result.bank);setJes(result.jes);bankSubmitLocks.current.delete(txn.external_id);
      audit(result.kind,'BANK_TXN',txn.external_id,'Controlled bank workflow undo');return result;
    },
    bankExclude: (acctCode,txnId) => {
      const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      if(bankSubmitLocks.current.has(txn?.external_id)) return bankFailure(txn,{ok:false,code:'BANK_SOURCE_ALREADY_PROCESSED',message:'Undo the current workflow before excluding this source.'});
      const result=excludeBankTransition({bank,jes,acctCode,txnId});if(!result.ok)return bankFailure(txn,result);setBank(result.bank);
      audit('EXCLUDE','BANK_TXN',txn.external_id,'Excluded from books; no JE created');return {ok:true};
    },
    bankRecord: (acctCode,txnId) => {const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      const account=txn.suggest==='FEE'?'651000':txn.suggest==='INTEREST'?'449200':'';
      return actions.bankCreateDraft(acctCode,txnId,buildBankDraft({...txn,entity_id:entity||4},acctCode,[{account_code:account,amount:txn.amount,memo:txn.reference}]));},
    bankSuspense: (acctCode,txnId) => {const txn=bank.accounts[acctCode].txns.find(t=>t.bank_txn_id===txnId);
      const result=actions.bankCreateDraft(acctCode,txnId,buildBankDraft({...txn,entity_id:entity||4},acctCode,[{account_code:'142000',amount:txn.amount,memo:'Temporary suspense pending investigation'}]));
      if(result.ok) actions.ensureException({exception_type:'SUSPENSE_BALANCE',severity:'MEDIUM',object_type:'BANK_TXN',object_ref:txn.external_id,entity_id:entity||4,owner:'TREASURY',root_cause:'Draft JE uses 142000 Suspense; investigation required'});return result;},
    bankSignoff: (acctCode) => setBank(s=>({...s, history:[{id:Date.now(), account:acctCode, period:s.accounts[acctCode].period, diff:0, by:userId, at:'2026-07-31'}, ...s.history]})),
    // ---- COA ----
    addAccount: (f) => { if (coa.some(a=>a.account_code===f.account_code)) return {dup:true};
      setCoa(cs=>[...cs, f].sort((a,b)=>a.account_code.localeCompare(b.account_code))); return {ok:true}; },
    toggleAccount: (code) => setCoa(cs=>cs.map(a=>a.account_code===code?{...a, inactive:!a.inactive}:a)),
    resetData: () => { repo.reset(); location.reload(); },
    logout: () => { try{localStorage.removeItem('refs_user')}catch(e){} setUserId(null); },
  };

  delete actions.legacyBankExclude;
  delete actions.legacyBankUndo;
  delete actions.legacyBankRecord;
  delete actions.legacyBankMatch;
  delete actions.legacyBankSuspense;

  if (!user) return <Login onLogin={setUserId} />;

  const isAdmin = ADMIN_ROLES.includes(user.role_code);
  const nav = NAV.filter(g=>!g.adminOnly || isAdmin);
  const flat = nav.flatMap(g=>g.items.map(([k,l])=>[k,'·',l]));
  const ctx = {jes, exceptions, closeTasks, ap, ar, bank, coa, recurring, documents, user, entity, period, can, actions, apiStatus, authoritativeMode:!!accountingApiConfig(), toast:showToast, goto:navigate, setJEDirty, requestLeaveJE};
  const Comp = COMP[route] || Dashboard;
  const paletteItems = flat.filter(([k,ic,l])=>l.toLowerCase().includes(q.toLowerCase())||k.includes(q.toLowerCase()));
  const jeHits = q.length>=3 ? jes.filter(j=>(j.je_number||'').includes(q)||((j.payee||'').toLowerCase().includes(q.toLowerCase()))).slice(0,5) : [];

  return <div className="app">
    {narrowViewport&&mobileNav&&<button className="mobile-nav-scrim" aria-label="Close navigation" onClick={()=>setMobileNav(false)}/>}
    <aside ref={sidebarRef} onKeyDown={trapMobileNav} className={`sidebar ${mobileNav?'mobile-open':''}`} aria-hidden={narrowViewport&&!mobileNav}>
      <div className="brand"><span className="logo">◈</span> REFS<span className="brand-sub">WanBridge</span></div>
      <button className="new-btn" onClick={()=>setNewMenu(true)}>＋ New 新建</button>
      <nav id="primary-navigation">{nav.map(g=>{ const opened = openGroups[g.group] ?? g.items.some(([k])=>route===k);
        return <div key={g.group} className="nav-group">
        <button className="nav-group-h" onClick={()=>setOpenGroups(o=>({...o,[g.group]:!opened}))}>
          <span className="nav-ic">{g.icon}</span>{g.group}<span className="nav-caret">{opened?'▾':'▸'}</span></button>
        {opened && g.items.map(([k,l])=><button key={k} className={`nav-item nav-sub ${route===k?'nav-on':''}`} onClick={()=>navigate(k)}>{l}</button>)}
      </div>;})}</nav>
    </aside>
    <div className="main">
      <header className="topbar">
        <button ref={mobileMenuRef} className="icon-btn mobile-menu" aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded={mobileNav} onClick={()=>setMobileNav(true)}>☰</button>
        <span className={`badge ${apiStatus==='READY'?'badge-ok':'badge-warn'}`} title={apiStatus==='READY'?'AP and AR documents are refreshed from the authoritative accounting API.':'Browser-local state is not a production accounting API.'}>{apiStatus==='READY'?'AUTHORITATIVE_READ_CONNECTED':'LOCAL_PROTOTYPE — NOT FOR POSTING'}</span>
        <label className="sw"><select value={entity} onChange={e=>setEntity(+e.target.value)}><option value={0}>全部实体 All Entities</option>{ENTITIES.map(en=><option key={en.entity_id} value={en.entity_id}>{en.entity_code} {en.entity_name}</option>)}</select></label>
        <button className="cmdk" onClick={()=>setPalette(true)}>⌘K 全局搜索 / 跳转</button>
        <div className="top-right">
          <span className="muted sm" title={`Built ${BUILD_TIME}`}>build {BUILD_SHA} · {BUILD_TIME.slice(0,16).replace('T',' ')}Z</span>
          <span className="sw">期间 <b>2026-07</b> <span className={`badge badge-${period.status==='OPEN'?'ok':'muted'}`}>{period.status}</span></span>
          <button className="icon-btn" title="帮助" onClick={()=>showToast('帮助中心(原型)')}>?</button>
          {accountingApiConfig()&&<button className="icon-btn" title="Refresh authoritative AP/AR records" onClick={async()=>{const result=await actions.refreshAuthoritativeDocuments();showToast(result.ok?'Authoritative AP/AR records refreshed.':result.message,result.ok?'ok':'bad');}}>↻</button>}
          <button className="icon-btn" title="通知" onClick={()=>navigate('exceptions')}>🔔</button>
          <button className="icon-btn" onClick={()=>actions.resetData()} title="重置演示数据">⟲</button>
          <button className="icon-btn" onClick={()=>setDark(d=>!d)} title="明/暗">{dark?'☀':'☾'}</button>
          <span className="muted" style={{fontSize:10.5,opacity:.7}} title="commit · build time">{typeof window!=='undefined'&&window.__BUILD?`${window.__BUILD.sha} · ${window.__BUILD.time}`:''}</span>
          <div className="user-chip" title={'角色 '+user.role_code}>
            <span className="user-av">{user.name[0]}</span>
            <span className="user-nm">{user.name}<span className="muted sm"> · {user.role_code}</span></span>
            <button className="link-btn" onClick={actions.logout}>退出</button>
          </div>
        </div>
      </header>
      <main className="content"><ErrorBoundary routeKey={route}><Comp ctx={ctx} /></ErrorBoundary></main>
    </div>
    {newMenu && <div className="newmenu-scrim" onClick={()=>setNewMenu(false)}>
      <div className="newmenu" onClick={e=>e.stopPropagation()}>
        <div><h5>总账 Accounting</h5>
          <button onClick={()=>{const id=actions.newJE();if(id)navigate('je');setNewMenu(false);}}>Journal Entry 手工分录</button>
          <button onClick={()=>{navigate('coa'); setNewMenu(false);}}>Account 科目</button>
          <button onClick={()=>{navigate('close'); setNewMenu(false);}}>Close Task 月结任务</button></div>
        <div><h5>支出 Expenses</h5>
          <button onClick={()=>{navigate('ap'); setNewMenu(false);}}>Bill 应付账单</button>
          <button onClick={()=>{navigate('checks'); setNewMenu(false);}}>Check 支票</button>
          <button onClick={()=>{navigate('ap'); setNewMenu(false);}}>Pay Bills 付款批次</button></div>
        <div><h5>房地产 Real Estate</h5>
          <button onClick={()=>{navigate('loan'); setNewMenu(false);}}>Loan Draw 提款</button>
          <button onClick={()=>{navigate('pmpickup'); setNewMenu(false);}}>PM Pickup 批次</button>
          <button onClick={()=>{navigate('closing'); setNewMenu(false);}}>Closing 交割</button></div>
        <div><h5>其他 Other</h5>
          <button onClick={()=>{navigate('bankrec'); setNewMenu(false);}}>Reconcile 对账</button>
          <button onClick={()=>{navigate('exceptions'); setNewMenu(false);}}>Exception 异常</button>
          <button onClick={()=>{navigate('reports'); setNewMenu(false);}}>Report 报表</button></div>
      </div>
    </div>}
    {palette && <div className="pal-scrim" onClick={()=>setPalette(false)}>
      <div className="pal" onClick={e=>e.stopPropagation()}>
        <input autoFocus placeholder="跳转到模块…" value={q} onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&paletteItems[0]){navigate(paletteItems[0][0]); setPalette(false); setQ('');}}}/>
        <div className="pal-list">{jeHits.map(j=><button key={'je'+j.je_id} onClick={()=>{navigate('je'); setPalette(false); setQ('');}}>✎ {j.je_number} · {(j.payee||j.description||'').slice(0,30)}<span className="muted sm">JE</span></button>)}{paletteItems.map(([k,ic,l])=>
          <button key={k} onClick={()=>{navigate(k); setPalette(false); setQ('');}}>{ic} {l}<span className="muted sm">{k}</span></button>)}</div>
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
      {can('GL.JE.APPROVE') && <button className="btn btn-primary btn-sm" onClick={async()=>{const result=await actions.advanceJE(j.je_id,j.posting_status==='PENDING_REVIEW'?'PENDING_APPROVAL':'APPROVED','APPROVE');toast(result?.ok?'JE advanced':result?.message||'Approval blocked.',result?.ok?'ok':'bad');}}>Approve</button>}</span></div>)}
    {pj.length===0 && <div className="empty">没有待审批分录</div>}
    <h3 style={{fontSize:17, marginTop:22}}>Bills ({pb.length})</h3>
    {pb.map(b=><div key={b.bill_id} className="appr-row"><span>{b.bill_no} · {b.vendor_name} · ${b.amount.toLocaleString()}</span>
      <span className="row-acts"><button className="btn btn-sm" onClick={()=>goto('ap')}>Open</button>
      {can('AP.INVOICE.APPROVE') && <button className="btn btn-primary btn-sm" onClick={()=>{const result=actions.approveBill(b.bill_id);toast(result?.ok?'Bill approved · Draft JE created':result?.message||'Bill approval blocked',result?.ok?'ok':'bad');}}>Approve</button>}</span></div>)}
    {pb.length===0 && <div className="empty">没有待审批 Bill</div>}
  </div>;
}

export { App };
if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App/>);
}
