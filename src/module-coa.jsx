import { useEffect, useState } from 'react';
import { Btn, Badge, Money, Table, Drawer, Field, SectionTitle } from './ui.jsx';
import { trialBalance } from './engine.js';
import { WBS_COA_FULL } from './coa-wbs.js';
import { Tabs } from './ui.jsx';
import { chartAccountControlState, chartAccountDrill, chartAccountScope } from './chart-account-actions.js';

export function COAWorkspace({ctx}) {
  const {coa, jes, actions, toast, can, entity, goto, navContext} = ctx;
  const [showNew, setShowNew] = useState(false);
  const [tab, setTab] = useState('WBS Chart of Accounts (766)');
  const [f, setF] = useState({account_code:'', account_name:'', account_type:'EXPENSE'});
  const [qboQuery, setQboQuery] = useState('');
  useEffect(() => {
    if (navContext?.route !== 'coa' || !navContext.coaReturn) return;
    if (navContext.coaReturn.tab) setTab(navContext.coaReturn.tab);
    setQboQuery(String(navContext.coaReturn.qboQuery || ''));
  }, [navContext?.route, navContext?.coaReturn]);
  const tb = trialBalance(jes, entity);
  const balOf = (code) => { const r = tb.rows.find(x=>x.account_code===code); return r? r.balance : 0; };
  const query = qboQuery.trim().toLowerCase();
  const filteredWbs = query ? WBS_COA_FULL.filter(r => `${r.code} ${r.name}`.toLowerCase().includes(query)) : WBS_COA_FULL;
  const filteredCoa = query ? coa.filter(r => `${r.account_code} ${r.account_name}`.toLowerCase().includes(query)) : coa;
  const localAccountColumns = [
    {h:'Code',k:'account_code'},
    {h:'Account name',k:'account_name'},
    {h:'Account type',render:r=><Badge tone="muted">{r.account_type}</Badge>,csv:r=>r.account_type},
    {h:'Cash scope',render:r=><Badge tone={chartAccountScope(r.account_code)==='Operating'?'ok':'muted'}>{chartAccountScope(r.account_code)}</Badge>,csv:r=>chartAccountScope(r.account_code)},
    {h:'Control / review',render:r=><Badge tone={/control/.test(chartAccountControlState(r.account_code))?'warn':'muted'}>{chartAccountControlState(r.account_code)}</Badge>,csv:r=>chartAccountControlState(r.account_code)},
    {h:'Normal balance',k:'normal_balance'},
    {h:'QuickBooks balance',num:true,render:r=><Money v={balOf(r.account_code)}/>,sortVal:r=>balOf(r.account_code),csv:r=>balOf(r.account_code)},
    {h:'Status',render:r=> r.inactive? <Badge tone="bad">Inactive</Badge> : <Badge tone="ok">Active</Badge>,csv:r=>r.inactive?'Inactive':'Active'},
    {h:'Action',render:r=> { const action=chartAccountDrill(r); const context={...action.context,entityId:entity || '',coaReturn:{route:'coa',tab,qboQuery,entityId:entity || ''}}; return <span className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>goto(action.route,context)}>{action.label}</Btn><Btn size="sm" variant="ghost" disabled title="COA activation changes are excluded from the retained-evidence workflow">{r.inactive?'Activate unavailable':'Make inactive unavailable'}</Btn></span>; }},
  ];
  const add = () => {
    if(!/^[0-9]{6}$/.test(f.account_code)){ toast('Account code must be six digits to match the WBS chart.','bad'); return; }
    const r = actions.addAccount({...f, normal_balance:['ASSET','EXPENSE'].includes(f.account_type)?'DEBIT':'CREDIT'});
    if (r.dup){ toast('Account code already exists [4004].','bad'); return; }
    toast('Account created.'); setShowNew(false); setF({account_code:'',account_name:'',account_type:'EXPENSE'});
  };
  return <div>
    <h2 className="page-h">Chart of Accounts</h2>
    <nav aria-label="Observed QuickBooks Accounting navigation" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
      {['Bank transactions','Integration transactions','Receipts','Reconcile','Rules','Chart of accounts','Recurring transactions'].map(label=><span key={label} className="badge muted">{label}</span>)}
    </nav>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QBO Accounting navigation shell. Chart-of-accounts table controls, row actions, permissions, and drill paths are not yet verified from this page.</p>
    <section className="filter-bar accounting-filter-bar" aria-label="Observed QuickBooks Chart of accounts controls" style={{marginBottom:12}}>
      <label><span className="filter-label">Filter by name or number</span><input aria-label="Filter by name or number" value={qboQuery} onChange={e=>setQboQuery(e.target.value)} placeholder="Filter by name or number" /></label>
      <label><span className="filter-label">Filter by limit</span><select aria-label="Filter by limit" value="All" disabled><option>All</option></select></label>
      <Btn size="sm" variant="ghost" disabled>Batch actions</Btn><Btn size="sm" variant="ghost" disabled>Batch edit</Btn><Btn size="sm" variant="ghost" disabled>Export chart of accounts</Btn><Btn size="sm" variant="ghost" disabled>Print</Btn><Btn size="sm" variant="ghost" disabled>Settings</Btn>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>The local name-or-number filter and retained Register/GL drills are functional. QBO limit, batch edit, export, print, settings, New account, account activation and other writes are excluded from the local evidence workflow.</p>
    <Tabs tabs={['WBS Chart of Accounts (766)','Entity posting accounts']} active={tab} onChange={setTab}/>
    {tab==='WBS Chart of Accounts (766)' && <>
      <Table exportName="wbs-coa-full" rowKey="code" pageSize={40} cols={[
        {h:'Account',k:'code'},
        {h:'Account Name',render:r=><span style={{paddingLeft:(Math.max(0,r.lvl-1))*18, fontWeight:r.kind!=='R'?700:400, color:r.kind==='T'?'var(--brand-ink)':undefined}}>{r.name}</span>,csv:r=>r.name},
        {h:'Normal Balance',k:'nb'},
        {h:'Type',render:r=><Badge tone={r.kind==='H'?'muted':r.kind==='T'?'ok':'warn'}>{r.kind==='H'?'Header':r.kind==='T'?'Total':'Posting'}</Badge>,csv:r=>r.kind},
        {h:'Level',num:true,k:'lvl'},
      ]} rows={filteredWbs} />
      <p className="muted sm">This retained view follows the observed WBS Chart of Accounts - ALL structure: Header, Posting, and Total rows. Only Posting rows are eligible for accounting entries.</p>
    </>}
    {tab!=='WBS Chart of Accounts (766)' && <>
    <div style={{marginBottom:12}}><Btn variant="primary" disabled title="Creating accounts is excluded from the retained-evidence workflow">+ New account unavailable</Btn></div>
    <Table exportName="chart-of-accounts" rowKey="account_code" cols={localAccountColumns} rows={filteredCoa} />
    <p className="muted sm">Control rules: account codes are unique; accounts with balances cannot be inactivated; historical journal entries remain versioned.</p>
    </>}
    <Drawer open={showNew} onClose={()=>setShowNew(false)} title="Create account"
      actions={<><Btn onClick={()=>setShowNew(false)}>Cancel</Btn><Btn variant="primary" onClick={add}>Create</Btn></>}>
      <Field label="Account code (six digits)" required><input value={f.account_code} onChange={e=>setF(s=>({...s,account_code:e.target.value}))} maxLength={6}/></Field>
      <Field label="Account name" required><input value={f.account_name} onChange={e=>setF(s=>({...s,account_name:e.target.value}))}/></Field>
      <Field label="Account type"><select value={f.account_type} onChange={e=>setF(s=>({...s,account_type:e.target.value}))}>
        {['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].map(t=><option key={t}>{t}</option>)}</select></Field>
    </Drawer>
  </div>;
}
