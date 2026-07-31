import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { money, sum } from './engine.js';

// Standard reconciliation model:
// Statement Ending Balance + Deposits in Transit - Outstanding Checks = Adjusted Bank Balance
// GL Book Balance +/- unrecorded items (bank fees, interest) = Adjusted Book Balance
// Sign-off allowed only when Adjusted Bank == Adjusted Book
export function BankRec2({ctx}) {
  const {bank, actions, toast, can} = ctx;   // bank: {accounts:{code:{stmt_begin,stmt_end,txns:[...]}}, history:[]}
  const [acctCode, setAcctCode] = useState('BA-003');
  const a = bank.accounts[acctCode];
  const txns = a.txns;
  const matched = txns.filter(t=>t.match_status==='MATCHED');
  const unmatched = txns.filter(t=>t.match_status==='UNMATCHED');
  // book side
  const bookBalance = a.gl_book_balance;
  const outstanding = a.outstanding_checks;
  const inTransit = a.deposits_in_transit;
  const unrecorded = unmatched.filter(t=>t.suggest==='FEE'||t.suggest==='INTEREST');
  const unrecordedAdj = sum(unrecorded, t=>t.direction==='CREDIT'?t.amount:-t.amount);
  const adjBank = a.stmt_end + sum(inTransit,d=>d.amount) - sum(outstanding,c=>c.amount);
  const adjBook = bookBalance + (a.recorded_adj||0);
  const diff = +(adjBank - adjBook).toFixed(2);
  const canSign = Math.abs(diff) < 0.005 && unmatched.length===0;

  const record = (t) => { actions.bankRecord(acctCode, t.bank_txn_id); toast(`已入账：${t.suggest==='FEE'?'Dr 6070 Bank Fee / Cr Cash':'Dr Cash / Cr 4050 Interest Income'}`); };
  const match = (t) => { actions.bankMatch(acctCode, t.bank_txn_id); toast('已匹配至账面交易'); };
  const suspense = (t) => { actions.bankSuspense(acctCode, t.bank_txn_id); toast('已暂挂 9000 Suspense + 登记异常','warn'); };

  return <div className="full-bleed">
    <h2 className="page-h">银行对账 Bank Reconciliation</h2>
    <div className="loan-select">{Object.keys(bank.accounts).map(c=><button key={c} className={`chip ${acctCode===c?'chip-on':''}`} onClick={()=>setAcctCode(c)}>{c} · {bank.accounts[c].bank_name}</button>)}
      <span className="muted sm" style={{marginLeft:'auto'}}>对账期间 {a.period} · 截止 {a.stmt_date}</span></div>
    <div className="recon-model">
      <div className="recon-col">
        <div className="recon-title">银行侧 Bank Side</div>
        <div className="kv"><span>Statement Beginning Balance</span><Money v={a.stmt_begin}/></div>
        <div className="kv"><span>Statement Ending Balance</span><Money v={a.stmt_end} bold/></div>
        <div className="kv"><span>+ Deposits in Transit ({inTransit.length})</span><Money v={sum(inTransit,d=>d.amount)}/></div>
        <div className="kv"><span>− Outstanding Checks ({outstanding.length})</span><Money v={-sum(outstanding,c=>c.amount)}/></div>
        <div className="kv tot"><span>Adjusted Bank Balance</span><Money v={adjBank} bold/></div>
      </div>
      <div className="recon-col">
        <div className="recon-title">账面侧 Book Side</div>
        <div className="kv"><span>GL Book Balance (1000)</span><Money v={bookBalance} bold/></div>
        <div className="kv"><span>± 已入账调整 (Fees/Interest)</span><Money v={a.recorded_adj||0}/></div>
        <div className="kv"><span>待入账调整（下表处理）</span><Money v={unrecordedAdj}/></div>
        <div className="kv tot"><span>Adjusted Book Balance</span><Money v={adjBook} bold/></div>
      </div>
      <div className={`recon-diff ${canSign?'ok':'bad'}`}>
        <div>差异 Difference</div>
        <div className="recon-diff-n">{money(diff)}</div>
        <div className="sm">{canSign?'✓ 可 Sign-off':`${unmatched.length} 笔未处理`}</div>
      </div>
    </div>
    <SectionTitle>银行流水（{txns.length} 笔 · 未匹配 {unmatched.length}）</SectionTitle>
    <Table exportName={'bankrec-'+acctCode} rowKey="bank_txn_id" cols={[
      {h:'交易号',k:'external_id'},{h:'日期',k:'txn_date'},
      {h:'方向',render:r=><Badge tone="muted">{r.direction}</Badge>,csv:r=>r.direction},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
      {h:'摘要',k:'reference'},
      {h:'状态',render:r=><Badge>{r.match_status}</Badge>,csv:r=>r.match_status},
      {h:'处理',render:r=> r.match_status==='MATCHED'? <span className="muted sm">{r.matched_je||'—'}</span> :
        <span className="row-acts">
          {r.suggest && ['FEE','INTEREST'].includes(r.suggest) ? <Btn size="sm" variant="primary" onClick={e=>record(r)}>入账{r.suggest==='FEE'?'手续费':'利息'}</Btn> : <Btn size="sm" onClick={()=>match(r)}>匹配</Btn>}
          <Btn size="sm" variant="ghost" onClick={()=>suspense(r)}>暂挂</Btn>
        </span>},
    ]} rows={txns} />
    <div style={{marginTop:14, display:'flex', gap:14, alignItems:'center'}}>
      <Btn variant="primary" disabled={!canSign || !can('CASH.RECON.SIGNOFF')} title={canSign?'':'差异必须为 0 且全部流水处理完'} onClick={()=>{actions.bankSignoff(acctCode); toast('对账 Sign-off 完成，已写入对账历史');}}>Sign-off 本期对账</Btn>
      <span className="muted sm">Adjusted Bank = Adjusted Book 且无未处理流水才可关闭</span>
    </div>
    {bank.history.length>0 && <><SectionTitle>对账历史</SectionTitle>
      <Table rowKey="id" cols={[{h:'账户',k:'account'},{h:'期间',k:'period'},{h:'差异',num:true,render:r=><Money v={r.diff}/>},{h:'Sign-off',k:'by'},{h:'时间',k:'at'}]} rows={bank.history}/></>}
  </div>;
}
