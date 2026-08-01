import { useState } from 'react';
import { Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { money, sum, acct } from './engine.js';
import { aiJudge } from './ai.js';
import { ENTITIES } from './data.js';

// QBO-style Bank Transactions: account cards + For Review workflow
export function BankTransactions({ctx}) {
  const {bank, actions, toast, goto} = ctx;
  const [acctCode, setAcct] = useState('BA-003');
  const [tab, setTab] = useState('For Review');
  const [checked, setChecked] = useState({});
  const [aiSel, setAiSel] = useState(null);
  const a = bank.accounts[acctCode];
  const st = t => t.ui_status || (t.match_status==='MATCHED' ? 'Categorized' : 'For Review');
  const txns = a.txns.map(t=>({...t, _st:st(t)}));
  const forReview = txns.filter(t=>t._st==='For Review');
  const lists = {'For Review':forReview, 'Categorized':txns.filter(t=>t._st==='Categorized'), 'Excluded':txns.filter(t=>t._st==='Excluded'), 'Reconciled':bank.history};
  const diff = a.stmt_end - a.gl_book_balance;
  const suggName = t => t.suggest==='FEE'?'651000 Bank Fees':t.suggest==='INTEREST'?'449200 Interest Income':t.reference.includes('RENT')?'120200 A/R Rent (Match JE-1004)':'待分类 142000 Suspense';
  const conf = t => t.suggest?'92%':t.reference.includes('RENT')?'88%':'40%';
  const accept = (t) => { if(t.suggest) actions.bankRecord(acctCode,t.bank_txn_id); else actions.bankMatch(acctCode,t.bank_txn_id); toast(`已按建议入账: ${suggName(t)}`); };
  const batchAccept = () => { const ids=Object.keys(checked).filter(k=>checked[k]); if(!ids.length){toast('先勾选交易','warn');return;}
    ids.forEach(id=>{const t=forReview.find(x=>String(x.bank_txn_id)===id); if(t) accept(t);}); setChecked({}); toast(`批量接受 ${ids.length} 笔建议`); };
  return <div className="full-bleed">
    <h2 className="page-h">Bank Transactions</h2>
    <div className="acct-cards">
      {Object.entries(bank.accounts).map(([code,ac])=>{ const d=ac.stmt_end-ac.gl_book_balance; return (
        <div key={code} className={`acct-card ${acctCode===code?'acct-on':''}`} onClick={()=>setAcct(code)}>
          <div className="acct-head"><b>{ac.bank_name}</b><Badge tone="ok">Connected</Badge></div>
          <div className="muted sm">{code} ·· {code.slice(-3)}··· · 更新于 {ac.stmt_date}</div>
          <div className="acct-bal"><span><i>Bank Balance</i><Money v={ac.stmt_end}/></span><span><i>Book Balance</i><Money v={ac.gl_book_balance}/></span><span><i>Difference</i><b className={Math.abs(d)>0.005?'num-neg':''}>{money(d)}</b></span></div>
          <div className="acct-review">{ac.txns.filter(t=>st(t)==='For Review').length} for review</div>
        </div>);})}
    </div>
    <Tabs tabs={['For Review','Categorized','Excluded','Reconciled']} active={tab} onChange={setTab}/>
    {tab==='For Review' && <>
      <div style={{display:'flex',gap:10,margin:'4px 0 10px'}}>
        <Btn size="sm" variant="primary" onClick={batchAccept}>Batch Accept ({Object.values(checked).filter(Boolean).length})</Btn>
        <Btn size="sm" variant="ghost" onClick={()=>toast('Bank Rule 已创建: SERVICE FEE → 6070 (下次自动分类)')}>Create Rule</Btn>
        <Btn size="sm" variant="ghost" onClick={()=>goto('bankrec')}>Start Reconciliation →</Btn>
      </div>
      <Table rowKey="bank_txn_id" cols={[
        {h:'',w:34,render:r=><input type="checkbox" checked={!!checked[r.bank_txn_id]} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(c=>({...c,[r.bank_txn_id]:e.target.checked}))}/>},
        {h:'Date',k:'txn_date'},{h:'Bank Description',k:'reference'},
        {h:'Amount',num:true,render:r=><Money v={r.direction==='DEBIT'?-r.amount:r.amount}/>,sortVal:r=>r.amount},
        {h:'Suggested Category / Match',render:r=><span>{suggName(r)}</span>},
        {h:'Confidence',render:r=><Badge tone={parseInt(conf(r))>80?'ok':'warn'}>{conf(r)}</Badge>},
        {h:'AI',render:r=><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); setAiSel(r);}}>🤖 判断</Btn>},
        {h:'Action',render:r=><span className="row-acts">
          <Btn size="sm" variant="primary" onClick={()=>accept(r)}>{r.suggest?'Add':'Match'}</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>{actions.bankExclude(acctCode,r.bank_txn_id); toast('已 Exclude','warn');}}>Exclude</Btn>
          <Btn size="sm" variant="ghost" onClick={()=>actions.bankSuspense(acctCode,r.bank_txn_id)}>Suspense</Btn>
        </span>},
      ]} rows={forReview} empty="没有待审核的银行交易 🎉"/>
    </>}
    {aiSel && (()=>{ const en=ENTITIES.find(x=>x.entity_id===(ctx.entity||15))||ENTITIES[0];
      const j=aiJudge({type: aiSel.suggest==='FEE'?'Bank':aiSel.suggest==='INTEREST'?'Bank':'Bank', detail:aiSel.reference, direction:aiSel.direction, amount:aiSel.amount, description:aiSel.reference, payee:aiSel.reference}, en);
      return <div className="src-card" style={{marginTop:12}}>
        <div className="src-chain"><span className="chip">Source: {aiSel.external_id}</span>→<span className="chip chip-on">AI Judge</span>→<span className="chip">Suggested JE</span></div>
        <div className="src-grid">
          <span><i>Suggested</i><b>Dr {j.suggested.dr} {j.suggested.dr_name} / Cr {j.suggested.cr} {j.suggested.cr_name}</b></span>
          <span><i>Confidence</i><b>{(j.confidence*100).toFixed(0)}%</b></span>
          <span><i>Rule</i><b>{j.rule_used}</b></span>
          <span><i>Setting</i><b>{j.setting_used}</b></span>
          <span><i>Risk</i><b>{j.risk}</b></span>
          <span><i>需人工</i><b>{j.need_human?'YES':'no'}</b></span>
        </div>
        <p className="muted sm" style={{margin:'8px 0 0'}}>Reason: {j.reason} · Evidence: {j.evidence.slice(0,60)} · AI 只建议,确认后才入账</p>
      </div>; })()}
    {tab==='Categorized' && <Table rowKey="bank_txn_id" cols={[
      {h:'Date',k:'txn_date'},{h:'Description',k:'reference'},{h:'Amount',num:true,render:r=><Money v={r.direction==='DEBIT'?-r.amount:r.amount}/>},
      {h:'Categorized To',render:r=>r.matched_je||'—'},
      {h:'Action',render:r=><Btn size="sm" variant="ghost" onClick={()=>{actions.bankUndo(acctCode,r.bank_txn_id); toast('已 Undo,退回 For Review','warn');}}>Undo</Btn>},
    ]} rows={lists['Categorized']} empty="暂无已分类交易"/>}
    {tab==='Excluded' && <Table rowKey="bank_txn_id" cols={[
      {h:'Date',k:'txn_date'},{h:'Description',k:'reference'},{h:'Amount',num:true,render:r=><Money v={r.amount}/>},
      {h:'Action',render:r=><Btn size="sm" variant="ghost" onClick={()=>{actions.bankUndo(acctCode,r.bank_txn_id); toast('已恢复到 For Review');}}>Restore</Btn>},
    ]} rows={lists['Excluded']} empty="没有排除的交易"/>}
    {tab==='Reconciled' && <Table rowKey="id" cols={[
      {h:'Account',k:'account'},{h:'Period',k:'period'},{h:'Difference',num:true,render:r=><Money v={r.diff}/>},{h:'By',k:'by'},{h:'Date',k:'at'},
    ]} rows={bank.history} empty="尚无对账历史,去 Reconciliation 完成第一笔"/>}
  </div>;
}
