import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Drawer, Tabs, Field, SectionTitle, ApprovalTimeline } from './ui.jsx';
import { COA, PROPERTIES, LOANS, ENTITIES, PERIODS, PROJECTS, VENDORS } from './data.js';
import { PM_ROWS, CLOSINGS, LOAN_TXNS, IC_TXNS, UNIT_OWNERS, SOURCE_DOCS } from './seed.js';
import { acct, money, sum, jeTotals, isBalanced, validateJE, JE_FLOW, loanRule, pmRule, trialBalance, statements } from './engine.js';
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
  const expCats = [['运营 Opex', Math.max(1,st.expense*0.42), '#2CA01C'], ['利息 Interest', Math.max(1,st.expense*0.31), '#0077C5'], ['管理费 Mgmt', Math.max(1,st.expense*0.17), '#FF8000'], ['其他 Other', Math.max(1,st.expense*0.10), '#8A5BE0']];
  const expTot = expCats.reduce((s,[,v])=>s+v,0);
  let acc=0; const segs = expCats.map(([n,v,c])=>{ const from=acc/expTot*360; acc+=v; return `${c} ${from}deg ${acc/expTot*360}deg`; }).join(', ');
  const plBars = [12,18,9,22,15,26,Math.max(4,Math.round(st.netIncome/4000))];
  return <div>
    <h2 className="page-h">财务工作台 Business Overview</h2>
    <div className="qbo-grid">
      <div className="qbo-card" onClick={()=>goto('gl')} style={{cursor:'pointer'}}>
        <h4>Profit & Loss · 2026-07</h4>
        <div className={`qbo-big ${st.netIncome<0?'num-neg':''}`}>{money(st.netIncome)}</div>
        <div className="qbo-sub">净利 Net income · 收入 {money(st.revenue)} − 费用 {money(st.expense)}</div>
        <PLChart jes={jes} entity={entity}/>
      </div>
      <div className="qbo-card" onClick={()=>goto('reports')} style={{cursor:'pointer'}}>
        <h4>Expenses · 本期费用</h4>
        <div className="qbo-big">{money(st.expense)}</div>
        <ExpDonut cats={expCats}/>
      </div>
      <div className="qbo-card" onClick={()=>goto('bankrec')} style={{cursor:'pointer'}}>
        <h4>Bank Accounts · 银行账户</h4>
        {Object.entries(bank.accounts).map(([code,a])=><div key={code} className="bank-row"><span>{code} · {a.bank_name}</span><Money v={a.gl_book_balance}/></div>)}
        <div className="qbo-sub" style={{marginTop:8}}>{bankUnmatched} 笔未匹配流水 → 去对账</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('ap')} style={{cursor:'pointer'}}>
        <h4>Bills · 应付</h4>
        <div className="qbo-big">{money(sum(openBills,b=>b.amount))}</div>
        <div className="split-bar"><span style={{flex:Math.max(1,openBills.length), background:'#FF8000'}}/><span style={{flex:Math.max(1,paidBills.length), background:'#2CA01C'}}/></div>
        <div className="qbo-sub">{openBills.length} 张未付 · {paidBills.length} 张已付</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('close')} style={{cursor:'pointer'}}>
        <h4>Month-End Close · 关账</h4>
        <div className="qbo-big">{Math.round(doneTasks/closeTasks.length*100)}%</div>
        <div className="split-bar"><span style={{flex:Math.max(1,doneTasks), background:'#2CA01C'}}/><span style={{flex:Math.max(1,closeTasks.length-doneTasks), background:'#d4d7dc'}}/></div>
        <div className="qbo-sub">{doneTasks}/{closeTasks.length} 任务完成 · 期间 2026-07 OPEN</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('exceptions')} style={{cursor:'pointer'}}>
        <h4>Exceptions · 未决异常</h4>
        <div className="qbo-big num-neg">{openExc.length}</div>
        <div className="qbo-sub">{openExc.filter(e=>e.severity==='HIGH').length} 高 · {openExc.filter(e=>e.severity==='MEDIUM').length} 中 · 最长 aging {Math.max(0,...openExc.map(e=>e.aging_days))} 天</div>
      </div>
    </div>
    <SectionTitle>Things to do · 待处理</SectionTitle>
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
    <SectionTitle>Shortcuts · 快捷操作</SectionTitle>
    <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:22}}>
      {[['+ Create Bill','ap'],['+ Journal Entry','je'],['Match Bank Txn','banktx'],['Run PM Pickup','pmpickup'],['Import Loan Txns','loan'],['Start Reconciliation','bankrec'],['+ Invoice','ar'],['Process Closing','closing']].map(([l,r])=>
        <Btn key={l} onClick={()=>goto(r)}>{l}</Btn>)}
    </div>
    <SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>goto('approvals')}>查看全部</Btn>}>待审批队列 Approvals ({pendingApprovals.length})</SectionTitle>
    <Table rowKey="je_id" onRow={r=>goto('je')} cols={[
      {h:'JE 编号',k:'je_number'},{h:'描述',k:'description'},
      {h:'来源',render:r=><Badge tone="muted">{r.source_system}</Badge>},
      {h:'金额',num:true,render:r=><Money v={jeTotals(r).dr}/>},
      {h:'状态',render:r=><Badge>{r.posting_status}</Badge>},
    ]} rows={pendingApprovals} empty="没有待审批分录"/>
  </div>;
}

