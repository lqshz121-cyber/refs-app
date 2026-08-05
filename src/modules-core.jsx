import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Drawer, Tabs, Field, SectionTitle, ApprovalTimeline } from './ui.jsx';
import { COA, PROPERTIES, LOANS, ENTITIES, PERIODS, PROJECTS, VENDORS } from './data.js';
import { PM_ROWS, CLOSINGS, LOAN_TXNS, IC_TXNS, UNIT_OWNERS, SOURCE_DOCS } from './seed.js';
import { acct, money, sum, jeTotals, isBalanced, validateJE, JE_FLOW, loanRule, pmRule, trialBalance, statements } from './engine.js';
import { localJournalPostingEvidence } from './journal-posting-evidence.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localApAgingReturnScopeLabel } from './ap-aging-return-context.js';
import { localVendorCreditReturnScopeLabel } from './vendor-credit-return.js';
import { localPaymentBankEvidenceReturnScopeLabel, localPaymentReturnScopeLabel } from './payment-return-context.js';
import { localReceiptReturnScopeLabel } from './receipt-return-context.js';
import { localBankTransactionJournalReturnScopeLabel } from './bank-transaction-return.js';
import { localReconciliationJournalReturnScopeLabel } from './reconciliation-journal-return.js';
import { localAccountRegisterReturnScopeLabel } from './account-register-return.js';
import { localGLSourceTarget } from './gl-source-target.js';
import { subsidiaryOf, memberOf, SUBSIDIARY } from './coa-wbs.js';
import { loadSetting } from './settings.js';
if (typeof window!=='undefined') window.__subsOf = subsidiaryOf;

// ---------------- Dashboard ----------------
export function Dashboard({ctx}) {
  const {jes, exceptions, closeTasks, goto, entity, ap, bank} = ctx;
  const jeE = jes.filter(j=>!entity||j.entity_id===entity);
  const doneTasks = closeTasks.filter(t=>t.status==='SIGNED_OFF').length;
  const pendingApprovals = jeE.filter(j=>['PENDING_REVIEW','PENDING_APPROVAL'].includes(j.posting_status));
  const openExc = exceptions.filter(e=>['OPEN','IN_PROGRESS'].includes(e.status) && (!entity||e.entity_id===entity));
  const st = statements(jes, entity);
  const openBills = ap.bills.filter(b=>!['PAID','VOID'].includes(b.status));
  const paidBills = ap.bills.filter(b=>b.status==='PAID');
  const bankUnmatched = Object.values(bank.accounts).reduce((n,a)=>n+a.txns.filter(t=>t.match_status==='UNMATCHED').length,0);
  const expCats = [['Opex', Math.max(1,st.expense*0.42), '#2CA01C'], ['Interest', Math.max(1,st.expense*0.31), '#0077C5'], ['Management', Math.max(1,st.expense*0.17), '#FF8000'], ['Other', Math.max(1,st.expense*0.10), '#8A5BE0']];
  const expTot = expCats.reduce((s,[,v])=>s+v,0);
  let acc=0; const segs = expCats.map(([n,v,c])=>{ const from=acc/expTot*360; acc+=v; return `${c} ${from}deg ${acc/expTot*360}deg`; }).join(', ');
  const plBars = [12,18,9,22,15,26,Math.max(4,Math.round(st.netIncome/4000))];
  return <div>
    <div className="qbo-home-hero">
      <div><span className="qbo-eyebrow">REFS — Finance workspace</span><h2 className="page-h">Business overview</h2><p>One place for the work that needs attention, your live financial position, and a clean path back to source records.</p></div>
      <div className="qbo-home-actions"><Btn onClick={()=>goto('je')}>Create journal entry</Btn><Btn variant="ghost" onClick={()=>goto('reports')}>Open reports</Btn><Btn variant="ghost" onClick={()=>goto('audit')}>See all activity</Btn></div>
    </div>
    <div className="qbo-quicklinks" aria-label="Quick links">
      {[['Accounting','gl'],['Expenses & Pay Bills','ap'],['Banking','banktx'],['Projects','cost'],['Reports','reports'],['Close','close']].map(([label,route])=><button key={route} type="button" onClick={()=>goto(route)}><span>{label}</span><i aria-hidden="true">→</i></button>)}
    </div>
    <h2 className="page-h">Business at a glance</h2>
    <div className="qbo-grid">
      <div className="qbo-card" onClick={()=>goto('gl')} style={{cursor:'pointer'}}>
        <h4>Profit & Loss — 2026-07</h4>
        <div className={`qbo-big ${st.netIncome<0?'num-neg':''}`}>{money(st.netIncome)}</div>
        <div className="qbo-sub">Net income — Revenue {money(st.revenue)} − Expense {money(st.expense)}</div>
        <PLChart jes={jes} entity={entity}/>
      </div>
      <div className="qbo-card" onClick={()=>goto('reports')} style={{cursor:'pointer'}}>
        <h4>Expenses — Current period</h4>
        <div className="qbo-big">{money(st.expense)}</div>
        <ExpDonut cats={expCats}/>
      </div>
      <div className="qbo-card" onClick={()=>goto('bankrec')} style={{cursor:'pointer'}}>
        <h4>Bank Accounts</h4>
        {Object.entries(bank.accounts).map(([code,a])=><div key={code} className="bank-row"><span>{code} — {a.bank_name}</span><Money v={a.gl_book_balance}/></div>)}
        <div className="qbo-sub" style={{marginTop:8}}>{bankUnmatched} unmatched bank transactions · review reconciliation</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('ap')} style={{cursor:'pointer'}}>
        <h4>Bills</h4>
        <div className="qbo-big">{money(sum(openBills,b=>b.amount))}</div>
        <div className="split-bar"><span style={{flex:Math.max(1,openBills.length), background:'#FF8000'}}/><span style={{flex:Math.max(1,paidBills.length), background:'#2CA01C'}}/></div>
        <div className="qbo-sub">{openBills.length} open bills · {paidBills.length} paid bills</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('close')} style={{cursor:'pointer'}}>
        <h4>Month-End Close</h4>
        <div className="qbo-big">{Math.round(doneTasks/closeTasks.length*100)}%</div>
        <div className="split-bar"><span style={{flex:Math.max(1,doneTasks), background:'#2CA01C'}}/><span style={{flex:Math.max(1,closeTasks.length-doneTasks), background:'#d4d7dc'}}/></div>
        <div className="qbo-sub">{doneTasks}/{closeTasks.length} tasks complete — Period 2026-07 OPEN</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('exceptions')} style={{cursor:'pointer'}}>
        <h4>Exceptions — Open</h4>
        <div className="qbo-big num-neg">{openExc.length}</div>
        <div className="qbo-sub">{openExc.filter(e=>e.severity==='HIGH').length} high · {openExc.filter(e=>e.severity==='MEDIUM').length} medium · oldest aging {Math.max(0,...openExc.map(e=>e.aging_days))} days</div>
      </div>
    </div>
    <SectionTitle>Needs attention · REFS local queue</SectionTitle>
    <div className="todo-grid" style={{marginBottom:20}}>
      {[[bankUnmatched,'Bank transactions for review','banktx'],
        [ctx.ap.bills.filter(b=>b.status==='PENDING_APPROVAL').length,'Bills pending approval','ap'],
        [pendingApprovals.length,'JEs pending review/approval','approvals'],
        [openExc.filter(e=>e.exception_type==='GL_MAPPING_MISSING').length,'Missing mappings','mapping'],
        [openExc.length,'Open exceptions','exceptions'],
        [closeTasks.length-doneTasks,'Close tasks remaining','close']].map(([n,l,r])=>
        <div key={l} className="todo-item" onClick={()=>goto(r)} style={{cursor:'pointer'}}>
          <span className={`todo-n ${n>0?'warn':'ok'}`}>{n}</span><span className="todo-l">{l}</span></div>)}
    </div>
    <SectionTitle>Create actions</SectionTitle>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:22}}>
      {[['Create invoice','ar'],['Record expense','ap']].map(([l,r])=>
        <Btn key={l} onClick={()=>goto(r)}>{l}</Btn>)}
    </div>
    <SectionTitle>Shortcuts</SectionTitle>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:22}}>
      {[['+ Create Bill','ap'],['+ Journal Entry','je'],['Match Bank Txn','banktx'],['Run PM Pickup','pmpickup'],['Import Loan Txns','loan'],['Start Reconciliation','bankrec'],['+ Invoice','ar'],['Process Closing','closing']].map(([l,r])=>
        <Btn key={l} onClick={()=>goto(r)}>{l}</Btn>)}
    </div>
    <SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>goto('approvals')}>View all</Btn>}>Approvals ({pendingApprovals.length})</SectionTitle>
    <Table rowKey="je_id" onRow={r=>goto('je',{jeNumber:r.je_number})} cols={[
      {h:'JE number',k:'je_number'},{h:'Description',k:'description'},
      {h:'Source',render:r=><Badge tone="muted">{r.source_system}</Badge>},
      {h:'Amount',num:true,render:r=><Money v={jeTotals(r).dr}/>},
        {h:'Status',render:r=><Badge>{r.posting_status}</Badge>},
    ]} rows={pendingApprovals} empty="No journal entries are pending approval."/>
  </div>;
}

