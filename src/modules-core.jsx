import { useState, useMemo } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Drawer, Tabs, Field, SectionTitle } from './ui.jsx';
import { COA, PROPERTIES, LOANS, ENTITIES, PERIODS } from './data.js';
import { PM_ROWS, BANK_TXNS, CLOSINGS, LOAN_TXNS, IC_TXNS } from './seed.js';
import { acct, money, sum, jeTotals, isBalanced, validateJE, JE_FLOW, loanRule, pmRule, trialBalance } from './engine.js';

// ---------------- Dashboard ----------------
export function Dashboard({ctx}) {
  const {jes, exceptions, closeTasks, goto} = ctx;
  const doneTasks = closeTasks.filter(t=>t.status==='DONE'||t.status==='SIGNED_OFF').length;
  const closePct = Math.round(doneTasks/closeTasks.length*100);
  const pendingApprovals = jes.filter(j=>['PENDING_REVIEW','PENDING_APPROVAL'].includes(j.posting_status));
  const openExc = exceptions.filter(e=>['OPEN','IN_PROGRESS'].includes(e.status));
  const high = openExc.filter(e=>e.severity==='HIGH').length;
  const med = openExc.filter(e=>e.severity==='MEDIUM').length;
  const bankUnmatched = BANK_TXNS.filter(b=>b.match_status==='UNMATCHED').length;
  const pmUnmapped = PM_ROWS.filter(r=>pmRule(r).unmapped).length;
  const icBad = IC_TXNS.filter(i=>i.match_status==='UNMATCHED').length;
  const loanMismatch = exceptions.filter(e=>e.exception_type==='LOAN_BALANCE_MISMATCH'&&e.status!=='CLOSED').length;
  const pendReview = jes.filter(j=>j.posting_status==='PENDING_REVIEW').length;
  const todo = [
    {label:'银行未匹配', n:bankUnmatched, to:'bankrec', tone:bankUnmatched?'warn':'ok'},
    {label:'贷款余额差异', n:loanMismatch, to:'exceptions', tone:loanMismatch?'bad':'ok'},
    {label:'PM 未映射条目', n:pmUnmapped, to:'pmpickup', tone:pmUnmapped?'warn':'ok'},
    {label:'Intercompany 不平', n:icBad, to:'intercompany', tone:icBad?'bad':'ok'},
    {label:'手工JE 待复核', n:pendReview, to:'je', tone:pendReview?'warn':'ok'},
  ];
  return <div>
    <h2 className="page-h">财务工作台 · Control Center</h2>
    <div className="kpi-row">
      <KPI label="关账进度 (2026-07)" value={closePct+'%'} sub={`${doneTasks}/${closeTasks.length} 任务`} tone={closePct===100?'ok':'warn'} />
      <KPI label="待审批" value={pendingApprovals.length} sub={money(sum(pendingApprovals,j=>jeTotals(j).debit))} tone={pendingApprovals.length?'warn':'ok'} />
      <KPI label="数据同步" value="●●○" sub="WBS ✓ · PM ✓ · Bank ⋯" tone="ok" />
      <KPI label="未决异常" value={openExc.length} sub={`${high} 高 · ${med} 中`} tone={high?'bad':'warn'} />
    </div>
    <SectionTitle>待处理事项</SectionTitle>
    <div className="todo-grid">
      {todo.map((t,i)=><Card key={i} hover className="todo-card" onClick={()=>goto(t.to)}>
        <div className={`todo-n badge-${t.tone}`}>{t.n}</div>
        <div className="todo-label">{t.label}</div>
      </Card>)}
    </div>
    <SectionTitle>待审批队列</SectionTitle>
    <Table cols={[
      {h:'JE 编号',k:'je_number'},
      {h:'描述',render:r=>r.description},
      {h:'来源',render:r=><Badge>{r.source_system}</Badge>},
      {h:'金额',num:true,render:r=><Money v={jeTotals(r).debit}/>},
      {h:'状态',render:r=><Badge>{r.posting_status}</Badge>},
    ]} rows={pendingApprovals} onRow={()=>goto('je')} empty="无待审批" rowKey="je_id" />
  </div>;
}

