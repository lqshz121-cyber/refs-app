import { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Toast } from './ui.jsx';
import { ENTITIES, USERS, PERIODS } from './data.js';
import { JOURNAL_ENTRIES, EXCEPTIONS, CLOSE_TASKS, nextId } from './seed.js';
import { jeTotals } from './engine.js';
import { Dashboard, JEWorkspace, LoanWorkspace, PMPickup, ClosingWorkspace, BankRec, ExceptionCenter, CloseMgmt } from './modules-core.jsx';
import { GLTrialBalance, Reports, APModule, ARModule, CashModule, LoanRegister, ProjectCost, Assets, Intercompany, IntegrationHub, MasterData, MappingCenter, RuleCenter, AdminModule } from './modules-more.jsx';

// ---- Permission model ----
const ROLE_PERMS = {
  CONTROLLER: '*',
  ACCT_MANAGER: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.APPROVE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF','PERIOD.PERIOD.CLOSE'],
  SENIOR_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW','GL.JE.POST','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF'],
  STAFF_ACCT: ['GL.JE.CREATE','GL.JE.REVIEW'],
  PROJECT_ACCT: ['GL.JE.CREATE','PERIOD.CLOSE.SIGNOFF'],
  PROPERTY_ACCT: ['GL.JE.CREATE','EXCEPTION.EXC.CLOSE','PERIOD.CLOSE.SIGNOFF'],
  TREASURY: ['GL.JE.CREATE'], AP: ['GL.JE.CREATE'], AR: ['GL.JE.CREATE'],
  REVIEWER: ['GL.JE.REVIEW','GL.JE.APPROVE'],
  AUDITOR: [], READ_ONLY: [], SYS_ADMIN: [],
};

const NAV = [
  {group:'工作台', items:[['dashboard','财务首页']]},
  {group:'总账', items:[['je','Journal Entry'],['gl','Trial Balance / 报表']]},
  {group:'房地产', items:[['loan','Construction Loan'],['loanreg','Loan Register'],['pmpickup','PM Pickup'],['closing','Closing'],['cost','Project Cost'],['assets','资产与物业']]},
  {group:'交易', items:[['ap','应付 AP'],['ar','应收 AR'],['cash','资金 Cash'],['bankrec','Bank Reconciliation'],['intercompany','Intercompany']]},
  {group:'治理', items:[['integration','Integration Hub'],['masterdata','Master Data'],['mapping','Mapping Center'],['rules','Rule Center']]},
  {group:'运营', items:[['exceptions','Exception Center'],['close','Month-End Close'],['reports','报表中心'],['admin','System Admin']]},
];
const COMP = {
  dashboard:Dashboard, je:JEWorkspace, gl:GLTrialBalance, loan:LoanWorkspace, loanreg:LoanRegister,
  pmpickup:PMPickup, closing:ClosingWorkspace, cost:ProjectCost, assets:Assets, ap:APModule, ar:ARModule,
  cash:CashModule, bankrec:BankRec, intercompany:Intercompany, integration:IntegrationHub, masterdata:MasterData,
  mapping:MappingCenter, rules:RuleCenter, exceptions:ExceptionCenter, close:CloseMgmt, reports:Reports, admin:AdminModule,
};
const FLAT = NAV.flatMap(g=>g.items);