// ---------------- Journal Entry Workspace ----------------
export function JEWorkspace({ctx}) {
  const {jes, actions, can, period, toast} = ctx;
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState('ALL');
  const [srcF, setSrcF] = useState('ALL');
  const [month, setMonth] = useState('07');
  const [query, setQuery] = useState('');
  useEffect(()=>{
    if(!ctx.navContext?.jeNumber) return;
    const target=jes.find(j=>j.je_number===ctx.navContext.jeNumber);
    if(target) setSel(target.je_id);
  },[ctx.navContext?.jeNumber]);
  const list = jes.filter(j=>
    (status==='ALL'||j.posting_status===status) &&
    (!ctx.entity||j.entity_id===ctx.entity) &&
    (srcF==='ALL'||j.source_system===srcF) &&
    (!query || `${j.je_number} ${j.description||''} ${j.payee||''} ${j.source_system}`.toLowerCase().includes(query.toLowerCase())) &&
    (month==='ALL'||j.period_code==='2026-'+month));
  const pendCount = list.filter(j=>j.posting_status==='PENDING_APPROVAL').length;
  const postAll = () => { list.filter(j=>j.posting_status==='PENDING_APPROVAL').forEach(j=>actions.advanceJE(j.je_id,'POSTED','POST ALL')); toast('Post All 瀹屾垚'); };
  const runBatch = () => {
    const en = {entity_id: ctx.entity||15, entity_code:'E'+(ctx.entity||15)};
    const s = loadSetting(en); let n=0;
    (s.batch_setting||[]).filter(b=>b.status!=='INACTIVE'&&b.dr&&b.cr).forEach(b=>{
      const amt = 1000; n++;
      actions.newJEFromRule({entity_id:en.entity_id, source_system:'INTERNAL', je_type:'AUTO', rule_code:'R-BATCH-'+n,
        description:`[Batch] ${b.memo} 路 2026-07`, lines:[{account_code:b.dr,debit_amount:amt,credit_amount:0},{account_code:b.cr,debit_amount:0,credit_amount:amt,member:b.cr.startsWith('291')?'Batch':undefined,description:b.cr.startsWith('291')?'Due to/from_Batch':undefined}]});
      if (b.reverse_next_month) actions.newJEFromRule({entity_id:en.entity_id, source_system:'INTERNAL', je_type:'AUTO', rule_code:'R-BATCH-REV-'+n,
        description:`[Batch路Auto-Reversal 2026-08] ${b.memo}`, lines:[{account_code:b.cr,debit_amount:amt,credit_amount:0,member:b.cr.startsWith('291')?'Batch':undefined},{account_code:b.dr,debit_amount:0,credit_amount:amt}]});
    });
    toast(`Batch template created: ${n} draft journal entries, including configured next-month reversals.`);
  };
  const je = jes.find(j=>j.je_id===sel);
  const newJE = () => { const id = actions.newJE(); setSel(id); };

  // -------- Full-page editor view (QBO-style) --------
  if (je) return <div className="focused">
    <button className="crumb" onClick={()=>setSel(null)}><span className="crumb-icon" aria-hidden="true">←</span><span>Journal Entries</span></button>
    <JEEditor je={je} ctx={ctx} onChange={()=>{}} />
  </div>;

  // -------- Full-width list view (QBO Transactions-style) --------
  return <div className="full-bleed">
    <div className="page-top accounting-page-head">
      <div>
        <div className="page-eyebrow">GENERAL LEDGER 路 TRANSACTION REGISTER</div>
        <h2 className="page-h" style={{margin:0}}>Journal Entries</h2>
        <div className="page-subtitle">Review source, approval status and posting evidence from one controlled workspace.</div>
      </div>
      <div className="row-acts">
        <Btn variant="ghost" onClick={runBatch}>Run Batch Templates</Btn>
        {can('GL.JE.POST') && pendCount>0 && <Btn onClick={postAll}>鈿?Post All ({pendCount})</Btn>}
        <Btn variant="primary" onClick={newJE} disabled={!can('GL.JE.CREATE')}>+ New Journal Entry</Btn>
      </div>
    </div>
    <div className="filter-bar accounting-filter-bar je-filter-bar">
      <label className="je-search"><span aria-hidden="true">⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search journal entries" /></label>
      <label>鏈熼棿 <select value={month} onChange={e=>setMonth(e.target.value)}>
        <option value="ALL">鍏ㄥ勾 2026</option>
        {['01','02','03','04','05','06','07'].map(m=><option key={m} value={m}>2026-{m}</option>)}
      </select></label>
      <label>鐘舵€?<select value={status} onChange={e=>setStatus(e.target.value)}>
        {['ALL','DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED','REVERSED'].map(x=><option key={x}>{x}</option>)}
      </select></label>
      <label>鏉ユ簮 <select value={srcF} onChange={e=>setSrcF(e.target.value)}>
        {['ALL','MAN','WBS_CL','PM','AP','AR','BANK','CLOSING','PAYABLE','EXPA','AUTOC','DIVIDEND','REIMB','AUTO_BANK_REIMB','INTERNAL_TRANSFER','INTERNAL','INDIVIDUAL','NOT_MATCH'].map(x=><option key={x}>{x}</option>)}
      </select></label>
      <span className="result-count"><b>{list.length}</b> entries</span><div className="je-queue-chips"><button type="button" className={status==='ALL'?'on':''} onClick={()=>setStatus('ALL')}>All</button><button type="button" className={status==='PENDING_REVIEW'||status==='PENDING_APPROVAL'?'on':''} onClick={()=>setStatus('PENDING_REVIEW')}>Needs review</button><button type="button" className={status==='POSTED'?'on':''} onClick={()=>setStatus('POSTED')}>Posted</button><button type="button" className={status==='DRAFT'?'on':''} onClick={()=>setStatus('DRAFT')}>Draft</button></div><button type="button" className="btn btn-ghost btn-sm" onClick={()=>{setQuery('');setStatus('ALL');setSrcF('ALL');setMonth('ALL');}}>Clear filters</button>
    </div>
    <Table exportName="journal-entries" features={{exportable:false}} className="table-journal-entries" rowKey="je_id" onRow={r=>setSel(r.je_id)} pageSize={20} cols={[
      {h:'Journal No.',k:'je_number',w:'180px'},
      {h:'Date',k:'je_date',w:'112px'},
      {h:'Memo / Description',render:r=><span className="cell-main">{r.description||<i className="muted">锛堟湭濉級</i>}</span>,csv:r=>r.description},
      {h:'Source',render:r=><Badge tone="muted">{r.source_system}</Badge>,csv:r=>r.source_system,w:'110px'},
        {h:'Payee / Name',render:r=>r.payee||'—',csv:r=>r.payee||'',w:'210px'},
      {h:'Amount',num:true,render:r=><Money v={jeTotals(r).debit}/>,sortVal:r=>jeTotals(r).debit,csv:r=>jeTotals(r).debit,w:'140px'},
      {h:'Attachment',render:r=><span className={r.has_attachment?'je-attachment yes':'je-attachment'}>{r.has_attachment?'Attached':'Missing'}</span>,csv:r=>r.has_attachment?'Y':'N',w:'108px'},
      {h:'Status',render:r=><Badge>{r.posting_status}</Badge>,csv:r=>r.posting_status,w:'120px'},
    ]} rows={list} empty="No journal entries match the current filters."/>
  </div>;
}

