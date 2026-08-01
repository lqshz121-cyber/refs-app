import { useMemo, useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle, Tabs } from './ui.jsx';
import { acct, money, sum } from './engine.js';
import { subsidiaryOf, memberOf } from './coa-wbs.js';
import { SOURCE_DOCS } from './seed.js';
import { repo } from './repo.js';

// AI Audit — 机器复核全账本(蓝图21节格式: action/confidence/reason/rule/risk/approval)
export function AIAudit({ctx}) {
  const {jes, entity, goto} = ctx;
  const [ran, setRan] = useState(true);
  const [tab, setTab] = useState('All');
  const [resolved, setResolved] = useState(()=>repo.load('audit_resolved',{}));
  const resolve=(f)=>{ const k=f.rule+'|'+f.object; const n={...resolved,[k]:{by:ctx.user.user_id, at:new Date().toISOString().slice(0,10)}}; setResolved(n); repo.save('audit_resolved',n); };
  const TABMAP={'Critical Findings':f=>f.risk==='HIGH','Accounting Logic':f=>/AI-LOAN|AI-BAL/.test(f.rule),'Mapping Issues':f=>/AI-SUB/.test(f.rule),'Missing Source':f=>/AI-SRC/.test(f.rule),'Duplicate Risk':f=>/AI-DUP/.test(f.rule),'Cutoff Risk':f=>/AI-CUT/.test(f.rule),'Reconciliation':f=>/AI-291|AI-CASH|AI-SUSP/.test(f.rule),'Resolved':f=>!!resolved[f.rule+'|'+f.object],'All':f=>!resolved[f.rule+'|'+f.object]};
  const findings = useMemo(()=>{
    const F=[]; const posted = jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity));
    const flag=(risk,rule,object,reason,action,conf)=>F.push({risk,rule,object,reason,action,conf,needs_human:risk!=='LOW'});
    const seen={};
    posted.forEach(j=>{
      const dr=sum(j.lines,l=>l.debit_amount||0), cr=sum(j.lines,l=>l.credit_amount||0);
      if (Math.abs(dr-cr)>0.005) flag('HIGH','AI-BAL-01', j.je_number, `借贷不平 Dr ${money(dr)} ≠ Cr ${money(cr)}`, '退回并修正金额', 0.99);
      if (seen[j.je_number+j.entity_id]) flag('MEDIUM','AI-DUP-01', j.je_number, 'Journal No 重复', '检查是否重复入账', 0.9); seen[j.je_number+j.entity_id]=1;
      j.lines.forEach((l,i)=>{
        const st=subsidiaryOf(l.account_code);
        if (st && !memberOf(l)) flag('HIGH','AI-SUB-01', `${j.je_number} 行${i+1}`, `${l.account_code} 为辅助核算(${st})但缺核算对象`, '补录核算对象后重过账', 0.97);
        if (l.account_code==='142000') flag('MEDIUM','AI-SUSP-01', j.je_number, 'Suspense 暂挂未清', '识别对象并重分类', 0.8);
      });
      if (j.je_type==='AUTO' && ['PAYABLE','CLOSING'].includes(j.source_system) && !j.source_doc_id && !j.rule_code)
        flag('MEDIUM','AI-SRC-01', j.je_number, '自动分录缺源单据链', '回溯 Integration Hub 补挂单据', 0.85);
      if (j.je_date && j.period_code && j.je_date.slice(0,7)!==j.period_code)
        flag('MEDIUM','AI-CUT-01', j.je_number, `业务日期 ${j.je_date} 与会计期间 ${j.period_code} 不一致(cutoff 风险)`, '确认应计期间或改会计日期', 0.88);
      if (j.source_system==='WBS_CL' && j.description.includes('Draw') && j.lines.some(l=>l.account_code.startsWith('164')&&l.debit_amount>0))
        flag('HIGH','AI-LOAN-01', j.je_number, 'Draw 误记成本(应 Dr Cash/Cr Loan)', '冲销并按规则重生成', 0.95);
    });
    // 291001 by member: net should clear (aging proxy)
    const net={};
    posted.forEach(j=>j.lines.forEach(l=>{ if(l.account_code!=='291001') return; const m=memberOf(l)||'?'; net[m]=(net[m]||0)+(l.debit_amount||0)-(l.credit_amount||0); }));
    Object.entries(net).forEach(([m,v])=>{ if (v<-0.005 && Math.abs(v)>5000) flag('LOW','AI-291-AGE', '291001 · '+m, `对 ${m} 挂账净额 ${money(v)} 未清`, '核对银行 feed 是否漏匹配 (EXPA)', 0.7); });
    // cash negative by entity
    const cash={};
    posted.forEach(j=>j.lines.forEach(l=>{ if(l.account_code!=='111000') return; cash[j.entity_id]=(cash[j.entity_id]||0)+(l.debit_amount||0)-(l.credit_amount||0); }));
    Object.entries(cash).forEach(([e,v])=>{ if (v<-0.01) flag('HIGH','AI-CASH-01', 'Entity '+e, `Operating Cash 余额为负 ${money(v)}`, '检查漏记的注资/收款', 0.92); });
    return F.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.risk]-{HIGH:0,MEDIUM:1,LOW:2}[b.risk]));
  },[jes, entity, ran]);
  const hi=findings.filter(f=>f.risk==='HIGH').length, med=findings.filter(f=>f.risk==='MEDIUM').length;
  return <div className="full-bleed">
    <h2 className="page-h">AI Audit · 机器复核</h2>
    <div className="filter-bar">
      <Btn variant="primary" onClick={()=>setRan(r=>!r)}>重新运行全账本审计</Btn>
      <span className="muted sm">规则引擎逐笔扫描已过账分录 · AI 只建议不代过账(蓝图21)</span>
    </div>
    <div className="kpi-row">
      <KPI label="扫描分录" value={jes.filter(j=>j.posting_status==='POSTED'&&(!entity||j.entity_id===entity)).length}/>
      <KPI label="HIGH" value={hi} tone={hi?'bad':'ok'}/>
      <KPI label="MEDIUM" value={med} tone={med?'warn':'ok'}/>
      <KPI label="LOW" value={findings.length-hi-med}/>
    </div>
    <Tabs tabs={Object.keys(TABMAP)} active={tab} onChange={setTab}/>
    <Table exportName="ai-audit-findings" pageSize={20} cols={[
      {h:'Risk',render:r=><Badge tone={r.risk==='HIGH'?'bad':r.risk==='MEDIUM'?'warn':'muted'}>{r.risk}</Badge>,csv:r=>r.risk},
      {h:'Rule',render:r=><span className="acct-code">{r.rule}</span>,csv:r=>r.rule},
      {h:'Object',k:'object'},
      {h:'Reason(AI 判断依据)',k:'reason'},
      {h:'Suggested Action',k:'action'},
      {h:'Confidence',num:true,render:r=>(r.conf*100).toFixed(0)+'%',csv:r=>r.conf},
      {h:'需人工',render:r=>r.needs_human?<Badge tone="warn">YES</Badge>:<Badge tone="ok">no</Badge>,csv:r=>r.needs_human?'Y':'N'},
      {h:'Owner',render:r=>r.risk==='HIGH'?'CONTROLLER':'SENIOR_ACCT'},
      {h:'Due',render:r=>r.risk==='HIGH'?'2026-08-05':'2026-08-15'},
      {h:'闭环动作',render:r=>{ const jeNum=(r.object.match(/(?:JE-|\d{14})[\w-]*/)||[])[0];
        const je = jeNum && jes.find(j=>j.je_number===jeNum||r.object.startsWith(j.je_number));
        return <span className="row-acts">
          {je && <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); goto('je');}}>JE→</Btn>}
          {je && r.rule==='AI-LOAN-01' && je.posting_status==='POSTED' && <Btn size="sm" variant="danger" onClick={e=>{e.stopPropagation(); ctx.actions.reverseJE(je.je_id); resolve(r); ctx.toast('已红字反冲并标记 Resolved(按规则重录请走 Staging)');}}>一键红冲</Btn>}
        </span>; }},
      {h:'Status',render:r=> resolved[r.rule+'|'+r.object] ? <Badge tone="ok">RESOLVED · {resolved[r.rule+'|'+r.object].by}</Badge> : <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); resolve(r);}}>Resolve</Btn>},
    ]} rows={findings.filter(TABMAP[tab]||(()=>true))} empty="✅ 全账本扫描通过:无异常发现"/>
  </div>;
}
