import { useMemo, useState } from 'react';
import { Btn, Badge, Money, Table, Tabs, Drawer, Field } from './ui.jsx';
import { money, acct } from './engine.js';
import { aiJudge } from './ai.js';
import { ENTITIES } from './data.js';
import { BANK_CATEGORY_OPTIONS, bankSuggestion, buildBankDraft, findBankMatchCandidates, splitDifference } from './bank-workflow.js';

function ReviewDrawer({txn,accountCode,ctx,onClose}){
  const {actions,toast}=ctx;
  const suggestion=bankSuggestion(txn);
  const candidates=useMemo(()=>findBankMatchCandidates({txn,jes:ctx.jes,bank:ctx.bank,acctCode:accountCode,entityId:ctx.entity||4}),[txn,ctx.jes,ctx.bank,accountCode,ctx.entity]);
  const [mode,setMode]=useState(suggestion.mode);
  const [split,setSplit]=useState(false);
  const [rows,setRows]=useState([{account_code:suggestion.account_code,amount:txn.amount,memo:txn.reference}]);
  const [candidateId,setCandidateId]=useState(candidates[0]?.je_id||'');
  const [submitting,setSubmitting]=useState(false);
  const difference=splitDifference(txn.amount,rows);
  const candidate=candidates.find(c=>c.je_id===Number(candidateId));
  const update=(i,patch)=>setRows(rs=>rs.map((r,index)=>index===i?{...r,...patch}:r));
  const addLine=()=>{setSplit(true);setRows(rs=>[...rs,{account_code:'',amount:Math.max(0,difference),memo:''}]);};
  const removeLine=i=>setRows(rs=>rs.filter((_,index)=>index!==i));

  const save=()=>{
    if(submitting)return;
    setSubmitting(true);
    if(mode==='Match'){
      const result=actions.bankMatch(accountCode,txn.bank_txn_id,candidate);
      if(!result?.ok){toast(result?.message||'Match was blocked by accounting controls.','bad');setSubmitting(false);return;}
      toast(`Matched to ${result.je_number}. No new journal entry was created.`);onClose();return;
    }
    const spec=buildBankDraft({...txn,entity_id:ctx.entity||4},accountCode,rows);
    const result=actions.bankCreateDraft(accountCode,txn.bank_txn_id,spec);
    if(!result?.ok){toast(result?.message||'Draft creation was blocked by accounting controls.','bad');setSubmitting(false);return;}
    toast(`Draft JE ${result.je_number} created and sent to the approval workflow.`);onClose();
  };

  return <Drawer open onClose={onClose} width={640} title={`Review bank transaction · ${txn.external_id}`}
    actions={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={submitting||(mode==='Match'&&!candidate)} onClick={save}>{submitting?'Working…':mode==='Match'?'Match':'Add as Draft JE'}</Btn></>}>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1.4fr 1fr',gap:12,marginBottom:16}}>
      <div><div className="muted sm">Date</div><b>{txn.txn_date}</b></div>
      <div><div className="muted sm">Bank description</div><b>{txn.reference}</b></div>
      <div style={{textAlign:'right'}}><div className="muted sm">Amount</div><Money v={txn.direction==='DEBIT'?-txn.amount:txn.amount} bold/></div>
    </div>
    <Tabs tabs={['Match','Categorize']} active={mode} onChange={setMode}/>
    {mode==='Match'?<div className="src-card">
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'start',gap:12}}><div><b>Posted candidates</b><div className="muted sm">Exact entity, currency, bank member, direction and amount only</div></div><Badge tone={candidates.length?'ok':'warn'}>{candidates.length} found</Badge></div>
      {candidates.length===0?<div className="empty" style={{marginTop:12}}>No eligible posted transaction exists. Match is disabled.</div>:candidates.map(c=><label key={c.je_id} style={{display:'grid',gridTemplateColumns:'24px 1fr auto',gap:8,alignItems:'center',padding:'12px 4px',borderBottom:'1px solid var(--divider)',cursor:'pointer'}}>
        <input type="radio" name="bank-candidate" checked={Number(candidateId)===c.je_id} onChange={()=>setCandidateId(c.je_id)}/>
        <span><b>{c.je_number}</b><div className="muted sm">{c.je_date} · {c.description}</div></span><Money v={c.amount}/>
      </label>)}
      {candidate&&<><div className="kv" style={{marginTop:10}}><span>Cash line</span><b>Line {candidate.cash_line_index+1} · Operating Cash_{accountCode}</b></div><div className="kv"><span>Difference</span><b className="ok-txt">$0.00</b></div></>}
    </div>:<>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',margin:'14px 0 4px'}}><b>{split?'Split details':'Category'}</b><Btn size="sm" variant="ghost" onClick={addLine}>+ Split</Btn></div>
      {rows.map((row,i)=><div key={i} style={{display:'grid',gridTemplateColumns:'1.35fr .7fr 1fr auto',gap:8,alignItems:'end',padding:'9px 0',borderBottom:'1px solid var(--divider)'}}>
        <Field label="Account" required><select value={row.account_code} onChange={e=>update(i,{account_code:e.target.value})}><option value="">Select mapping…</option>{BANK_CATEGORY_OPTIONS.map(code=><option key={code} value={code}>{code} · {acct(code).account_name}</option>)}</select></Field>
        <Field label="Amount" required><input type="number" min="0" step="0.01" value={row.amount} onChange={e=>update(i,{amount:e.target.value})}/></Field>
        <Field label="Memo"><input value={row.memo} onChange={e=>update(i,{memo:e.target.value})}/></Field>
        <Btn size="sm" variant="ghost" disabled={rows.length===1} onClick={()=>removeLine(i)}>Remove</Btn>
      </div>)}
      <div className="kv tot" style={{marginTop:12}}><span>Difference</span><b className={Math.abs(difference)<.005?'ok-txt':'num-neg'}>{money(difference)}</b></div>
      <div className={`sm ${Math.abs(difference)<.005?'ok-txt':'warn-txt'}`}>{Math.abs(difference)<.005?'Ready — split total equals the bank amount.':'Difference must be $0.00 before a Draft JE can be created.'}</div>
    </>}
    <div className="src-card" style={{marginTop:18}}><div className="src-chain"><span className="chip">Bank feed</span>→<span className="chip chip-on">Human review</span>→<span className="chip">Draft JE</span>→<span className="chip">Approval</span>→<span className="chip">GL</span></div><p className="muted sm" style={{marginBottom:0}}>REFS control: Add creates a traced Draft JE. It never posts a bank feed directly to the general ledger.</p></div>
  </Drawer>;
}

