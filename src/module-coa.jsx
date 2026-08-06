import { useEffect, useState } from 'react';
import { Btn, Badge, Money, Table, Unavailable } from './ui.jsx';
import { trialBalance } from './engine.js';
import { WBS_COA_FULL } from './coa-wbs.js';
import { Tabs } from './ui.jsx';
import { chartAccountControlState, chartAccountDrill, chartAccountScope } from './chart-account-actions.js';

const WBS_TAB = 'WBS chart of accounts (766)';
const LOCAL_TAB = 'Local posting accounts';

export function COAWorkspace({ctx}) {
  const {coa, jes, entity, goto, navContext} = ctx;
  const [tab, setTab] = useState(WBS_TAB);
  const [qboQuery, setQboQuery] = useState('');
  useEffect(() => {
    if (navContext?.route !== 'coa' || !navContext.coaReturn) return;
    if (navContext.coaReturn.tab) {
      const returnedTab = navContext.coaReturn.tab;
      setTab(returnedTab === WBS_TAB || returnedTab === LOCAL_TAB ? returnedTab : WBS_TAB);
    }
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
    {h:'Local balance',num:true,render:r=><Money v={balOf(r.account_code)}/>,sortVal:r=>balOf(r.account_code),csv:r=>balOf(r.account_code)},
    {h:'Status',render:r=> r.inactive? <Badge tone="bad">Inactive</Badge> : <Badge tone="ok">Active</Badge>,csv:r=>r.inactive?'Inactive':'Active'},
    {h:'Action',render:r=> { const action=chartAccountDrill(r); const context={...action.context,entityId:entity || '',coaReturn:{route:'coa',tab,qboQuery,entityId:entity || ''}}; return <span className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>goto(action.route,context)}>{action.label}</Btn><Unavailable reason="Account activation is excluded from the retained-evidence workflow.">{r.inactive?'Activate unavailable':'Make inactive unavailable'}</Unavailable></span>; }},
  ];
  return <div>
    <h2 className="page-h">Chart of Accounts</h2>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Local chart-of-accounts evidence for retained balances, cash scope, control-account review, and Register/GL drillback.</p>
    <section className="filter-bar accounting-filter-bar" aria-label="Chart of accounts filters" style={{marginBottom:12}}>
      <label><span className="filter-label">Filter by name or number</span><input aria-label="Filter by name or number" value={qboQuery} onChange={e=>setQboQuery(e.target.value)} placeholder="Filter by name or number" /></label>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>The local name-or-number filter and retained Register/GL drills are functional. This evidence workspace is read-only: it does not manage account setup, external balances, downloads, print workflows, or connector actions.</p>
    <Tabs tabs={[WBS_TAB, LOCAL_TAB]} active={tab} onChange={setTab}/>
    {tab===WBS_TAB && <>
      <Table exportName="wbs-coa-full" rowKey="code" pageSize={40} cols={[
        {h:'Account',k:'code'},
        {h:'Account Name',render:r=><span style={{paddingLeft:(Math.max(0,r.lvl-1))*18, fontWeight:r.kind!=='R'?700:400, color:r.kind==='T'?'var(--brand-ink)':undefined}}>{r.name}</span>,csv:r=>r.name},
        {h:'Normal Balance',k:'nb'},
        {h:'Type',render:r=><Badge tone={r.kind==='H'?'muted':r.kind==='T'?'ok':'warn'}>{r.kind==='H'?'Header':r.kind==='T'?'Total':'Posting'}</Badge>,csv:r=>r.kind},
        {h:'Level',num:true,k:'lvl'},
      ]} rows={filteredWbs} />
      <p className="muted sm">WBS Chart of Accounts - ALL is retained as a reference template. Header, Posting, and Total rows are distinct; only Posting rows can be included in local accounting evidence.</p>
    </>}
    {tab!==WBS_TAB && <>
    <Table exportName="chart-of-accounts" rowKey="account_code" cols={localAccountColumns} rows={filteredCoa} />
    <p className="muted sm">Control boundary: account code remains unique; accounts with non-zero balance cannot be inactivated; historical journal evidence is retained. Account creation, editing, activation, and deactivation are unavailable.</p>
    </>}
  </div>;
}