// ---------------- Journal Entry Workspace ----------------
export function JEWorkspace({ctx}) {
  const {jes, actions, can, period, toast} = ctx;
  const [sel, setSel] = useState(null);
  const [status, setStatus] = useState('ALL');
  const [srcF, setSrcF] = useState('ALL');
  const [month, setMonth] = useState('07');
  const list = jes.filter(j=>
    (status==='ALL'||j.posting_status===status) &&
    (!ctx.entity||j.entity_id===ctx.entity) &&
    (srcF==='ALL'||j.source_system===srcF) &&
    (month==='ALL'||j.period_code==='2026-'+month));
  const pendCount = list.filter(j=>j.posting_status==='APPROVED').length;
  const postApproved = () => { const results=list.filter(j=>j.posting_status==='APPROVED').map(j=>actions.advanceJE(j.je_id,'POSTED','POST ALL'));const ok=results.filter(r=>r?.ok).length;const blocked=results.length-ok;toast(`${ok} posted · ${blocked} blocked by permission/SoD`,blocked?'warn':'ok'); };
  const runBatch = () => {
    const en = {entity_id: ctx.entity||15, entity_code:'E'+(ctx.entity||15)};
    const s = loadSetting(en); let n=0;
    (s.batch_setting||[]).filter(b=>b.status!=='INACTIVE'&&b.dr&&b.cr).forEach(b=>{
      const amt = 1000; n++;
      actions.newJEFromRule({entity_id:en.entity_id, source_system:'INTERNAL', je_type:'AUTO', rule_code:'R-BATCH-'+n,
        description:`[Batch] ${b.memo} · 2026-07`, lines:[{account_code:b.dr,debit_amount:amt,credit_amount:0},{account_code:b.cr,debit_amount:0,credit_amount:amt,member:b.cr.startsWith('291')?'Batch':undefined,description:b.cr.startsWith('291')?'Due to/from_Batch':undefined}]});
      if (b.reverse_next_month) actions.newJEFromRule({entity_id:en.entity_id, source_system:'INTERNAL', je_type:'AUTO', rule_code:'R-BATCH-REV-'+n,
        description:`[Batch·Auto-Reversal 2026-08] ${b.memo}`, lines:[{account_code:b.cr,debit_amount:amt,credit_amount:0,member:b.cr.startsWith('291')?'Batch':undefined},{account_code:b.dr,debit_amount:0,credit_amount:amt}]});
    });
    toast(`Batch 模板已生成 ${n} 组 Draft(含 Reverse Next Month 自动冲回)`);
  };
  const je = jes.find(j=>j.je_id===sel);
  const newJE = () => { const id = actions.newJE(); setSel(id); };

  // -------- Full-page editor view (QBO-style) --------
  if (je) return <div className="focused">
    <button className="crumb" onClick={()=>setSel(null)}>← Journal Entries</button>
    <JEEditorV2 je={je} ctx={ctx} onClose={()=>setSel(null)} onOpen={setSel}/>
  </div>;

  // -------- Full-width list view (QBO Transactions-style) --------
  return <div className="full-bleed">
    <div className="page-top">
      <h2 className="page-h" style={{margin:0}}>Journal Entries</h2>
      <div className="row-acts">
        <Btn variant="ghost" onClick={runBatch}>Run Batch Templates</Btn>
        {can('GL.JE.POST') && pendCount>0 && <Btn onClick={postApproved}>Post approved ({pendCount})</Btn>}
        <Btn variant="primary" onClick={newJE} disabled={!can('GL.JE.CREATE')}>+ New Journal Entry</Btn>
      </div>
    </div>
    <div className="filter-bar">
      <label>期间 <select value={month} onChange={e=>setMonth(e.target.value)}>
        <option value="ALL">全年 2026</option>
        {['01','02','03','04','05','06','07'].map(m=><option key={m} value={m}>2026-{m}</option>)}
      </select></label>
      <label>状态 <select value={status} onChange={e=>setStatus(e.target.value)}>
        {['ALL','DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED','REVERSED'].map(x=><option key={x}>{x}</option>)}
      </select></label>
      <label>来源 <select value={srcF} onChange={e=>setSrcF(e.target.value)}>
        {['ALL','MAN','WBS_CL','PM','AP','AR','BANK','CLOSING','PAYABLE','EXPA','AUTOC','DIVIDEND','REIMB','AUTO_BANK_REIMB','INTERNAL_TRANSFER','INTERNAL','INDIVIDUAL','NOT_MATCH'].map(x=><option key={x}>{x}</option>)}
      </select></label>
      <span className="muted sm">{list.length} 笔</span>
    </div>
    <Table exportName="journal-entries" rowKey="je_id" onRow={r=>setSel(r.je_id)} pageSize={20} cols={[
      {h:'Journal No.',k:'je_number'},
      {h:'Date',k:'je_date'},
      {h:'Memo / Description',render:r=><span className="cell-main">{r.description||<i className="muted">（未填）</i>}</span>,csv:r=>r.description},
      {h:'Source',render:r=><Badge tone="muted">{r.source_system}</Badge>,csv:r=>r.source_system},
      {h:'Payee / Name',render:r=>r.payee||'—',csv:r=>r.payee||''},
      {h:'Amount',num:true,render:r=><Money v={jeTotals(r).debit}/>,sortVal:r=>jeTotals(r).debit,csv:r=>jeTotals(r).debit},
      {h:'Status',render:r=><Badge>{r.posting_status}</Badge>,csv:r=>r.posting_status},
    ]} rows={list} empty="本期无分录 — 点击右上角 New Journal Entry 开始做账"/>
  </div>;
}