export function App() {
  const [route, setRoute] = useState('dashboard');
  const [jes, setJes] = useState(JOURNAL_ENTRIES);
  const [exceptions, setExceptions] = useState(EXCEPTIONS);
  const [closeTasks, setCloseTasks] = useState(CLOSE_TASKS);
  const [userId, setUserId] = useState('ricky');
  const [entity, setEntity] = useState(2);
  const [dark, setDark] = useState(false);
  const [toast, setToast] = useState(null);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState('');

  const user = USERS.find(u=>u.user_id===userId);
  const period = PERIODS.find(p=>p.entity_id===entity && p.period_code==='2026-07') || {period_code:'2026-07', status:'OPEN'};
  const showToast = (msg,tone='ok') => { setToast({msg,tone}); setTimeout(()=>setToast(null),2600); };
  const can = (perm) => { const p = ROLE_PERMS[user.role_code]; return p==='*' || (p||[]).includes(perm); };

  useEffect(()=>{ document.body.className = dark?'dark':''; },[dark]);
  useEffect(()=>{
    const h = (e)=>{ if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault(); setPalette(p=>!p);} if(e.key==='Escape') setPalette(false); };
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h);
  },[]);

  const actions = {
    newJE: () => {
      const id = nextId();
      setJes(js=>[{je_id:id, je_number:'JE-2026-07-'+id, entity_id:entity, period_code:'2026-07', je_type:'MANUAL',
        je_date:'2026-07-31', description:'新建手工分录', source_system:'MAN', posting_status:'DRAFT', has_attachment:false,
        created_by:userId, lines:[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}]}, ...js]);
      return id;
    },
    newJEFromRule: (spec) => {
      const id = nextId();
      setJes(js=>[{je_id:id, je_number:'JE-2026-07-'+id, period_code:'2026-07', posting_status:'DRAFT', je_date:'2026-07-31', created_by:userId, ...spec}, ...js]);
      return id;
    },
    updateJE: (id, producer) => setJes(js=>js.map(j=>{ if(j.je_id!==id) return j; const d=structuredClone(j); producer(d); return d; })),
    advanceJE: (id, next, actionLabel) => setJes(js=>js.map(j=>{
      if(j.je_id!==id) return j;
      // SoD: Maker != Approver/Poster
      if((next==='APPROVED'||next==='POSTED') && j.created_by===userId && user.role_code!=='CONTROLLER'){
        showToast('SoD 拦截 (4009)：创建人不可审批/过账本分录','bad'); return j;
      }
      return {...j, posting_status:next};
    })),
    reverseJE: (id) => setJes(js=>{
      const src = js.find(j=>j.je_id===id); const nid=nextId();
      const rev = {...structuredClone(src), je_id:nid, je_number:'JE-REV-'+nid, posting_status:'POSTED', je_type:'REVERSAL',
        description:'红字反冲: '+src.description, lines:src.lines.map(l=>({...l, debit_amount:l.credit_amount, credit_amount:l.debit_amount}))};
      return js.map(j=>j.je_id===id?{...j, posting_status:'REVERSED'}:j).concat(rev);
    }),
    ensureException: (spec) => setExceptions(xs=>{
      if(xs.some(e=>e.exception_type===spec.exception_type && e.object_ref===spec.object_ref && e.status!=='CLOSED')) return xs;
      return [{exception_id:nextId(), occurred_date:'2026-07-31', aging_days:0, status:'OPEN', resolution:'', ...spec}, ...xs];
    }),
    resolveException: (id, resolution) => setExceptions(xs=>xs.map(e=>e.exception_id===id?{...e, status:'CLOSED', resolution, closed_by:userId}:e)),
    signoffTask: (id) => setCloseTasks(ts=>ts.map(t=>t.close_task_id===id?{...t, status:'SIGNED_OFF', signed_off_by:userId}:t)),
  };

  const ctx = {jes, exceptions, closeTasks, user, entity, period, can, actions, toast:showToast, goto:setRoute};
  const Comp = COMP[route] || Dashboard;
  const paletteItems = FLAT.filter(([k,l])=>l.toLowerCase().includes(q.toLowerCase())||k.includes(q.toLowerCase()));

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="logo">◈</span> REFS<span className="brand-sub">WanBridge</span></div>
      <nav>{NAV.map(g=><div key={g.group} className="nav-group">
        <div className="nav-group-t">{g.group}</div>
        {g.items.map(([k,l])=><button key={k} className={`nav-item ${route===k?'nav-on':''}`} onClick={()=>setRoute(k)}>{l}</button>)}
      </div>)}</nav>
    </aside>
    <div className="main">
      <header className="topbar">
        <button className="cmdk" onClick={()=>setPalette(true)}>⌘K 搜索 / 跳转</button>
        <div className="top-right">
          <label className="sw">实体
            <select value={entity} onChange={e=>setEntity(+e.target.value)}>{ENTITIES.map(en=><option key={en.entity_id} value={en.entity_id}>{en.entity_code} {en.entity_name}</option>)}</select>
          </label>
          <span className="sw">期间 <b>2026-07</b> <span className={`badge badge-${period.status==='OPEN'?'ok':'muted'}`}>{period.status}</span></span>
          <label className="sw">角色
            <select value={userId} onChange={e=>setUserId(e.target.value)}>{USERS.map(u=><option key={u.user_id} value={u.user_id}>{u.name}</option>)}</select>
          </label>
          <button className="icon-btn" onClick={()=>setDark(d=>!d)} title="明/暗">{dark?'☀':'☾'}</button>
        </div>
      </header>
      <main className="content"><Comp ctx={ctx} /></main>
    </div>
    {palette && <div className="pal-scrim" onClick={()=>setPalette(false)}>
      <div className="pal" onClick={e=>e.stopPropagation()}>
        <input autoFocus placeholder="跳转到模块…" value={q} onChange={e=>setQ(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&paletteItems[0]){setRoute(paletteItems[0][0]); setPalette(false); setQ('');}}}/>
        <div className="pal-list">{paletteItems.map(([k,l])=>
          <button key={k} onClick={()=>{setRoute(k); setPalette(false); setQ('');}}>{l} <span className="muted sm">{k}</span></button>)}</div>
      </div>
    </div>}
    {toast && <Toast msg={toast.msg} tone={toast.tone} />}
  </div>;
}

if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App/>);
}
