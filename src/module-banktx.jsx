import { useMemo, useState } from 'react';
import { Btn, Badge, Money, Table } from './ui.jsx';
import { money } from './engine.js';

const queueLabel = { Review:'Pending', Posted:'Posted', Excluded:'Excluded' };

export function BankTransactions({ctx}) {
  const {bank, actions, toast, goto} = ctx;
  const [acctCode, setAcct] = useState('BA-003');
  const [queue, setQueue] = useState('Review');
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All transactions');
  const [checked, setChecked] = useState({});
  const account = bank.accounts[acctCode];
  const stateOf = t => t.ui_status === 'Excluded' ? 'Excluded' : t.match_status === 'MATCHED' ? 'Posted' : 'Review';
  const transactions = account.txns.map(t=>({...t,_state:stateOf(t)}));
  const queueRows = useMemo(()=>transactions.filter(t=>{
    if(t._state!==queue) return false;
    if(type==='Money in' && t.direction!=='CREDIT') return false;
    if(type==='Money out' && t.direction!=='DEBIT') return false;
    return !query || `${t.reference} ${t.external_id}`.toLowerCase().includes(query.toLowerCase());
  }),[transactions,queue,type,query]);
  const suggested = t => t.suggest==='FEE'?'Bank fees':t.suggest==='INTEREST'?'Interest income':t.reference.includes('RENT')?'Match existing rent receipt':'Uncategorized — review required';
  const confidence = t => t.suggest ? 92 : t.reference.includes('RENT') ? 88 : 40;
  const accept = t => {
    if(t.suggest) actions.bankRecord(acctCode,t.bank_txn_id); else actions.bankMatch(acctCode,t.bank_txn_id);
    toast(`Recorded using suggestion: ${suggested(t)}`);
  };
  const counts = k => transactions.filter(t=>t._state===k).length;
  const selected = Object.keys(checked).filter(k=>checked[k]);
  const batchAccept = () => {
    if(!selected.length){ toast('Select at least one transaction first','warn'); return; }
    selected.forEach(id=>{ const t=transactions.find(x=>String(x.bank_txn_id)===id); if(t) accept(t); });
    setChecked({});
  };
  const cols = [
    {h:'',w:36,render:r=><input aria-label={`Select ${r.external_id}`} type="checkbox" checked={!!checked[r.bank_txn_id]} onChange={e=>setChecked(c=>({...c,[r.bank_txn_id]:e.target.checked}))}/>},
    {h:'Date',k:'txn_date'},
    {h:'Bank description',render:r=><div className="bank-desc"><b>{r.reference}</b><span>{r.external_id}</span></div>},
    {h:'Spent',num:true,render:r=>r.direction==='DEBIT'?<Money v={r.amount}/>:<span className="muted">—</span>},
    {h:'Received',num:true,render:r=>r.direction==='CREDIT'?<Money v={r.amount}/>:<span className="muted">—</span>},
    {h:'From / To',render:r=><span className="bank-party">{r.reference.includes('RENT')?'Tenant / customer':'Needs review'}</span>},
    {h:'Match / Categorize',render:r=><div className="bank-suggestion"><b>{suggested(r)}</b>{queue==='Review'&&<span><i className={confidence(r)>=80?'confidence-good':'confidence-low'}>{confidence(r)}%</i> confidence</span>}</div>},
    {h:'Action',render:r=>queue==='Review'?<span className="row-acts"><Btn size="sm" variant="primary" onClick={()=>accept(r)}>{r.suggest?'Add':'Match'}</Btn><Btn size="sm" variant="ghost" onClick={()=>{actions.bankExclude(acctCode,r.bank_txn_id);toast('Moved to Excluded','warn')}}>Exclude</Btn></span>:<Btn size="sm" variant="ghost" onClick={()=>{actions.bankUndo(acctCode,r.bank_txn_id);toast('Returned to Pending')}}>{queue==='Excluded'?'Restore':'Undo'}</Btn>}
  ];

  return <div className="full-bleed bank-workbench">
    <div className="accounting-page-head">
      <div><p className="eyebrow">ACCOUNTING / BANKING</p><h2 className="page-h">Bank transactions</h2><p className="page-subtitle">Review imported activity, match existing records, and keep book balances current.</p></div>
      <div className="row-acts"><Btn variant="ghost" onClick={()=>goto('register')}>Go to bank register</Btn><Btn variant="primary" onClick={()=>toast('Account connections are read-only in this prototype')}>Link account</Btn></div>
    </div>

    <div className="bank-health" role="status">
      <span className="bank-health-icon">!</span><div><b>Connection attention required</b><p>Some account feeds are not current. Existing imported transactions remain available for review.</p></div><Btn size="sm" variant="ghost" onClick={()=>toast('Connection diagnostics opened')}>View diagnostics</Btn>
    </div>

    <div className="acct-cards bank-account-strip">
      {Object.entries(bank.accounts).map(([code,ac])=>{const difference=ac.stmt_end-ac.gl_book_balance;return <button key={code} className={`acct-card bank-account-card ${acctCode===code?'acct-on':''}`} onClick={()=>{setAcct(code);setChecked({})}}>
        <div className="acct-head"><span><b>{ac.bank_name}</b><small>{code} · Updated {ac.stmt_date}</small></span><Badge tone={Math.abs(difference)>.005?'warn':'ok'}>{Math.abs(difference)>.005?'Needs attention':'Connected'}</Badge></div>
        <div className="acct-bal"><span><i>Bank balance</i><Money v={ac.stmt_end}/></span><span><i>In REFS</i><Money v={ac.gl_book_balance}/></span></div>
        <div className="acct-review"><b>{ac.txns.filter(t=>stateOf(t)==='Review').length}</b> pending review</div>
      </button>})}
    </div>

    <section className="bank-queue-card">
      <div className="bank-queue-tabs" role="tablist">
        {['Review','Posted','Excluded'].map(k=><button role="tab" aria-selected={queue===k} className={queue===k?'active':''} key={k} onClick={()=>{setQueue(k);setChecked({})}}>{queueLabel[k]} <span>{counts(k)}</span></button>)}
      </div>
      <div className="bank-toolbar">
        <label className="bank-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search bank description or ID"/></label>
        <select aria-label="Date"><option>All dates</option><option>This month</option><option>Last 90 days</option></select>
        <select aria-label="Transaction type" value={type} onChange={e=>setType(e.target.value)}><option>All transactions</option><option>Money in</option><option>Money out</option></select>
        <span className="bank-result-count">{queueRows.length} transactions</span>
        {queue==='Review'&&<Btn size="sm" variant="primary" onClick={batchAccept}>Accept selected ({selected.length})</Btn>}
      </div>
      <div className="bank-table"><Table rowKey="bank_txn_id" features={{filterable:false}} cols={cols} rows={queueRows} empty={`No ${queueLabel[queue].toLowerCase()} transactions`}/></div>
      <div className="bank-footer"><span>Imported bank activity stays unchanged until you add, match, exclude, or restore it.</span><span><button onClick={()=>toast('Print preview')}>Print</button><button onClick={()=>toast('CSV export prepared')}>Export CSV</button><button onClick={()=>toast('Column settings opened')}>Columns</button></span></div>
    </section>
  </div>;
}