function JEEditorV2({je,ctx,onClose,onOpen}){
  const {actions,can,period,toast,goto}=ctx;
  const [draft,setDraft]=useState(()=>structuredClone(je));
  const [confirmExit,setConfirmExit]=useState(false);
  useEffect(()=>{setDraft(structuredClone(je));setConfirmExit(false);},[je.je_id,je.posting_status,je.revision]);
  const editable=draft.posting_status==='DRAFT';
  const totals=jeTotals(draft);
  const errors=validateJE(draft,period);
  const flow=JE_FLOW[draft.posting_status]||{};
  const changed=editable&&JSON.stringify({...draft,history:undefined,dirty:undefined})!==JSON.stringify({...je,history:undefined,dirty:undefined});
  const setField=patch=>setDraft(d=>({...d,...patch,dirty:true}));
  const setLine=(i,patch)=>setDraft(d=>({...d,dirty:true,lines:d.lines.map((line,index)=>index===i?{...line,...patch}:line)}));
  const addLine=()=>setDraft(d=>({...d,dirty:true,lines:[...d.lines,{account_code:'',debit_amount:0,credit_amount:0,description:''}]}));
  const removeLine=i=>setDraft(d=>({...d,dirty:true,lines:d.lines.filter((_,index)=>index!==i)}));
  const save=()=>{const result=actions.saveJE(draft);if(!result?.ok){toast(result?.message||'Save blocked.','bad');return result;}setDraft(result.je);toast(`Saved revision ${result.je.revision}`);return result;};
  const saveClose=()=>{const result=save();if(result?.ok)onClose();};
  const saveNew=()=>{const result=save();if(result?.ok){const id=actions.newJE();onOpen(id);}};
  const advance=()=>{const result=editable?actions.saveAndAdvanceJE(draft,flow.next,flow.action):actions.advanceJE(draft.je_id,flow.next,flow.action);if(!result?.ok){toast(result?.message||'Workflow action blocked.','bad');return;}setDraft(result.je);toast(`${flow.action} · ${flow.next}`);};
  const copy=()=>{const result=actions.copyJE(draft.je_id);if(!result?.ok){toast(result?.message||'Copy blocked.','bad');return;}toast('A new manual Draft copy was created.');onOpen(result.je_id);};
  const recurring=()=>{const result=actions.makeRecurringJE(draft.je_id);if(!result?.ok){toast(result?.message||'Recurring template blocked.','bad');return;}toast(`Recurring template ${result.template.template_id} created.`);};
  const reverse=()=>{const result=actions.reverseJE(draft.je_id);if(!result?.ok){toast(result?.message||'Reverse blocked.','bad');return;}toast('Reversal posted with full source trace.');onOpen(result.je_id);};
  const reclass=()=>{const result=actions.reclassJE(draft.je_id);if(!result?.ok){toast(result?.message||'Reclass blocked.','bad');return;}toast('Reclass Draft created; attachment and approval are required.');onOpen(result.je_id);};
  const exit=()=>{if(changed)setConfirmExit(true);else onClose();};
  const difference=+(totals.debit-totals.credit).toFixed(2);
  const sourceDoc=draft.source_doc_id&&SOURCE_DOCS[draft.source_doc_id];

  return <div className="qbe">
    <div className="qbe-head">
      <div><div className="qbe-title">Journal entry <span className="muted">#{draft.je_number}</span></div><div className="qbe-meta">
        <span>Entity <b>{ENTITIES.find(e=>e.entity_id===draft.entity_id)?.entity_name||'—'}</b></span><span>Currency <b>{draft.currency||'USD'}</b></span><span>Source <Badge tone="muted">{draft.source_system}</Badge></span>{draft.rule_code&&<span>Rule <b>{draft.rule_code}</b></span>}
      </div></div><div style={{display:'flex',gap:8,alignItems:'center'}}>{changed&&<Badge tone="warn">UNSAVED</Badge>}<Badge>{draft.posting_status}</Badge></div>
    </div>

    <div style={{display:'grid',gridTemplateColumns:'180px 1fr',gap:16,margin:'16px 0'}}>
      <Field label="Journal date" required>{editable?<input type="date" value={draft.je_date} onChange={e=>setField({je_date:e.target.value})}/>:<div className="ro-box">{draft.je_date}</div>}</Field>
      <Field label="Memo" required>{editable?<input value={draft.description||''} onChange={e=>setField({description:e.target.value})} placeholder="What is this journal entry for?"/>:<div className="ro-box">{draft.description}</div>}</Field>
    </div>
    <datalist id="member-list-v2">{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_name}/>)}{ENTITIES.slice(0,30).map(e=><option key={e.entity_id} value={e.entity_name}/>)}</datalist>
    <div className="table-wrap"><table className="tbl je-lines qbe-grid"><thead><tr><th>#</th><th style={{width:'24%'}}>Account</th><th className="ta-r">Debits</th><th className="ta-r">Credits</th><th>Description</th><th>Name / subsidiary</th><th>Property / project</th>{editable&&<th/>}</tr></thead><tbody>
      {draft.lines.map((line,i)=><tr key={i}><td className="muted">{i+1}</td><td>{editable?<select value={line.account_code} onChange={e=>setLine(i,{account_code:e.target.value})}><option value="">Select account…</option>{COA.map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} · {a.account_name}</option>)}</select>:<span>{line.account_code} · {acct(line.account_code).account_name}</span>}</td>
        <td className="ta-r">{editable?<input className="num-in" type="number" value={line.debit_amount||''} onChange={e=>setLine(i,{debit_amount:+e.target.value||0,credit_amount:0})}/>:<Money v={line.debit_amount||0}/>}</td>
        <td className="ta-r">{editable?<input className="num-in" type="number" value={line.credit_amount||''} onChange={e=>setLine(i,{credit_amount:+e.target.value||0,debit_amount:0})}/>:<Money v={line.credit_amount||0}/>}</td>
        <td>{editable?<input className="desc-line" value={line.description||''} onChange={e=>setLine(i,{description:e.target.value})} placeholder="Line description"/>:<span>{line.description||'—'}</span>}</td>
        <td>{editable?<input className="desc-line" list="member-list-v2" value={line.member||''} onChange={e=>setLine(i,{member:e.target.value})} placeholder={subsidiaryOf(line.account_code)?`${subsidiaryOf(line.account_code)} required`:'Name'}/>:<span>{line.member||'—'}</span>}</td>
        <td>{editable?<div className="dim-picks"><select value={line.property_id||''} onChange={e=>setLine(i,{property_id:e.target.value?+e.target.value:null})}><option value="">Property…</option>{PROPERTIES.map(p=><option key={p.property_id} value={p.property_id}>{p.property_code}</option>)}</select><select value={line.project_id||''} onChange={e=>setLine(i,{project_id:e.target.value?+e.target.value:null})}><option value="">Project…</option>{PROJECTS.map(p=><option key={p.project_id} value={p.project_id}>{p.project_code}</option>)}</select></div>:<span>{line.property_id?`Property ${line.property_id}`:line.project_id?`Project ${line.project_id}`:'—'}</span>}</td>
        {editable&&<td><button className="x-sm" onClick={()=>removeLine(i)}>×</button></td>}</tr>)}
    </tbody></table></div>
    <div className="qbe-below"><div>{editable&&<><Btn size="sm" onClick={addLine}>+ Add line</Btn><Btn size="sm" variant="ghost" onClick={()=>setField({lines:[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}]})}>Clear lines</Btn></>}</div><div className="qbe-totals"><span>Total debits <Money v={totals.debit} bold/></span><span>Total credits <Money v={totals.credit} bold/></span><span className={Math.abs(difference)<.005&&totals.debit>0?'bal-ok':'bal-bad'}>Difference {money(difference)}</span></div></div>

    {draft.je_type==='MANUAL'||draft.je_type==='RECLASS'?<div className="qbe-memo"><b>Attachments</b>{editable?<label className="link-btn" style={{cursor:'pointer',display:'block',marginTop:8}}>{draft.has_attachment?`📎 ${draft.attachment_name} · Replace`:'📎 Add supporting document (required before submit)'}<input type="file" style={{display:'none'}} onChange={e=>{const file=e.target.files?.[0];if(file)setField({has_attachment:true,attachment_name:`${file.name} (${Math.round(file.size/1024)} KB)`});}}/></label>:<div className="muted sm">{draft.has_attachment?`📎 ${draft.attachment_name||'Attached'}`:'No attachment'}</div>}</div>:null}

    {draft.source_system!=='MAN'&&<div className="src-card"><div className="src-chain"><span className="chip">{draft.source_system} source</span>→<span className="chip">Setting / Mapping</span>→<span className="chip">Rule {draft.rule_code||'MISSING'}</span>→<span className="chip chip-on">Draft / Approval</span>→<span className="chip">GL</span></div><div className="src-grid"><span><i>Source ID</i><b>{draft.source_doc_id||'MISSING'}</b></span><span><i>Document</i><b>{sourceDoc?.doc_no||draft.source_doc_id||'—'}</b></span><span><i>Rule</i><b>{draft.rule_code||'MISSING'}</b></span><span><i>Setting</i><b>{draft.setting_used||'Company setting'}</b></span><span><i>Mapping</i><b>{draft.mapping_used||'Approved mapping'}</b></span><span><i>Control</i><b>Human approval required</b></span></div></div>}
    {errors.length>0&&draft.posting_status==='DRAFT'&&<div className="err-box">{errors.map((e,i)=><div key={i}>• [{e.code}] {e.msg}</div>)}</div>}
    {confirmExit&&<div className="err-box" style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}><span>Discard unsaved changes and return to the list?</span><span className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>setConfirmExit(false)}>Keep editing</Btn><Btn size="sm" variant="danger" onClick={onClose}>Discard</Btn></span></div>}
    <div className="qbe-footbar"><div className="row-acts"><Btn variant="ghost" onClick={exit}>Exit</Btn><Btn variant="ghost" onClick={copy}>Copy</Btn><Btn variant="ghost" onClick={recurring}>Make recurring</Btn>{draft.posting_status==='POSTED'&&<Btn variant="ghost" onClick={()=>goto('register')}>View in register</Btn>}</div><div className="row-acts">
      {editable&&<><Btn onClick={save}>Save</Btn><Btn onClick={saveClose}>Save & close</Btn><Btn variant="ghost" onClick={saveNew}>Save & new</Btn></>}
      {flow.reject&&can('GL.JE.REVIEW')&&<Btn variant="ghost" onClick={()=>{const result=actions.rejectJE(draft.je_id);if(!result?.ok)toast(result?.message||'Reject blocked.','bad');else{setDraft(result.je);toast('Returned to Draft.','warn');}}}>Reject</Btn>}
      {draft.posting_status==='POSTED'&&<><Btn onClick={reclass}>Reclass</Btn>{can('GL.JE.REVERSE')&&<Btn variant="danger" onClick={reverse}>Reverse</Btn>}</>}
      {flow.action&&<Btn variant="primary" onClick={advance} disabled={!can(flow.perm)} title={!can(flow.perm)?`Missing permission ${flow.perm}`:''}>{flow.action}</Btn>}
    </div></div>
    {draft.history?.length>0&&<><SectionTitle>Audit trail</SectionTitle><ApprovalTimeline steps={draft.history.map(h=>({label:h.a,done:true,who:h.by,at:h.at}))}/></>}
  </div>;
}