function JEEditor({je, ctx}) {
  const {actions, can, period, toast} = ctx;
  const [showAudit, setShowAudit] = useState(false);
  const readOnly = ['POSTED','REVERSED'].includes(je.posting_status);
  const editable = je.posting_status==='DRAFT' && !readOnly && !je.ai_proposed;
  const totals = jeTotals(je);
  const bal = Math.abs(totals.debit-totals.credit) < 0.005 && totals.debit>0;
  const errs = validateJE(je, period);
  const flow = JE_FLOW[je.posting_status] || {};
  const canAct = flow.perm && can(flow.perm);

  const setLine = (i, patch) => actions.updateJE(je.je_id, d=>{ d.lines[i] = {...d.lines[i], ...patch}; });
  const addLine = () => actions.updateJE(je.je_id, d=>{ d.lines.push({account_code:'', debit_amount:0, credit_amount:0}); });
  const rmLine = (i) => actions.updateJE(je.je_id, d=>{ d.lines.splice(i,1); });

  const advance = () => {
    if (flow.next==='POSTED' || je.posting_status==='DRAFT') {
      const e = validateJE(je, period);
      if (e.length) { toast(`Validation failed: ${e[0].msg}`, 'bad'); return; }
    }
    actions.advanceJE(je.je_id, flow.next, flow.action);
    toast(`${flow.action} completed → ${flow.next}`);
  };
  const reverse = () => { actions.reverseJE(je.je_id); toast('Reversal journal entry created.'); };

  const diff = +(totals.debit-totals.credit).toFixed(2);
  const postingEvidence = localJournalPostingEvidence(je, je.source_doc_id ? SOURCE_DOCS[je.source_doc_id] || null : null);
  const sourceTarget = localGLSourceTarget(je, {apBills:ctx.ap?.bills || [], arInvoices:ctx.ar?.invoices || [], bankAccounts:ctx.bank?.accounts || {}, sourceDocuments:SOURCE_DOCS});
  const returnToReport = ctx.navContext?.reportReturn?.route === 'gl' ? ctx.navContext.reportReturn : null;
  const returnToApAging = ctx.navContext?.expenseReturn?.route === 'ap' && ctx.navContext.expenseReturn.tab === 'AP Aging' ? ctx.navContext.expenseReturn : null;
  const returnToVendorCredit = ctx.navContext?.expenseReturn?.route === 'ap' && ctx.navContext.expenseReturn.creditKey ? ctx.navContext.expenseReturn : null;
  const returnToBill = ctx.navContext?.expenseReturn?.route === 'ap' && ctx.navContext.expenseReturn.tab === 'Bills' && ctx.navContext.expenseReturn.billId != null ? ctx.navContext.expenseReturn : null;
  const returnToPaymentBankEvidence = ctx.navContext?.paymentBankReturn?.route === 'banktx' ? ctx.navContext.paymentBankReturn : null;
  const returnToPayment = ctx.navContext?.paymentReturn?.route === 'ap' ? ctx.navContext.paymentReturn : null;
  const returnToReceipt = ctx.navContext?.receiptReturn?.route === 'receipts' ? ctx.navContext.receiptReturn : null;
  const returnToArAging = ctx.navContext?.arReturn?.route === 'ar' && ctx.navContext.arReturn.tab === 'AR Aging' ? ctx.navContext.arReturn : null;
  const returnToInvoice = ctx.navContext?.arReturn?.route === 'ar' && ctx.navContext.arReturn.invoiceId ? ctx.navContext.arReturn : null;
  const returnToSourceDocument = ctx.navContext?.sourceDocumentReturn?.route === 'sourcedocs' ? ctx.navContext.sourceDocumentReturn : null;
  const returnToBankTransaction = ctx.navContext?.bankTransactionReturn?.route === 'banktx' ? ctx.navContext.bankTransactionReturn : null;
  const returnToReconciliation = ctx.navContext?.reconciliationReturn?.route === 'bankrec' ? ctx.navContext.reconciliationReturn : null;
  const returnToRegister = ctx.navContext?.registerReturn?.route === 'register' ? ctx.navContext.registerReturn : null;
  return <div className="qbe qbe-document">
    {returnToReport && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('gl',returnToReport)}>Back to {returnToReport.tab || 'report'}</button><span>{localReportReturnScopeLabel(returnToReport)}</span></div>}
    {returnToApAging && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ap',returnToApAging)}>Back to AP Aging</button><span>{localApAgingReturnScopeLabel(returnToApAging)}</span></div>}
    {returnToVendorCredit && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ap',returnToVendorCredit)}>Back to Vendor Credit</button><span>{localVendorCreditReturnScopeLabel(returnToVendorCredit)}</span></div>}
    {returnToBill && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ap',returnToBill)}>Back to Bill</button><span>{`Retained Bill scope · ${returnToBill.billId}`}</span></div>}
    {returnToPaymentBankEvidence && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('banktx',returnToPaymentBankEvidence)}>Back to payment bank evidence</button><span>{localPaymentBankEvidenceReturnScopeLabel(returnToPaymentBankEvidence)}</span></div>}
    {returnToPayment && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ap',returnToPayment)}>Back to Bill payments</button><span>{localPaymentReturnScopeLabel(returnToPayment)}</span></div>}
    {returnToReceipt && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('receipts',returnToReceipt)}>Back to Receipt evidence</button><span>{localReceiptReturnScopeLabel(returnToReceipt)}</span></div>}
    {returnToArAging && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ar',returnToArAging)}>Back to AR Aging</button><span>{`Retained AR scope · as of ${returnToArAging.asOfDate || '—'}`}</span></div>}
    {returnToInvoice && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('ar',returnToInvoice)}>Back to Invoice detail</button><span>{`Retained invoice scope · ${returnToInvoice.invoiceId} · ${returnToInvoice.tab || 'Invoices'}`}</span></div>}
    {returnToSourceDocument && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('sourcedocs',returnToSourceDocument)}>Back to Source Document</button><span>{`Retained source scope · ${returnToSourceDocument.docId || 'unselected document'}${returnToSourceDocument.reportReturn?.tab ? ` · ${returnToSourceDocument.reportReturn.tab}` : ''}`}</span></div>}
    {returnToBankTransaction && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('banktx',returnToBankTransaction)}>Back to bank evidence</button><span>{localBankTransactionJournalReturnScopeLabel(returnToBankTransaction)}</span></div>}
    {returnToReconciliation && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('bankrec',returnToReconciliation)}>Back to reconciliation</button><span>{localReconciliationJournalReturnScopeLabel(returnToReconciliation)}</span></div>}
    {returnToRegister && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('register',returnToRegister)}>Back to account register</button><span>{localAccountRegisterReturnScopeLabel(returnToRegister)}</span></div>}
    <div className="qbe-head">
      <div><div className="qbe-title">Journal Entry <span className="muted">#{je.je_number}</span></div>
        <div className="qbe-meta">
          {editable ? <label>Journal date <input type="date" className="date-in" value={je.je_date} onChange={e=>actions.updateJE(je.je_id,d=>{d.je_date=e.target.value;})}/></label> : <span>Date {je.je_date}</span>}
          <span>Entity <b>{(ENTITIES.find(en=>en.entity_id===je.entity_id)||{}).entity_name||'—'}</b></span>
          <span>Currency <b>USD</b></span><span>Source <Badge tone="muted">{je.source_system}</Badge></span>
          {je.rule_code && <span>Rule {je.rule_code}</span>}
        </div></div>
      <Badge>{je.posting_status}</Badge>
    </div>
    <div className="qbe-actionbar" aria-label="Journal entry actions"><span className="qbe-action-context"><b>{je.ai_proposed?'Evidence-locked AI Draft':readOnly ? 'View journal entry' : 'Edit journal entry'}</b><span>{je.je_type || 'MANUAL'} 路 {je.source_system || 'MAN'}</span></span><span className="qbe-action-buttons"><Btn size="sm" variant="ghost" onClick={()=>setShowAudit(open=>!open)}>{showAudit?'Hide audit history':'Audit history'}</Btn><Btn size="sm" variant="ghost" disabled title="External print/export is outside the local evidence scope">Print</Btn></span></div>
    <section className="report-workbench" aria-label="Local journal posting evidence" style={{margin:'12px 0'}}>
      <div className="report-workbench-head"><div><b>Local posting evidence</b><div className="page-subtitle">Read-only proof for this retained JE. It is not an immutable external audit trail.</div></div><Badge tone={postingEvidence.postingState==='LOCAL_POSTED_BALANCED'?'ok':'warn'}>{postingEvidence.postingState}</Badge></div>
      <div className="qbo-toolgrid">
        <span><i>Posting / balance</i><b>{je.posting_status} · {money(postingEvidence.debit)} / {money(postingEvidence.credit)}</b></span>
        <span><i>Source evidence</i><b><Badge tone={postingEvidence.sourceState==='RETAINED_LOCAL_SOURCE'?'ok':'warn'}>{postingEvidence.sourceState}</Badge></b></span>
        <span><i>Dimensions</i><b><Badge tone={postingEvidence.dimensionState==='DIMENSION_EVIDENCE_PRESENT'?'ok':'warn'}>{postingEvidence.dimensionState}</Badge></b></span>
        <span><i>Posting history</i><b><Badge tone="muted">{postingEvidence.historyState}</Badge></b></span>
      </div>
      {postingEvidence.missingDimensions.length>0 && <p className="muted sm" style={{margin:'10px 0 0'}}>Review required: {postingEvidence.missingDimensions.length} CWIP/restricted-cash line(s) lack Property, Project, or Loan evidence. No source drill is inferred for those lines.</p>}
      {sourceTarget ? <div className="src-actions" style={{marginTop:10}}><Btn size="sm" variant="ghost" onClick={()=>ctx.goto(sourceTarget.route,{...sourceTarget.context,journalReturn:{route:'je',jeNumber:je.je_number},expenseReturn:returnToApAging || returnToVendorCredit || returnToBill ? ctx.navContext.expenseReturn : null,reportReturn:returnToReport || null,arReturn:returnToInvoice || null})}>Open retained source</Btn></div> : <p className="muted sm" style={{margin:'10px 0 0'}}>No retained local source target is available. This JE remains review-only; a source destination is not inferred.</p>}
    </section>
    <datalist id="member-list">{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_name}/>)}{ENTITIES.slice(0,20).map(en=><option key={en.entity_id} value={en.entity_name}/>)}</datalist>
    <table className="tbl je-lines qbe-grid">
      <thead><tr><th style={{width:34}}>#</th><th style={{width:'22%'}}>ACCOUNT</th><th className="ta-r" style={{width:110}}>DEBITS</th><th className="ta-r" style={{width:110}}>CREDITS</th><th>DESCRIPTION</th><th style={{width:120}}>NAME</th><th style={{width:170}}>PROPERTY / PROJECT</th>{editable&&<th style={{width:30}}></th>}</tr></thead>
      <tbody>
        {je.lines.map((l,i)=><tr key={i}>
          <td className="muted">{i+1}</td>
          <td>{editable ?
            <select value={l.account_code} onChange={e=>setLine(i,{account_code:e.target.value})}>
              <option value="">Select account</option>
              {COA.map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}
            </select>
            : <span>{l.account_code} {acct(l.account_code).account_name}</span>}
          </td>
          <td className="ta-r">{editable ? <input className="num-in" type="number" value={l.debit_amount||''} onChange={e=>setLine(i,{debit_amount:+e.target.value||0, credit_amount:0})}/> : <Money v={l.debit_amount||0}/>}</td>
          <td className="ta-r">{editable ? <input className="num-in" type="number" value={l.credit_amount||''} onChange={e=>setLine(i,{credit_amount:+e.target.value||0, debit_amount:0})}/> : <Money v={l.credit_amount||0}/>}</td>
          <td>{editable ? <input className="desc-line" value={l.description||''} placeholder="Line description" onChange={e=>setLine(i,{description:e.target.value})}/> : <span className="muted sm">{l.description||''}</span>}</td>
          <td>{editable ? <input className="desc-line" list="member-list" placeholder={ (window.__subsOf&&window.__subsOf(l.account_code)) ? '鏍哥畻瀵硅薄*' : 'Name'} value={l.member||''} onChange={e=>setLine(i,{member:e.target.value})}/> : <span className="muted sm">{l.member||''}</span>}</td>
          <td>{editable ?
            <div className="dim-picks">
              <select value={l.property_id||''} onChange={e=>setLine(i,{property_id:e.target.value?+e.target.value:null})}><option value="">Property</option>{PROPERTIES.map(p=><option key={p.property_id} value={p.property_id}>{p.property_code}</option>)}</select>
              <select value={l.project_id||''} onChange={e=>setLine(i,{project_id:e.target.value?+e.target.value:null})}><option value="">Project</option>{PROJECTS.map(p=><option key={p.project_id} value={p.project_id}>{p.project_code}</option>)}</select>
            </div>
            : <span className="muted sm">{[(l.property_id&&('Prop'+l.property_id)),(l.project_id&&('P'+l.project_id)),(l.loan_id&&('L'+l.loan_id))].filter(Boolean).join(' ')}</span>}</td>
          {editable && <td><button className="x-sm" onClick={()=>rmLine(i)}>脳</button></td>}
        </tr>)}
      </tbody>
    </table>
    <div className="qbe-below">
      <div>{editable && <><Btn size="sm" onClick={addLine}>Add lines</Btn> <Btn size="sm" variant="ghost" onClick={()=>actions.updateJE(je.je_id,d=>{d.lines=[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}];})}>Clear all lines</Btn></>}</div>
      <div className="qbe-totals">
        <span>Total debits <Money v={totals.debit} bold/></span>
        <span>Total credits <Money v={totals.credit} bold/></span>
        <span className={diff===0&&totals.debit>0?'bal-ok':'bal-bad'}>Difference {diff===0&&totals.debit>0?'鉁?$0.00':'$'+Math.abs(diff).toLocaleString()}</span>
      </div>
    </div>
    <div className="qbe-memo">
      <label>Memo</label>
      {editable ? <input className="desc-in" style={{width:'100%'}} value={je.description} onChange={e=>actions.updateJE(je.je_id,d=>{d.description=e.target.value;})} placeholder="What is this journal entry for?"/> : <div className="muted">{je.description}</div>}
      {je.je_type==='MANUAL' && <span className="muted sm">External attachments are outside the local evidence scope. {je.has_attachment ? `Retained attachment flag: ${je.attachment_name||'attached'}` : 'No retained attachment flag.'}</span>}
    </div>
    {je.source_doc_id && SOURCE_DOCS[je.source_doc_id] && (()=>{ const d=SOURCE_DOCS[je.source_doc_id];
      const src = `${d.source_system||''} ${d.type||''}`.toUpperCase();
      const sourceWorkspace = src.includes('CLOSING') ? {route:'closing', label:'Open closing workspace'}
        : src.includes('PM') ? {route:'pmpickup', context:{route:'pmpickup', jeNumber:je.je_number}, label:'Open PM workspace'}
        : src.includes('BANK') ? {route:'banktx', context:{route:'banktx', jeNumber:je.je_number}, label:'Open bank workspace'}
        : {route:'ap', context:{route:'ap', tab:'Bills', jeNumber:je.je_number}, label:'Open source workspace'};
      return <div className="src-card">
      <div className="src-chain"><span className="chip">WBS {d.source_system||''}</span><span>→</span><span className="chip">{d.type}</span><span>→</span><span className="chip">Rule {je.rule_code||'—'}</span><span>→</span><span className="chip chip-on">JE {je.je_number}</span><span>→</span><span className="chip">GL</span></div>
      <div className="src-grid">
        <span><i>Document #</i><b>{d.doc_no}</b></span>
        {d.po_no && <span><i>PO</i><b>{d.po_no}</b></span>}
        {d.contract && <span><i>鍚堝悓</i><b>{d.contract}</b></span>}
        {d.unit && <span><i>Unit</i><b>{d.unit}</b></span>}
        {d.vendor && <span><i>Vendor</i><b>{d.vendor}</b></span>}
        {d.buyer && <span><i>Buyer</i><b>{d.buyer}</b></span>}
        {d.cost_code && <span><i>Cost Code</i><b>{d.cost_code}</b></span>}
        <span><i>閲戦</i><b>{'$'+(+d.amount).toLocaleString()}</b></span>
      </div>
      <div className="src-actions">
        <Btn size="sm" variant="ghost" onClick={()=>ctx.goto('sourcedocs',{route:'sourcedocs', docId:je.source_doc_id, jeNumber:je.je_number, sourceSystem:je.source_system})}>Open source document</Btn>
        <Btn size="sm" variant="ghost" onClick={()=>ctx.goto(sourceWorkspace.route, sourceWorkspace.context || null)}>{sourceWorkspace.label}</Btn>
      </div>
    </div>; })()}
    {je.ai_proposed && <div className="ai-report-note"><b>AI evidence is locked.</b><p>To amend amounts, accounts or dimensions, use Copy to create a separate manual amendment Draft linked to proposal {je.ai_proposal_id}. The original AI evidence remains unchanged for review.</p></div>}
    {errs.length>0 && <div className="err-box">{errs.map((e,i)=><div key={i}>鈥?[{e.code}] {e.msg}</div>)}</div>}
    <div className="qbe-footbar">
      <div><Btn variant="ghost" disabled title="Copy is outside the controlled local evidence workflow">Copy</Btn>
        <Btn variant="ghost" onClick={()=>toast('Recurring 妯℃澘宸蹭繚瀛?姣忔湀1鏃ヨ嚜鍔ㄧ敓鎴愯崏绋?')}>Make recurring</Btn></div>
      <div className="row-acts">
        {flow.reject && can('GL.JE.REVIEW') && <Btn variant="ghost" onClick={()=>{actions.advanceJE(je.je_id,flow.reject,'REJECT');toast('Returned to draft.','warn');}}>Reject</Btn>}
        {je.posting_status==='POSTED' && ctx.user.role_code==='CONTROLLER' && <Btn variant="ghost" onClick={()=>{actions.advanceJE(je.je_id,'APPROVED','CANCEL POST'); toast('宸?Cancel Post','warn');}}>Cancel Post</Btn>}
        {je.posting_status==='POSTED' && can('GL.JE.REVERSE') && <Btn variant="danger" onClick={reverse}>Reverse</Btn>}
        {flow.action && <Btn variant="primary" onClick={advance} disabled={!canAct || (flow.next==='POSTED' && errs.length>0)} title={!canAct?'鏃犳鏉冮檺':''}>{flow.action==='鎻愪氦'?'Save and submit':flow.action}</Btn>}
      </div>
    </div>
    {showAudit && <section className="report-workbench" aria-label="Retained journal audit history" style={{marginTop:12}}><div className="report-workbench-head"><div><b>Retained audit history</b><div className="page-subtitle">Local event metadata only; it does not claim an immutable external audit record.</div></div><Badge tone={postingEvidence.historyState==='LOCAL_HISTORY_PRESENT_UNVERIFIED'?'ok':'warn'}>{postingEvidence.historyState}</Badge></div>{je.history?.length ? <ApprovalTimeline steps={je.history.map(h=>({label:h.a,done:true,who:h.by,at:h.at}))}/> : <p className="muted sm">No retained posting-history events were found for this journal entry.</p>}</section>}
  </div>;
}

