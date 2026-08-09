import { useEffect, useState } from 'react';
import { Btn, Badge, Money, Table, Unavailable } from './ui.jsx';
import { trialBalance } from './engine.js';
import { chartAccountControlState, chartAccountDrill, chartAccountScope } from './chart-account-actions.js';

const LOCAL_TAB = 'Local posting accounts';

export function COAWorkspace({ctx}) {
  const {coa, jes, entity, goto, navContext} = ctx;
  const [qboQuery, setQboQuery] = useState('');
  const [accountType, setAccountType] = useState('ALL');
  useEffect(() => {
    if (navContext?.route !== 'coa' || !navContext?.coaReturn) return;
    setQboQuery(String(navContext.coaReturn.qboQuery || ''));
    setAccountType(String(navContext.coaReturn.accountType || 'ALL'));
  }, [navContext?.route, navContext?.coaReturn]);
  const tb = trialBalance(jes, entity);
  const balOf = (code) => { const r = tb.rows.find(x=>x.account_code===code); return r? r.balance : 0; };
  const query = qboQuery.trim().toLowerCase();
  const filteredCoa = coa.filter(r => {
    if (accountType !== 'ALL' && r.account_type !== accountType) return false;
    return !query || `${r.account_code} ${r.account_name}`.toLowerCase().includes(query);
  });
  const localAccountColumns = [
    {h:'Code',k:'account_code'},
    {h:'Account name',k:'account_name'},
    {h:'Account type',render:r=><Badge tone="muted">{r.account_type}</Badge>,csv:r=>r.account_type},
    {h:'Cash scope',render:r=><Badge tone={chartAccountScope(r.account_code)==='Operating'?'ok':'muted'}>{chartAccountScope(r.account_code)}</Badge>,csv:r=>chartAccountScope(r.account_code)},
    {h:'Control / review',render:r=><Badge tone={/control/.test(chartAccountControlState(r.account_code))?'warn':'muted'}>{chartAccountControlState(r.account_code)}</Badge>,csv:r=>chartAccountControlState(r.account_code)},
    {h:'Normal balance',k:'normal_balance'},
    {h:'Posted ledger balance',num:true,render:r=><Money v={balOf(r.account_code)}/>,sortVal:r=>balOf(r.account_code),csv:r=>balOf(r.account_code)},
    {h:'Status',render:r=> r.inactive? <Badge tone="bad">Inactive</Badge> : <Badge tone="ok">Active</Badge>,csv:r=>r.inactive?'Inactive':'Active'},
    {h:'Action',render:r=> { const action=chartAccountDrill(r); const context={...action.context,entityId:entity || '',coaReturn:{route:'coa',tab:LOCAL_TAB,qboQuery,accountType,entityId:entity || ''}}; return <span className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>goto(action.route,context)}>{action.label}</Btn><Unavailable reason="Account activation is excluded from the retained-evidence workflow.">{r.inactive?'Activate unavailable':'Make inactive unavailable'}</Unavailable></span>; }},
  ];
  return <div>
    <h2 className="page-h">Chart of Accounts</h2>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Local chart-of-accounts evidence for retained balances, cash scope, control-account review, and Register/GL drillback.</p>
    <section className="filter-bar accounting-filter-bar" aria-label="Chart of accounts filters" style={{marginBottom:12}}>
      <label><span className="filter-label">Filter by name or number</span><input aria-label="Filter by name or number" value={qboQuery} onChange={e=>setQboQuery(e.target.value)} placeholder="Filter by name or number" /></label>
      <label><span className="filter-label">Account type</span><select aria-label="Account type" value={accountType} onChange={e=>setAccountType(e.target.value)}><option value="ALL">All account types</option>{[...new Set(coa.map(account=>account.account_type).filter(Boolean))].sort().map(type=><option key={type} value={type}>{type}</option>)}</select></label>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>The local name-or-number filter and retained Register/GL drills are functional. This evidence workspace is read-only: it does not manage account setup, external balances, downloads, print workflows, connector actions, or WBS account administration.</p>
    <section aria-label="Local posting accounts">
    <Table rowKey="account_code" cols={localAccountColumns} rows={filteredCoa} />
    <p className="muted sm">Control boundary: account code remains unique; accounts with non-zero balance cannot be inactivated; historical journal evidence is retained. Account creation, editing, activation, deactivation, and WBS account administration are unavailable.</p>
    </section>
  </div>;
}