// ---------------- Journal Entry Workspace ----------------
export function JEWorkspace({ctx}) {
  const {jes, actions, can, period, toast} = ctx;
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('全部');
  const statuses = ['全部','DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'];
  const list = jes.filter(j=>filter==='全部'||j.posting_status===filter);
  const je = jes.find(j=>j.je_id===sel);

  const newJE = () => {
    const id = actions.newJE();
    setSel(id);
  };
  return <div className="split">
    <div className="split-left">
      <div className="split-head">
        <strong>Journal Entries</strong>
        <Btn size="sm" variant="primary" onClick={newJE} disabled={!can('GL.JE.CREATE')}>+ 新建</Btn>
      </div>
      <div className="chips">{statuses.map(s=><button key={s} className={`chip ${filter===s?'chip-on':''}`} onClick={()=>setFilter(s)}>{s}</button>)}</div>
      <div className="je-list">
        {list.map(j=><div key={j.je_id} className={`je-item ${sel===j.je_id?'je-item-on':''}`} onClick={()=>setSel(j.je_id)}>
          <div className="je-item-top"><span>{j.je_number}</span><Badge>{j.posting_status}</Badge></div>
          <div className="je-item-desc">{j.description}</div>
          <div className="je-item-amt"><Money v={jeTotals(j).debit}/></div>
        </div>)}
        {list.length===0 && <div className="empty">无分录</div>}
      </div>
    </div>
    <div className="split-right">
      {!je ? <div className="empty-big">从左侧选择分录，或点击「新建」</div> :
        <JEEditor je={je} ctx={ctx} onChange={()=>{}} />}
    </div>
  </div>;
}