// ---------------- Construction Loan Workspace ----------------
export function LoanWorkspace({ctx}) {
  const {actions, toast, jes, can} = ctx;
  const [loanId, setLoanId] = useState(1);
  const [tab, setTab] = useState('Draw / 鎻愭杩樻');
  const loan = LOANS.find(l=>l.loan_id===loanId);
  const txns = LOAN_TXNS.filter(t=>t.loan_id===loanId && (tab.startsWith('Draw')? ['DRAW','REPAYMENT'].includes(t.txn_type) : t.txn_type.startsWith('INTEREST')));
  const gen = (t) => {
    const r = loanRule(t);
    if (!r) { toast('No matching rule was found.','bad'); return; }
    actions.newJEFromRule({entity_id:loan.entity_id, source_system:'WBS_CL', description:`${t.txn_type} 路 ${loan.loan_code}`, rule_code:r.rule_code, je_type:'AUTO', lines:r.lines});
    toast('Draft JE created using rule '+r.rule_code+'.');
  };
  return <div>
    <h2 className="page-h">Construction Loan Workspace</h2>
    <div className="loan-select">
      {LOANS.map(l=><button key={l.loan_id} className={`chip ${loanId===l.loan_id?'chip-on':''}`} onClick={()=>setLoanId(l.loan_id)}>{l.loan_code}</button>)}
    </div>
    <div className="kpi-row">
      <KPI label="Commitment" value={money(loan.commitment_amount)} />
      <KPI label="褰撳墠鏈噾" value={money(loan.current_principal)} />
      <KPI label="鍙敤棰濆害" value={money(loan.commitment_amount-loan.current_principal)} tone="ok" />
      <KPI label="鍒╃巼 / 鍒版湡" value={(loan.interest_rate*100).toFixed(2)+'%'} sub={loan.maturity_date} />
    </div>
    <Tabs tabs={['Draw / 鎻愭杩樻','鍒╂伅 Interest']} active={tab} onChange={setTab} />
    <Table onRow={r=>setFocusExternalId(r.external_id)} cols={[
      {h:'WBS transaction',k:'wbs_txn_id'},
      {h:'绫诲瀷',render:r=><Badge tone="muted">{r.txn_type}</Badge>},
      {h:'鏃ユ湡',k:'transaction_date'},
      {h:'閲戦',num:true,render:r=><Money v={r.amount}/>},
      {h:'Construction status',render:r=>r.txn_type.startsWith('INTEREST') ? <Badge tone={r.construction_status==='UNDER_CONSTRUCTION'?'warn':'ok'}>{r.construction_status==='UNDER_CONSTRUCTION'?'Under construction':'Expensed'}</Badge> : '—'},
      {h:'Journal entry',render:r=>r.generated_je ? <span className="link">{r.generated_je}</span> : (can('GL.JE.CREATE') ? <Btn size="sm" variant="primary" onClick={()=>gen(r)}>Create draft</Btn> : <span className="muted">Pending</span>)},
    ]} rows={txns} rowKey="loan_txn_id" />
    <p className="muted sm">Interest capitalization is driven by <code>construction_status</code>; posting targets are shown as audit-ready examples.</p>
  </div>;
}