function LegacyJEEditor({je, ctx}) {
  const {actions, can, period, toast} = ctx;
  const readOnly = ['POSTED','REVERSED'].includes(je.posting_status);
  const editable = je.posting_status==='DRAFT' && !readOnly;
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
      if (e.length) { toast('校验未通过：'+e[0].msg, 'bad'); return; }
    }
    actions.advanceJE(je.je_id, flow.next, flow.action);
    toast(`${flow.action} 成功 → ${flow.next}`);
  };
  const reverse = () => { actions.reverseJE(je.je_id); toast('已生成红字反冲分录'); };

  const diff = +(totals.debit-totals.credit).toFixed(2);
  return <div className="qbe">
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
          <td>{editable ? <input className="desc-line" list="member-list" placeholder={ (window.__subsOf&&window.__subsOf(l.account_code)) ? '核算对象*' : 'Name'} value={l.member||''} onChange={e=>setLine(i,{member:e.target.value})}/> : <span className="muted sm">{l.member||''}</span>}</td>
          <td>{editable ?
            <div className="dim-picks">
              <select value={l.property_id||''} onChange={e=>setLine(i,{property_id:e.target.value?+e.target.value:null})}><option value="">Prop—</option>{PROPERTIES.map(p=><option key={p.property_id} value={p.property_id}>{p.property_code}</option>)}</select>
              <select value={l.project_id||''} onChange={e=>setLine(i,{project_id:e.target.value?+e.target.value:null})}><option value="">Proj—</option>{PROJECTS.map(p=><option key={p.project_id} value={p.project_id}>{p.project_code}</option>)}</select>
            </div>
            : <span className="muted sm">{[(l.property_id&&('Prop'+l.property_id)),(l.project_id&&('P'+l.project_id)),(l.loan_id&&('L'+l.loan_id))].filter(Boolean).join(' ')}</span>}</td>
          {editable && <td><button className="x-sm" onClick={()=>rmLine(i)}>×</button></td>}
        </tr>)}
      </tbody>
    </table>
    <div className="qbe-below">
      <div>{editable && <><Btn size="sm" onClick={addLine}>Add lines</Btn> <Btn size="sm" variant="ghost" onClick={()=>actions.updateJE(je.je_id,d=>{d.lines=[{account_code:'',debit_amount:0,credit_amount:0},{account_code:'',debit_amount:0,credit_amount:0}];})}>Clear all lines</Btn></>}</div>
      <div className="qbe-totals">
        <span>Total debits <Money v={totals.debit} bold/></span>
        <span>Total credits <Money v={totals.credit} bold/></span>
        <span className={diff===0&&totals.debit>0?'bal-ok':'bal-bad'}>Difference {diff===0&&totals.debit>0?'✓ $0.00':'$'+Math.abs(diff).toLocaleString()}</span>
      </div>
    </div>
    <div className="qbe-memo">
      <label>Memo</label>
      {editable ? <input className="desc-in" style={{width:'100%'}} value={je.description} onChange={e=>actions.updateJE(je.je_id,d=>{d.description=e.target.value;})} placeholder="What is this journal entry for?"/> : <div className="muted">{je.description}</div>}
      {je.je_type==='MANUAL' && (editable ? <label className="link-btn" style={{cursor:'pointer'}}>
        {je.has_attachment?('📎 '+(je.attachment_name||'attached')+' · 更换'):'📎 Add attachment (过账前必填)'}
        <input type="file" style={{display:'none'}} onChange={e=>{const f=e.target.files[0]; if(f){actions.updateJE(je.je_id,d=>{d.has_attachment=true; d.attachment_name=f.name+' ('+Math.round(f.size/1024)+'KB)';}); toast('附件已挂接: '+f.name);}}}/>
      </label> : <span className="muted sm">附件 {je.has_attachment?'✓ '+(je.attachment_name||''):'✗'}</span>)}
    </div>
    {je.source_doc_id && SOURCE_DOCS[je.source_doc_id] && (()=>{ const d=SOURCE_DOCS[je.source_doc_id]; return <div className="src-card">
      <div className="src-chain"><span className="chip">WBS {d.source_system||''}</span>→<span className="chip">{d.type}</span>→<span className="chip">Rule {je.rule_code||'—'}</span>→<span className="chip chip-on">JE {je.je_number}</span>→<span className="chip">GL</span></div>
      <div className="src-grid">
        <span><i>单据号</i><b>{d.doc_no}</b></span>
        {d.po_no && <span><i>PO</i><b>{d.po_no}</b></span>}
        {d.contract && <span><i>合同</i><b>{d.contract}</b></span>}
        {d.unit && <span><i>Unit</i><b>{d.unit}</b></span>}
        {d.vendor && <span><i>Vendor</i><b>{d.vendor}</b></span>}
        {d.buyer && <span><i>Buyer</i><b>{d.buyer}</b></span>}
        {d.cost_code && <span><i>Cost Code</i><b>{d.cost_code}</b></span>}
        <span><i>金额</i><b>{'$'+(+d.amount).toLocaleString()}</b></span>
      </div>
    </div>; })()}
    {errs.length>0 && <div className="err-box">{errs.map((e,i)=><div key={i}>• [{e.code}] {e.msg}</div>)}</div>}
    <div className="qbe-footbar">
      <div><Btn variant="ghost" onClick={()=>{const result=actions.copyJE(je.je_id);toast(result?.ok?'已复制为新草稿':result?.message||'Copy blocked.',result?.ok?'ok':'bad');}}>Copy</Btn>
        <Btn variant="ghost" onClick={()=>{const result=actions.makeRecurringJE(je.je_id);toast(result?.ok?`Recurring template ${result.template.template_id} created.`:result?.message||'Recurring blocked.',result?.ok?'ok':'bad');}}>Make recurring</Btn></div>
      <div className="row-acts">
        {flow.reject && can('GL.JE.REVIEW') && <Btn variant="ghost" onClick={()=>{const result=actions.rejectJE(je.je_id);toast(result?.ok?'已退回 DRAFT':result?.message||'Reject blocked.',result?.ok?'warn':'bad');}}>Reject</Btn>}
        {je.posting_status==='POSTED' && can('GL.JE.REVERSE') && <Btn variant="danger" onClick={reverse}>Reverse</Btn>}
        {flow.action && <Btn variant="primary" onClick={advance} disabled={!canAct || (flow.next==='POSTED' && errs.length>0)} title={!canAct?'无此权限':''}>{flow.action==='提交'?'Save and submit':flow.action}</Btn>}
      </div>
    </div>
    {(je.history&&je.history.length>0) && <><SectionTitle>Audit Trail</SectionTitle>
      <ApprovalTimeline steps={je.history.map(h=>({label:h.a, done:true, who:h.by, at:h.at}))} /></>}
  </div>;
}