function JEEditor({je, ctx}) {
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

  return <div>
    <div className="je-head">
      <div>
        <div className="je-num">{je.je_number}</div>
        <div className="muted">{je.description}</div>
      </div>
      <Badge>{je.posting_status}</Badge>
    </div>
    <div className="je-meta">
      <span>日期 {je.je_date}</span><span>类型 {je.je_type}</span><span>来源 {je.source_system}</span>
      {je.rule_code && <span>规则 {je.rule_code}</span>}
      {je.je_type==='MANUAL' && <span>附件 {je.has_attachment?'✓':'✗'}</span>}
    </div>
    <table className="tbl je-lines">
      <thead><tr><th style={{width:'40%'}}>科目</th><th className="ta-r">借方</th><th className="ta-r">贷方</th><th>维度</th>{editable&&<th></th>}</tr></thead>
      <tbody>
        {je.lines.map((l,i)=><tr key={i}>
          <td>{editable ?
            <select value={l.account_code} onChange={e=>setLine(i,{account_code:e.target.value})}>
              <option value="">— 选择科目 —</option>
              {COA.map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}
            </select>
            : <span>{l.account_code} {acct(l.account_code).account_name}</span>}
          </td>
          <td className="ta-r">{editable ? <input className="num-in" type="number" value={l.debit_amount||''} onChange={e=>setLine(i,{debit_amount:+e.target.value||0, credit_amount:0})}/> : <Money v={l.debit_amount||0}/>}</td>
          <td className="ta-r">{editable ? <input className="num-in" type="number" value={l.credit_amount||''} onChange={e=>setLine(i,{credit_amount:+e.target.value||0, debit_amount:0})}/> : <Money v={l.credit_amount||0}/>}</td>
          <td className="muted sm">{[l.project_id&&'P'+l.project_id, l.property_id&&'Prop'+l.property_id, l.loan_id&&'L'+l.loan_id, l.vendor_id&&'V'+l.vendor_id].filter(Boolean).join(' ')}</td>
          {editable && <td><button className="x-sm" onClick={()=>rmLine(i)}>×</button></td>}
        </tr>)}
      </tbody>
      <tfoot><tr>
        <td>{editable && <Btn size="sm" onClick={addLine}>+ 加行</Btn>}</td>
        <td className="ta-r"><Money v={totals.debit} bold/></td>
        <td className="ta-r"><Money v={totals.credit} bold/></td>
        <td colSpan={editable?2:1}><span className={`bal ${bal?'bal-ok':'bal-bad'}`}>{bal?'✓ 借贷平衡':'✗ 借贷不平'}</span></td>
      </tr></tfoot>
    </table>
    {errs.length>0 && <div className="err-box">{errs.map((e,i)=><div key={i}>• [{e.code}] {e.msg}</div>)}</div>}
    <div className="je-actions">
      {flow.action && <Btn variant="primary" onClick={advance} disabled={!canAct || (flow.next==='POSTED' && errs.length>0)} title={!canAct?'无此权限':''}>{flow.action}</Btn>}
      {flow.reject && can('GL.JE.REVIEW') && <Btn variant="ghost" onClick={()=>{actions.advanceJE(je.je_id, flow.reject, '退回'); toast('已退回 DRAFT','warn');}}>退回</Btn>}
      {je.posting_status==='POSTED' && can('GL.JE.REVERSE') && <Btn variant="danger" onClick={reverse}>红字反冲</Btn>}
      {readOnly && <span className="muted">已过账分录不可修改，如需更正请使用红字反冲</span>}
    </div>
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
  const generate = () => {
    mapped.forEach(r=> actions.newJEFromRule({entity_id:4, source_system:'PM', description:`PM Pickup ${r.charge_code} · ${r.property_code}`, rule_code:r.rule.rule_code, je_type:'AUTO', lines:r.rule.lines}));
    unmapped.forEach(r=> actions.ensureException({exception_type:'GL_MAPPING_MISSING', severity:'HIGH', object_type:'PM_PICKUP', object_ref:`${r.charge_code} / ${r.property_code}`, entity_id:4, owner:'PROPERTY_ACCT', root_cause:`Charge code ${r.charge_code} 无当前映射`}));
    toast(`已生成 ${mapped.length} 条 Owner GL Draft；${unmapped.length} 条未映射转异常`, unmapped.length?'warn':'ok');
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

// ---------------- Bank Reconciliation ----------------
export function BankRec({ctx}) {
  const {toast} = ctx;
  const [acctCode, setAcctCode] = useState('BA-003');
  const [localTxns, setLocalTxns] = useState(BANK_TXNS);
  const txns = localTxns.filter(t=>t.bank_account_code===acctCode);
  const unmatched = txns.filter(t=>t.match_status==='UNMATCHED');
  const diff = sum(unmatched, t=>t.direction==='CREDIT'?t.amount:-t.amount);
  const canSignoff = Math.abs(diff)<0.005;
  const suspense = (id) => { setLocalTxns(ls=>ls.map(t=>t.bank_txn_id===id?{...t,match_status:'MATCHED',matched_je:'→ 9000 Suspense'}:t)); toast('已暂挂至 Suspense (9000)','warn'); };
  const match = (id) => { setLocalTxns(ls=>ls.map(t=>t.bank_txn_id===id?{...t,match_status:'MATCHED',matched_je:'手工匹配'}:t)); toast('已匹配'); };
  return <div>
    <h2 className="page-h">Bank Reconciliation</h2>
    <div className="loan-select">{['BA-003','BA-001'].map(a=><button key={a} className={`chip ${acctCode===a?'chip-on':''}`} onClick={()=>setAcctCode(a)}>{a}</button>)}</div>
    <div className="kpi-row">
      <KPI label="银行笔数" value={txns.length} />
      <KPI label="未匹配" value={unmatched.length} tone={unmatched.length?'warn':'ok'} />
      <KPI label="未匹配净差" value={money(diff)} tone={canSignoff?'ok':'bad'} />
    </div>
    <Table cols={[
      {h:'银行交易号',k:'external_id'},
      {h:'日期',k:'txn_date'},
      {h:'方向',render:r=><Badge tone="muted">{r.direction}</Badge>},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>},
      {h:'摘要',k:'reference'},
      {h:'状态',render:r=><Badge>{r.match_status}</Badge>},
      {h:'匹配对象/操作',render:r=> r.match_status==='MATCHED'? <span className="muted sm">{r.matched_je}</span> :
        <span className="row-acts"><Btn size="sm" onClick={()=>match(r.bank_txn_id)}>匹配</Btn><Btn size="sm" variant="ghost" onClick={()=>suspense(r.bank_txn_id)}>暂挂</Btn></span>},
    ]} rows={txns} rowKey="bank_txn_id" />
    <Btn variant="primary" disabled={!canSignoff} title={canSignoff?'':'差异需为 0'} onClick={()=>toast('对账 Sign-off 完成','ok')}>Sign-off 对账</Btn>
    <span className="muted sm" style={{marginLeft:12}}>差异=0 才可 Sign-off；无法识别的交易先暂挂 Suspense 并登记异常。</span>
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