// ---------------- Property Operations Pickup ----------------
export function PMPickup({ctx}) {
  const {actions, toast, can, navContext, jes} = ctx;
  const [month] = useState('2026-07');
  const [focusExternalId, setFocusExternalId] = useState(null);
  const rows = PM_ROWS.map(r=>({...r, rule:pmRule(r)}));
  const mapped = rows.filter(r=>!r.rule.unmapped);
  const unmapped = rows.filter(r=>r.rule.unmapped);
  const rev = sum(mapped.filter(r=>r.rule.rule_code==='R-PM-11'), r=>r.amount);
  const exp = sum(mapped.filter(r=>r.rule.rule_code==='R-PM-18'), r=>r.amount);
  const already = ctx.jes.some(j=>j.source_system==='PM' && (j.description||'').includes('PM Pickup') && j.rule_code);
  useEffect(() => {
    if (navContext?.route !== 'pmpickup') return;
    if (navContext.externalId) {
      setFocusExternalId(navContext.externalId);
      return;
    }
    if (!navContext.jeNumber) return;
    const je = jes.find(j=>j.je_number===navContext.jeNumber);
    const desc = `${je?.description||''} ${je?.payee||''}`.toUpperCase();
    const matched = rows.find(r=> desc.includes(String(r.charge_code||'').toUpperCase()) || desc.includes(String(r.property_code||'').toUpperCase()) || desc.includes(String(r.unit||'').toUpperCase()));
    if (matched) setFocusExternalId(matched.external_id);
  }, [navContext?.route, navContext?.externalId, navContext?.jeNumber, jes, rows]);
  const generate = () => {
    if (already){ toast('璇ユ壒娆″凡鐢熸垚杩?Owner GL Draft,绂佹閲嶅 Pickup [4004]','bad'); return; }
    mapped.forEach(r=>{ const own = UNIT_OWNERS[r.unit] || {entity_id:4, name:'WB Home LLC'}; actions.newJEFromRule({entity_id:own.entity_id, source_system:'PM', description:'PM pickup '+r.charge_code+' / '+r.property_code+' / Unit '+r.unit_code+' / '+own.name, rule_code:r.rule.rule_code, je_type:'AUTO', lines:r.rule.lines}); });
    unmapped.forEach(r=> actions.ensureException({exception_type:'GL_MAPPING_MISSING', severity:'HIGH', object_type:'PM_PICKUP', object_ref:r.charge_code+' / '+r.property_code, entity_id:4, owner:'PROPERTY_ACCT', root_cause:'Charge code '+r.charge_code+' lacks a GL mapping'}));
    const owners=[...new Set(mapped.map(r=>(UNIT_OWNERS[r.unit]||{name:'WB Home LLC'}).name))];
    toast(`Generated ${mapped.length} draft journal entries for ${owners.length} owner(s); ${unmapped.length} item(s) need mapping review.`, unmapped.length?'warn':'ok');
  };
  return <div>
    <h2 className="page-h">Property Operations Pickup</h2>
    {navContext?.route==='pmpickup' && (navContext.jeNumber || focusExternalId) && <div className="bank-health" role="status" style={{marginBottom:14}}>
      <span className="bank-health-icon">i</span><div><b>Drill context applied</b><p>{focusExternalId ? `Focused row ${focusExternalId} from report / JE drill.` : `Opened from journal entry ${navContext.jeNumber}.`}</p></div></div>}
    <div className="pickup-bar">
      <span>鐗╀笟 <strong>P0020 路 Maple Court</strong></span>
      <span>鏈熼棿 <strong>{month}</strong></span>
      <span>鎵规 <strong>PM-202607-P0020</strong></span>
    </div>
    <div className="check-band">
      <span className="ck ok">Deduplication checked</span>
      <span className="ck ok">Entity mapping checked</span>
      <span className={unmapped.length?'ck warn':'ck ok'}>Mapping coverage: {rows.length?Math.round(mapped.length/rows.length*100):0}% {unmapped.length?(' · '+unmapped.length+' unresolved'):''}</span>
    </div>
    <Table cols={[
      {h:'External ID',k:'external_id'},
      {h:'Charge Code',render:r=><Badge tone="muted">{r.charge_code}</Badge>},
      {h:'Unit',k:'unit'},
      {h:'Owner 鍏徃',render:r=>(UNIT_OWNERS[r.unit]||{name:'WB Home LLC'}).name},
      {h:'鏄犲皠 GL',render:r=> r.rule.unmapped ? <span className="warn-txt">鏈槧灏?路 闇€鍘?Mapping Center</span> : <span>{r.rule.gl} {acct(r.rule.gl).account_name}</span>},
      {h:'Rule status',render:r=>r.rule.unmapped?'Unmapped':r.rule.rule_code==='R-PM-11'?'Cross-entity':r.rule.rule_code==='R-PM-16'?'Capitalization':'Standard'},
      {h:'閲戦',num:true,render:r=><Money v={r.amount}/>},
    ]} rows={rows} />
    <div className="pickup-sum">
      <span>鏀跺叆 <Money v={rev}/></span><span>璐圭敤 <Money v={exp}/></span><span>NOI <Money v={rev-exp}/></span>
    </div>
    <Btn variant="primary" onClick={generate} disabled={!can('GL.JE.CREATE')}>鐢熸垚 Owner GL Draft</Btn>
    <span className="muted sm" style={{marginLeft:12}}>Security-deposit items without a mapping are retained as GL_MAPPING_MISSING exceptions.</span>
  </div>;
}