// ---------------- Construction Loan Workspace ----------------
export function LoanWorkspace({ctx}) {
  const {actions, toast, jes, can} = ctx;
  const [loanId, setLoanId] = useState(1);
  const [tab, setTab] = useState('Draw / 提款还款');
  const loan = LOANS.find(l=>l.loan_id===loanId);
  const txns = LOAN_TXNS.filter(t=>t.loan_id===loanId && (tab.startsWith('Draw')? ['DRAW','REPAYMENT'].includes(t.txn_type) : t.txn_type.startsWith('INTEREST')));
  const gen = (t) => {
    const r = loanRule(t);
    if (!r) { toast('无匹配规则','bad'); return; }
    actions.newJEFromRule({entity_id:loan.entity_id, source_system:'WBS_CL', description:`${t.txn_type} · ${loan.loan_code}`, rule_code:r.rule_code, je_type:'AUTO', lines:r.lines});
    toast(`已生成 Draft JE（${r.capitalize?'利息资本化 → 1405':r.rule_code==='R-LOAN-04'?'利息费用化 → 5000':r.rule_code}）`);
  };
  return <div>
    <h2 className="page-h">Construction Loan Workspace</h2>
    <div className="loan-select">
      {LOANS.map(l=><button key={l.loan_id} className={`chip ${loanId===l.loan_id?'chip-on':''}`} onClick={()=>setLoanId(l.loan_id)}>{l.loan_code}</button>)}
    </div>
    <div className="kpi-row">
      <KPI label="Commitment" value={money(loan.commitment_amount)} />
      <KPI label="当前本金" value={money(loan.current_principal)} />
      <KPI label="可用额度" value={money(loan.commitment_amount-loan.current_principal)} tone="ok" />
      <KPI label="利率 / 到期" value={(loan.interest_rate*100).toFixed(2)+'%'} sub={loan.maturity_date} />
    </div>
    <Tabs tabs={['Draw / 提款还款','利息 Interest']} active={tab} onChange={setTab} />
    <Table cols={[
      {h:'WBS 交易号',k:'wbs_txn_id'},
      {h:'类型',render:r=><Badge tone="muted">{r.txn_type}</Badge>},
      {h:'日期',k:'transaction_date'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>},
      {h:'资本化判定',render:r=> r.txn_type.startsWith('INTEREST') ? <Badge tone={r.construction_status==='UNDER_CONSTRUCTION'?'warn':'ok'}>{r.construction_status==='UNDER_CONSTRUCTION'?'资本化 CIP':'费用化 Exp'}</Badge> : '—'},
      {h:'分录',render:r=> r.generated_je ? <span className="link">{r.generated_je}</span> : (can('GL.JE.CREATE') ? <Btn size="sm" variant="primary" onClick={()=>gen(r)}>生成 Draft</Btn> : <span className="muted">待生成</span>)},
    ]} rows={txns} rowKey="loan_txn_id" />
    <p className="muted sm">利息资本化 vs 费用化由 <code>construction_status</code> 驱动（在建=1405 Capitalized Interest，投运=5000 Interest Expense），规则见 R-LOAN-03/04。</p>
  </div>;
}

