import { useState, useMemo } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Drawer, Tabs, Field, SectionTitle, ApprovalTimeline } from './ui.jsx';
import { COA, PROPERTIES, LOANS, ENTITIES, PERIODS, PROJECTS, VENDORS } from './data.js';
import { PM_ROWS, CLOSINGS, LOAN_TXNS, IC_TXNS } from './seed.js';
import { acct, money, sum, jeTotals, isBalanced, validateJE, JE_FLOW, loanRule, pmRule, trialBalance, statements } from './engine.js';

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
        <div className="qbo-bars">{plBars.map((h,i)=><div key={i} className={`qbo-bar ${i===6&&st.netIncome<0?'neg':''}`} style={{height:h*2.4}} title={'月'+(i+1)}/>)}</div>
      </div>
      <div className="qbo-card" onClick={()=>goto('reports')} style={{cursor:'pointer'}}>
        <h4>Expenses · 本期费用</h4>
        <div className="qbo-big">{money(st.expense)}</div>
        <div className="donut-wrap">
          <div className="donut" style={{background:`conic-gradient(${segs})`}}/>
          <div className="legend">{expCats.map(([n,v,c])=><span key={n}><i style={{background:c}}/>{n} · {money(v)}</span>)}</div>
        </div>
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
    <SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>goto('je')}>查看全部</Btn>}>待审批队列 Approvals ({pendingApprovals.length})</SectionTitle>
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
  const [filter, setFilter] = useState('全部');
  const [srcF, setSrcF] = useState('ALL');
  const MONTHS=[1,2,3,4,5,6,7,8,9,10,11,12];
  const statuses = ['全部','DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED','POSTED'];
  const list = jes.filter(j=>(filter==='全部'||j.posting_status===filter) && (!ctx.entity||j.entity_id===ctx.entity) && (srcF==='ALL'||j.source_system===srcF));
  const postAll = () => { list.filter(j=>j.posting_status==='PENDING_APPROVAL').forEach(j=>actions.advanceJE(j.je_id,'POSTED','POST ALL')); toast('Post All 完成'); };
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
      <div className="mo-chips">{MONTHS.map(m=><button key={m} className={`mo-chip ${m===7?'mo-on':''}`} title={m===7?'当前期间 2026-07':'演示固定 2026-07'}>{m}{[6,7].includes(m)&&<span className="mo-dot"/>}</button>)}</div>
      <div className="chips">{statuses.map(s=><button key={s} className={`chip ${filter===s?'chip-on':''}`} onClick={()=>setFilter(s)}>{s}</button>)}</div>
      <div className="je-filters" style={{marginTop:2}}>{['ALL','MAN','WBS_CL','PM','AP','BANK','CLOSING'].map(s=><button key={s} className={`chip ${srcF===s?'chip-on':''}`} onClick={()=>setSrcF(s)}>{s}</button>)}
        {can('GL.JE.POST') && <button className="chip" onClick={postAll} title="过账所有待审批分录">⚡ Post All</button>}</div>
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
        {editable ? <input className="desc-in" value={je.description} onChange={e=>actions.updateJE(je.je_id,d=>{d.description=e.target.value;})} placeholder="分录描述"/> : <div className="muted">{je.description}</div>}
      </div>
      <Badge>{je.posting_status}</Badge>
    </div>
    <div className="je-meta">
      {editable ? <span>日期 <input type="date" className="date-in" value={je.je_date} onChange={e=>actions.updateJE(je.je_id,d=>{d.je_date=e.target.value;})}/></span> : <span>日期 {je.je_date}</span>}<span>类型 {je.je_type}</span><span>来源 {je.source_system}</span>
      {je.rule_code && <span>规则 {je.rule_code}</span>}
      {je.je_type==='MANUAL' && (editable ? <button className="link-btn" onClick={()=>actions.updateJE(je.je_id,d=>{d.has_attachment=true; d.attachment_name='support-doc.pdf';})}>{je.has_attachment?('附件 ✓ '+(je.attachment_name||'')):'＋ 添加附件'}</button> : <span>附件 {je.has_attachment?'✓':'✗'}</span>)}
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
          <td className="muted sm">{editable ?
            <div className="dim-picks">
              <select value={l.property_id||''} onChange={e=>setLine(i,{property_id:e.target.value?+e.target.value:null})}><option value="">物业—</option>{PROPERTIES.map(p=><option key={p.property_id} value={p.property_id}>{p.property_code}</option>)}</select>
              <select value={l.project_id||''} onChange={e=>setLine(i,{project_id:e.target.value?+e.target.value:null})}><option value="">项目—</option>{PROJECTS.map(p=><option key={p.project_id} value={p.project_id}>{p.project_code}</option>)}</select>
              <select value={l.vendor_id||''} onChange={e=>setLine(i,{vendor_id:e.target.value?+e.target.value:null})}><option value="">供应商—</option>{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.vendor_code}</option>)}</select>
            </div>
            : [(l.project_id&&('P'+l.project_id)), (l.property_id&&('Prop'+l.property_id)), (l.loan_id&&('L'+l.loan_id)), (l.vendor_id&&('V'+l.vendor_id))].filter(Boolean).join(' ')}</td>
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
      {je.posting_status==='POSTED' && ctx.user.role_code==='CONTROLLER' && <Btn variant="ghost" onClick={()=>{actions.advanceJE(je.je_id,'APPROVED','CANCEL POST'); toast('已 Cancel Post,退回 APPROVED','warn');}}>Cancel Post</Btn>}
      <Btn variant="ghost" onClick={()=>{const nid=actions.copyJE(je.je_id); toast('已复制为新草稿');}}>复制 JE</Btn>
      {je.posting_status==='POSTED' && can('GL.JE.REVERSE') && <Btn variant="danger" onClick={reverse}>红字反冲</Btn>}
      {readOnly && <span className="muted">已过账分录不可修改，如需更正请使用红字反冲</span>}
    </div>
    {(je.history&&je.history.length>0) && <><SectionTitle>处理历史 Audit Trail</SectionTitle>
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