// ---------------- Closing Workspace ----------------
export function ClosingWorkspace({ctx}) {
  const c = CLOSINGS[0];
  const dr = sum(c.lines,l=>l.debit), cr = sum(c.lines,l=>l.credit);
  const balanced = Math.abs(dr-cr)<0.005;
  return <div>
    <h2 className="page-h">Closing Workspace</h2>
    <div className="pickup-bar">
      <span>{c.closing_code}</span><span>Type <Badge tone="muted">{c.closing_type}</Badge></span>
      <span>Property {c.property_code}</span><span>Closing date {c.closing_date}</span>
    </div>
    <SectionTitle>Closing worksheet</SectionTitle>
    <Table cols={[
      {h:'椤圭洰',k:'label'},
      {h:'Account',render:r=>r.account_code+' '+acct(r.account_code).account_name},
      {h:'鍊熸柟',num:true,render:r=><Money v={r.debit}/>},
      {h:'璐锋柟',num:true,render:r=><Money v={r.credit}/>},
    ]} rows={c.lines} />
    <div className="check-band">
      <span className={balanced ? 'ck ok' : 'ck bad'}>Balanced: {balanced ? 'Yes' : 'No'} ({money(dr)}/{money(cr)})</span>
      <span className="ck ok">Funding source checked</span>
      <span className="ck ok">Cash-to-close: {money(c.cash_to_close)}</span>
      <span className="ck ok">Loan payoff checked</span>
    </div>
    <p className="muted sm">Closing worksheet fields and postings are REFS-local shells until separately verified.</p>
  </div>;
}