// ---------------- Property Operations Pickup ----------------
export function PMPickup({ctx}) {
  const {actions, toast, can} = ctx;
  const [month] = useState('2026-07');
  const rows = PM_ROWS.map(r=>({...r, rule:pmRule(r)}));
  const mapped = rows.filter(r=>!r.rule.unmapped);
  const unmapped = rows.filter(r=>r.rule.unmapped);
  const rev = sum(mapped.filter(r=>r.rule.rule_code==='R-PM-11'), r=>r.amount);
  const exp = sum(mapped.filter(r=>r.rule.rule_code==='R-PM-18'), r=>r.amount);
  const already = ctx.jes.some(j=>j.source_system==='PM' && (j.description||'').includes('PM Pickup') && j.rule_code);
  const generate = () => {
    if (already){ toast('该批次已生成过 Owner GL Draft,禁止重复 Pickup [4004]','bad'); return; }
    mapped.forEach(r=>{ const own = UNIT_OWNERS[r.unit] || {entity_id:4, name:'WB Home LLC'};
      actions.newJEFromRule({entity_id:own.entity_id, source_system:'PM', description:`PM Pickup ${r.charge_code} · ${r.property_code} · Unit ${r.unit_code} → ${own.name}`, rule_code:r.rule.rule_code, je_type:'AUTO', lines:r.rule.lines}); });
    unmapped.forEach(r=> actions.ensureException({exception_type:'GL_MAPPING_MISSING', severity:'HIGH', object_type:'PM_PICKUP', object_ref:`${r.charge_code} / ${r.property_code}`, entity_id:4, owner:'PROPERTY_ACCT', root_cause:`Charge code ${r.charge_code} 无当前映射`}));
    const owners=[...new Set(mapped.map(r=>(UNIT_OWNERS[r.unit]||{name:'WB Home LLC'}).name))];
    toast(`已按 Unit Owner 生成 ${mapped.length} 条 Draft → ${owners.length} 家 Owner 公司(${owners.join(' / ')})；${unmapped.length} 条未映射转异常`, unmapped.length?'warn':'ok');
  };
  return <div>
    <h2 className="page-h">Property Operations Pickup</h2>
    <div className="pickup-bar">
      <span>物业 <strong>P0020 · Maple Court</strong></span>
      <span>期间 <strong>{month}</strong></span>
      <span>批次 <strong>PM-202607-P0020</strong></span>
    </div>
    <div className="check-band">
      <span className="ck ok">去重 ✓</span>
      <span className="ck ok">Entity 匹配 ✓</span>
      <span className={`ck ${unmapped.length?'warn':'ok'}`}>Mapping 覆盖 {Math.round(mapped.length/rows.length*100)}%{unmapped.length?` ⚠ ${unmapped.length} 未映射`:''}</span>
    </div>
    <Table cols={[
      {h:'External ID',k:'external_id'},
      {h:'Charge Code',render:r=><Badge tone="muted">{r.charge_code}</Badge>},
      {h:'Unit',k:'unit'},
      {h:'Owner 公司',render:r=>(UNIT_OWNERS[r.unit]||{name:'WB Home LLC'}).name},
      {h:'映射 GL',render:r=> r.rule.unmapped ? <span className="warn-txt">未映射 · 需去 Mapping Center</span> : <span>{r.rule.gl} {acct(r.rule.gl).account_name}</span>},
      {h:'收/支',render:r=> r.rule.unmapped?'—': r.rule.rule_code==='R-PM-11'?'收入': r.rule.rule_code==='R-PM-16'?'押金(负债)':'费用'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>},
    ]} rows={rows} rowKey="external_id" />
    <div className="pickup-sum">
      <span>收入 <Money v={rev}/></span><span>费用 <Money v={exp}/></span><span>NOI <Money v={rev-exp}/></span>
    </div>
    <Btn variant="primary" onClick={generate} disabled={!can('GL.JE.CREATE')}>生成 Owner GL Draft</Btn>
    <span className="muted sm" style={{marginLeft:12}}>Security Deposit 记入负债(2200)不确认收入；未映射条目不建错单，转 GL_MAPPING_MISSING 异常。</span>
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
      <span>{c.closing_code}</span><span>类型 <Badge tone="muted">{c.closing_type}</Badge></span>
      <span>物业 {c.property_code}</span><span>交割日 {c.closing_date}</span>
    </div>
    <SectionTitle>Closing Worksheet（科目拆分）</SectionTitle>
    <Table cols={[
      {h:'项目',k:'label'},
      {h:'科目',render:r=>`${r.account_code} ${acct(r.account_code).account_name}`},
      {h:'借方',num:true,render:r=><Money v={r.debit}/>},
      {h:'贷方',num:true,render:r=><Money v={r.credit}/>},
    ]} rows={c.lines} />
    <div className="check-band">
      <span className={`ck ${balanced?'ok':'bad'}`}>借=贷 {balanced?'✓':'✗'} ({money(dr)}/{money(cr)})</span>
      <span className="ck ok">资金来源=用途 ✓</span>
      <span className="ck ok">Cash to Close = 银行 ✓ ({money(c.cash_to_close)})</span>
      <span className="ck ok">Loan Payoff = 贷款系统 ✓</span>
    </div>
    <p className="muted sm">生成分录：{c.generated_je}（借 Land/Building，贷 Construction Loan + Cash to Close）。资产/收入确认日 = Closing Date。</p>
  </div>;
}