export function BankTransactions({ctx}){
  const {bank,actions,toast,goto}=ctx;
  const [acctCode,setAcct]=useState('BA-003');
  const [tab,setTab]=useState('For Review');
  const [checked,setChecked]=useState({});
  const [reviewTxn,setReviewTxn]=useState(null);
  const [aiSel,setAiSel]=useState(null);
  const account=bank.accounts[acctCode];
  const statusOf=t=>t.ui_status||(t.match_status==='MATCHED'?'Categorized':'For Review');
  const txns=account.txns.map(t=>({...t,_st:statusOf(t)}));
  const forReview=txns.filter(t=>t._st==='For Review');
  const categorized=txns.filter(t=>t._st==='Categorized');
  const excluded=txns.filter(t=>t._st==='Excluded');

  const batchItem=t=>{
    const suggestion=bankSuggestion(t);
    if(suggestion.mode==='Match'){
      const candidates=findBankMatchCandidates({txn:t,jes:ctx.jes,bank,acctCode,entityId:ctx.entity||4});
      return {txnId:t.bank_txn_id,mode:'MATCH',candidate:candidates.length===1?candidates[0]:null};
    }
    return {txnId:t.bank_txn_id,mode:'DRAFT',spec:buildBankDraft({...t,entity_id:ctx.entity||4},acctCode,[{account_code:suggestion.account_code,amount:t.amount,memo:t.reference}])};
  };
  const batchAccept=()=>{
    const selected=forReview.filter(t=>checked[t.bank_txn_id]);
    if(!selected.length){toast('Select at least one transaction first.','warn');return;}
    const result=actions.bankBatchAccept(acctCode,selected.map(batchItem));
    setChecked({});toast(`${result.created} Draft JE(s) · ${result.matched} matched · ${result.blocked} blocked`,result.blocked?'warn':'ok');
  };
  const undo=t=>{const result=actions.bankUndo(acctCode,t.bank_txn_id);if(!result?.ok)toast(result?.message||'Undo blocked.','bad');else toast(result.kind==='UNMATCH'?'Match removed. Source returned to For Review.':'Draft removed. Source returned to For Review.','warn');};

  return <div className="full-bleed">
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><div><h2 className="page-h" style={{marginBottom:2}}>Bank transactions</h2><div className="muted sm">QuickBooks-style review with WBS Setting, Mapping and approval controls.</div></div><Btn variant="ghost" onClick={()=>goto('bankrec')}>Reconcile</Btn></div>
    <div className="acct-cards" style={{marginTop:16}}>{Object.entries(bank.accounts).map(([code,a])=>{const d=a.stmt_end-a.gl_book_balance;return <div key={code} className={`acct-card ${acctCode===code?'acct-on':''}`} onClick={()=>setAcct(code)}><div className="acct-head"><b>{a.bank_name}</b><Badge tone="ok">Connected</Badge></div><div className="muted sm">{code} · updated {a.stmt_date}</div><div className="acct-bal"><span><i>Bank balance</i><Money v={a.stmt_end}/></span><span><i>Book balance</i><Money v={a.gl_book_balance}/></span><span><i>Difference</i><b className={Math.abs(d)>.005?'num-neg':''}>{money(d)}</b></span></div><div className="acct-review">{a.txns.filter(t=>statusOf(t)==='For Review').length} for review</div></div>;})}</div>
    <Tabs tabs={['For Review','Categorized','Excluded','Reconciled']} active={tab} onChange={setTab}/>
    {tab==='For Review'&&<><div style={{display:'flex',gap:10,margin:'4px 0 10px'}}><Btn size="sm" variant="primary" onClick={batchAccept}>Batch accept ({Object.values(checked).filter(Boolean).length})</Btn><Btn size="sm" variant="ghost" onClick={()=>toast('Rule draft opened. It must be tested and approved before LIVE.')}>Create rule</Btn></div><Table rowKey="bank_txn_id" cols={[
      {h:'',w:34,render:r=><input type="checkbox" checked={!!checked[r.bank_txn_id]} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(c=>({...c,[r.bank_txn_id]:e.target.checked}))}/>},{h:'Date',k:'txn_date'},{h:'Bank description',k:'reference'},{h:'Amount',num:true,render:r=><Money v={r.direction==='DEBIT'?-r.amount:r.amount}/>,sortVal:r=>r.amount},
      {h:'Suggested action',render:r=>{const s=bankSuggestion(r);return <span><b>{s.mode}</b><div className="muted sm">{s.label}</div></span>;}},{h:'Confidence',render:r=>{const c=bankSuggestion(r).confidence;return <Badge tone={c>=.8?'ok':'warn'}>{Math.round(c*100)}%</Badge>;}},
      {h:'Action',render:r=><span className="row-acts"><Btn size="sm" variant="primary" onClick={()=>setReviewTxn(r)}>Review</Btn><Btn size="sm" variant="ghost" onClick={()=>setAiSel(aiSel?.bank_txn_id===r.bank_txn_id?null:r)}>See why</Btn><Btn size="sm" variant="ghost" onClick={()=>{const result=actions.bankExclude(acctCode,r.bank_txn_id);toast(result?.ok?'Transaction excluded.':(result?.message||'Exclude blocked.'),result?.ok?'ok':'bad');}}>Exclude</Btn></span>},
    ]} rows={forReview} empty="No bank transactions need review."/></>}
    {aiSel&&(()=>{const en=ENTITIES.find(x=>x.entity_id===(ctx.entity||15))||ENTITIES[0];const j=aiJudge({type:'Bank',detail:aiSel.reference,direction:aiSel.direction,amount:aiSel.amount,description:aiSel.reference,payee:aiSel.reference},en);return <div className="src-card"><div style={{display:'flex',justifyContent:'space-between'}}><div><b>Why this suggestion?</b><div className="muted sm">Evidence and accounting policy used by the AI assistant</div></div><Badge tone={j.need_human?'warn':'ok'}>{j.need_human?'Human review':'Low risk'}</Badge></div><div className="src-grid"><span><i>Suggested</i><b>Dr {j.suggested.dr} / Cr {j.suggested.cr}</b></span><span><i>Confidence</i><b>{(j.confidence*100).toFixed(0)}%</b></span><span><i>Rule</i><b>{j.rule_used}</b></span><span><i>Setting</i><b>{j.setting_used}</b></span><span><i>Risk</i><b>{j.risk}</b></span><span><i>Source</i><b>{aiSel.external_id}</b></span></div><p className="muted sm">{j.reason} · AI only suggests; a person must confirm.</p></div>;})()}
    {tab==='Categorized'&&<Table rowKey="bank_txn_id" cols={[{h:'Date',k:'txn_date'},{h:'Description',k:'reference'},{h:'Amount',num:true,render:r=><Money v={r.direction==='DEBIT'?-r.amount:r.amount}/>},{h:'Accounting result',render:r=><span>{r.draft_je_number||r.matched_je||'—'}<div><Badge>{r.processing_type==='DRAFT_JE'?'DRAFT':'MATCHED'}</Badge></div></span>},{h:'Action',render:r=><Btn size="sm" variant="ghost" onClick={()=>undo(r)}>Undo</Btn>}]} rows={categorized} empty="No categorized transactions."/>}
    {tab==='Excluded'&&<Table rowKey="bank_txn_id" cols={[{h:'Date',k:'txn_date'},{h:'Description',k:'reference'},{h:'Amount',num:true,render:r=><Money v={r.amount}/>},{h:'Action',render:r=><Btn size="sm" variant="ghost" onClick={()=>undo(r)}>Restore</Btn>}]} rows={excluded} empty="No excluded transactions."/>}
    {tab==='Reconciled'&&<Table rowKey="id" cols={[{h:'Account',k:'account'},{h:'Period',k:'period'},{h:'Difference',num:true,render:r=><Money v={r.diff}/>},{h:'By',k:'by'},{h:'Date',k:'at'}]} rows={bank.history} empty="No reconciliation history yet."/>}
    {reviewTxn&&<ReviewDrawer txn={reviewTxn} accountCode={acctCode} ctx={ctx} onClose={()=>setReviewTxn(null)}/>}
  </div>;
}