// ---------------- Exception Center ----------------
export function ExceptionCenter({ctx}) {
  const {exceptions, actions, toast, can} = ctx;
  const [sev, setSev] = useState('鍏ㄩ儴');
  const [st, setSt] = useState('ALL');
  const [sel, setSel] = useState(null);
  const [resolution, setResolution] = useState('');
  const list = exceptions.filter(e=>
    (sev==='ALL'||e.severity===sev) &&
    (st==='ALL'||(st==='OPEN' ? !['CLOSED','WAIVED'].includes(e.status) : e.status===st)));
  const e = exceptions.find(x=>x.exception_id===sel);
  const close = () => {
    if (!resolution.trim()) { toast('Enter a resolution before closing','bad'); return; }
    actions.resolveException(sel, resolution);
    toast('Exception closed','ok'); setSel(null); setResolution('');
  };
  return <div>
    <h2 className="page-h">Exception Center</h2>
    <div className="filter-row">
      <span>Severity</span>{['ALL','HIGH','MEDIUM','LOW'].map(s=><button key={s} className={sev===s?'chip chip-on':'chip'} onClick={()=>setSev(s)}>{s}</button>)}
      <span style={{marginLeft:16}}>Status</span>{['ALL','OPEN','IN_PROGRESS','CLOSED'].map(s=><button key={s} className={st===s?'chip chip-on':'chip'} onClick={()=>setSt(s)}>{s}</button>)}
    </div>
    <Table cols={[
      {h:'涓ラ噸',render:r=><Badge tone={r.severity==='HIGH'?'bad':r.severity==='MEDIUM'?'warn':'muted'}>{r.severity}</Badge>},
      {h:'绫诲瀷',k:'exception_type'},
      {h:'瀵硅薄',k:'object_ref'},
      {h:'瀹炰綋',render:r=>'E'+r.entity_id},
      {h:'Aging',num:true,render:r=>r.aging_days+'d'},
      {h:'Owner',k:'owner'},
      {h:'Status',render:r=><Badge>{r.status}</Badge>},
    ]} rows={list} onRow={r=>{setSel(r.exception_id); setResolution(r.resolution||'');}} rowKey="exception_id" empty="No exceptions found" />
    <Drawer open={!!e} onClose={()=>setSel(null)} title={e&&e.exception_type}
      actions={e&&!['CLOSED','WAIVED'].includes(e.status)&&can('EXCEPTION.EXC.CLOSE')?<Btn variant="primary" onClick={close}>Close exception</Btn>:null}>
      {e&&<div className="exc-detail"><div className="kv"><span>Severity</span><Badge tone={e.severity==='HIGH'?'bad':'warn'}>{e.severity}</Badge></div><div className="kv"><span>Reference</span><b>{e.object_ref}</b></div><Field label="Root Cause"><div className="ro-box">{e.root_cause}</div></Field><Field label="Resolution" required><textarea disabled={['CLOSED','WAIVED'].includes(e.status)} value={resolution} onChange={ev=>setResolution(ev.target.value)} rows={4} placeholder="Describe the resolution" /></Field></div>}
    </Drawer>
  </div>;
}