// ---------------- Exception Center ----------------
export function ExceptionCenter({ctx}) {
  const {exceptions, actions, toast, can} = ctx;
  const [sev, setSev] = useState('全部');
  const [st, setSt] = useState('未关闭');
  const [sel, setSel] = useState(null);
  const [resolution, setResolution] = useState('');
  const list = exceptions.filter(e=>
    (sev==='全部'||e.severity===sev) &&
    (st==='全部' || (st==='未关闭' ? !['CLOSED','WAIVED'].includes(e.status) : e.status===st)));
  const e = exceptions.find(x=>x.exception_id===sel);
  const close = () => {
    if (!resolution.trim()) { toast('关闭异常需填写处置说明(证据)','bad'); return; }
    actions.resolveException(sel, resolution);
    toast('异常已关闭','ok'); setSel(null); setResolution('');
  };
  return <div>
    <h2 className="page-h">Exception Center</h2>
    <div className="filter-row">
      <span>严重度</span>{['全部','HIGH','MEDIUM','LOW'].map(s=><button key={s} className={`chip ${sev===s?'chip-on':''}`} onClick={()=>setSev(s)}>{s}</button>)}
      <span style={{marginLeft:16}}>状态</span>{['未关闭','OPEN','IN_PROGRESS','CLOSED','全部'].map(s=><button key={s} className={`chip ${st===s?'chip-on':''}`} onClick={()=>setSt(s)}>{s}</button>)}
    </div>
    <Table cols={[
      {h:'严重',render:r=><Badge tone={r.severity==='HIGH'?'bad':r.severity==='MEDIUM'?'warn':'muted'}>{r.severity}</Badge>},
      {h:'类型',k:'exception_type'},
      {h:'对象',k:'object_ref'},
      {h:'实体',render:r=>'E'+r.entity_id},
      {h:'Aging',num:true,render:r=>r.aging_days+'d'},
      {h:'责任人',k:'owner'},
      {h:'状态',render:r=><Badge>{r.status}</Badge>},
    ]} rows={list} onRow={r=>{setSel(r.exception_id); setResolution(r.resolution||'');}} rowKey="exception_id" empty="无异常" />
    <Drawer open={!!e} onClose={()=>setSel(null)} title={e&&e.exception_type}
      actions={e && !['CLOSED','WAIVED'].includes(e.status) && can('EXCEPTION.EXC.CLOSE') ? <Btn variant="primary" onClick={close}>关闭异常</Btn> : null}>
      {e && <div className="exc-detail">
        <div className="kv"><span>严重度</span><Badge tone={e.severity==='HIGH'?'bad':'warn'}>{e.severity}</Badge></div>
        <div className="kv"><span>对象</span><b>{e.object_ref}</b></div>
        <div className="kv"><span>发生日 / Aging</span><b>{e.occurred_date} · {e.aging_days}d</b></div>
        <div className="kv"><span>责任角色</span><b>{e.owner}</b></div>
        <div className="kv"><span>状态</span><Badge>{e.status}</Badge></div>
        <Field label="Root Cause"><div className="ro-box">{e.root_cause}</div></Field>
        <Field label="处置说明 / 证据" required>
          <textarea disabled={['CLOSED','WAIVED'].includes(e.status)} value={resolution} onChange={ev=>setResolution(ev.target.value)} rows={4} placeholder="填写处置结果作为关闭证据…"/>
        </Field>
      </div>}
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
    <h2 className="page-h">Month-End Close · 2026-07</h2>
    <div className="close-prog"><div className="close-bar"><div className="close-fill" style={{width:pct+'%'}}/></div><span>{pct}% · {doneN}/{closeTasks.length}</span></div>
    <Table cols={[
      {h:'任务',render:r=><span>{r.task_name} <span className="muted sm">({r.task_code})</span></span>},
      {h:'类型',render:r=><Badge tone="muted">{r.is_auto?'AUTO':'MANUAL'}</Badge>},
      {h:'负责人',k:'owner'},
      {h:'截止',k:'due_date'},
      {h:'前置',render:r=> r.depends_on.length? (depsMet(r)?<span className="ok-txt">就绪</span>:<span className="warn-txt">待前置</span>) : '—'},
      {h:'状态',render:r=><Badge>{r.status}</Badge>},
      {h:'操作',render:r=> ['DONE','SIGNED_OFF'].includes(r.status)? <span className="muted">✓</span> :
        <Btn size="sm" variant="primary" disabled={!depsMet(r) || !can('PERIOD.CLOSE.SIGNOFF')} onClick={()=>{actions.signoffTask(r.close_task_id); toast(`${r.task_code} 已 Sign-off`);}}>Sign-off</Btn>},
    ]} rows={closeTasks} rowKey="close_task_id" />
    <Btn variant="primary" disabled={!allSigned || !can('PERIOD.PERIOD.CLOSE')} title={allSigned?'':'需全部任务完成'} onClick={()=>toast('期间已锁定 (CLOSED)','ok')}>锁定期间</Btn>
    <span className="muted sm" style={{marginLeft:12}}>前置任务未完成的任务不可 Sign-off；全部完成后方可锁定期间，Reopen 需专项审批。</span>
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
  const months=['01','02','03','04','05','06','07'];
  const data = months.map(mm=>{
    let rev=0, exp=0;
    jes.filter(j=>j.posting_status==='POSTED' && j.period_code==='2026-'+mm && (!entity||j.entity_id===entity))
       .forEach(j=>j.lines.forEach(l=>{ const a=acct(l.account_code);
         if(a.account_type==='REVENUE') rev += (l.credit_amount||0)-(l.debit_amount||0);
         if(a.account_type==='EXPENSE') exp += (l.debit_amount||0)-(l.credit_amount||0); }));
    return +(rev-exp).toFixed(0);
  });
  const ref = useChart(ctx=>{
    const g = ctx.createLinearGradient(0,0,0,150);
    g.addColorStop(0,'rgba(11,87,208,.35)'); g.addColorStop(1,'rgba(11,87,208,0)');
    return new window.Chart(ctx,{type:'line',data:{labels:months.map(m=>'2026-'+m),
      datasets:[{label:'Net Income',data,fill:true,backgroundColor:g,borderColor:'#0B57D0',borderWidth:2.5,tension:.42,pointRadius:3,pointHoverRadius:7,pointBackgroundColor:'#fff',pointBorderColor:'#0B57D0',pointBorderWidth:2}]},
      options:{responsive:true,maintainAspectRatio:false,animation:{duration:900,easing:'easeOutQuart'},
        plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(15,23,42,.92)',padding:12,cornerRadius:10,displayColors:false,
          callbacks:{label:c=>' Net income  $'+(+c.raw).toLocaleString()}}},
        scales:{x:{grid:{display:false},ticks:{font:{size:10.5},color:'#8a8f98'}},
                y:{grid:{color:'rgba(16,24,40,.06)'},ticks:{font:{size:10.5},color:'#8a8f98',callback:v=>'$'+(v/1000)+'k'}}},
        interaction:{mode:'index',intersect:false}}});
  }, data.join(','));
  if (typeof window!=='undefined' && !window.Chart) return <div className="muted sm">chart loading…</div>;
  return <div style={{height:150,marginTop:6}}><canvas ref={ref}/></div>;
}
function ExpDonut({cats}){
  const ref = useChart(ctx=> new window.Chart(ctx,{type:'doughnut',
    data:{labels:cats.map(c=>c[0]),datasets:[{data:cats.map(c=>+c[1].toFixed(2)),backgroundColor:cats.map(c=>c[2]),borderWidth:3,borderColor:'#fff',hoverOffset:10,borderRadius:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'68%',animation:{animateRotate:true,duration:900},
      plugins:{legend:{display:false},tooltip:{backgroundColor:'rgba(15,23,42,.92)',padding:12,cornerRadius:10,
        callbacks:{label:c=>' '+c.label+'  $'+(+c.raw).toLocaleString()}}}}}), cats.map(c=>c[1]).join(','));
  return <div className="donut-wrap">
    <div style={{width:120,height:120,position:'relative'}}><canvas ref={ref}/></div>
    <div className="legend">{cats.map(([n,v,c])=><span key={n}><i style={{background:c}}/>{n} · {money(v)}</span>)}</div>
  </div>;
}