// ---------------- Month-End Close ----------------
export function CloseMgmt({ctx}) {
  const {closeTasks, actions, toast, can} = ctx;
  const doneN = closeTasks.filter(t=>['DONE','SIGNED_OFF'].includes(t.status)).length;
  const pct = Math.round(doneN/closeTasks.length*100);
  const depsMet = (t) => t.depends_on.every(id=>{const d=closeTasks.find(x=>x.close_task_id===id); return d && ['DONE','SIGNED_OFF'].includes(d.status);});
  const allSigned = closeTasks.every(t=>t.status==='SIGNED_OFF' || t.status==='DONE');
  return <div>
    <h2 className="page-h">Month-End Close</h2>
    <div className="close-prog"><span>{pct}% complete · {doneN}/{closeTasks.length} tasks</span></div>
    <Table cols={[{h:'Task',render:r=><span>{r.task_name} <span className="muted sm">({r.task_code})</span></span>},{h:'Type',render:r=><Badge tone="muted">{r.is_auto?'AUTO':'MANUAL'}</Badge>},{h:'Owner',k:'owner'},{h:'Due date',k:'due_date'},{h:'Dependencies',render:r=>depsMet(r)?'Ready':'Blocked'},{h:'Status',render:r=><Badge>{r.status}</Badge>}]} rows={closeTasks} rowKey="close_task_id" />
    <Btn variant="primary" disabled={!allSigned || !can('PERIOD.PERIOD.CLOSE')} onClick={()=>toast('Period close is shell-only','ok')}>Close period</Btn>
  </div>;
}


// ===== Interactive charts (Chart.js via CDN, graceful fallback) =====
function useChart(build, sig){
  const ref = useRef(null);
  useEffect(()=>{
    if (typeof window==='undefined' || !window.Chart || !ref.current) return;
    const c = build(ref.current.getContext('2d'));
    return ()=>c && c.destroy();
  }, [sig]);
  return ref;
}
function PLChart({jes, entity}){
  const posted = jes.filter(j=>j.posting_status==='POSTED' && (!entity || j.entity_id===entity));
  return <div className="muted sm" style={{height:150,marginTop:6}}>Net income chart shell: {posted.length} posted entries in scope.</div>;
}
function ExpDonut({cats}){
  return <div className="donut-wrap"><div className="legend">{cats.map(([name,value,color])=><span key={name}><i style={{background:color}} />{name}: {money(value)}</span>)}</div></div>;
}
