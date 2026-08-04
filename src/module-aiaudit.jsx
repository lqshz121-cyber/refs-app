import { useMemo, useState } from 'react';
import { KPI, Btn, Badge, Table, Tabs } from './ui.jsx';
import { money, sum } from './engine.js';
import { subsidiaryOf, memberOf } from './coa-wbs.js';
import { repo } from './repo.js';

// AI Audit reviews ledger data and produces recommendations; it never posts journals.
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
      if (Math.abs(dr-cr)>0.005) flag('HIGH','AI-BAL-01',j.je_number,`Journal is unbalanced: Dr ${money(dr)} ≠ Cr ${money(cr)}`,'Return and correct the amount',0.99);
      if (seen[j.je_number+j.entity_id]) flag('MEDIUM','AI-DUP-01',j.je_number,'Duplicate journal number','Check for duplicate posting',0.9); seen[j.je_number+j.entity_id]=1;
      j.lines.forEach((l,i)=>{
        const st=subsidiaryOf(l.account_code);
        if (st && !memberOf(l)) flag('HIGH','AI-SUB-01',`${j.je_number} line ${i+1}`,`${l.account_code} requires subsidiary tracking (${st}) but has no member`,'Add the member and repost through the controlled flow',0.97);
        if (l.account_code==='142000') flag('MEDIUM','AI-SUSP-01',j.je_number,'Suspense balance remains open','Identify the counterparty and reclassify',0.8);
      });
      if (j.je_type==='AUTO' && ['PAYABLE','CLOSING'].includes(j.source_system) && !j.source_doc_id && !j.rule_code) flag('MEDIUM','AI-SRC-01',j.je_number,'Automated journal has no source-document trace','Trace the source in Integration Hub and attach evidence',0.85);
      if (j.je_date && j.period_code && j.je_date.slice(0,7)!==j.period_code) flag('MEDIUM','AI-CUT-01',j.je_number,`Business date ${j.je_date} differs from accounting period ${j.period_code} (cutoff risk)`,'Confirm the accrual period or amend the accounting date',0.88);
      if (j.source_system==='WBS_CL' && j.description.includes('Draw') && j.lines.some(l=>l.account_code.startsWith('164')&&l.debit_amount>0)) flag('HIGH','AI-LOAN-01',j.je_number,'Loan draw appears posted as cost (expected Dr Cash / Cr Loan)','Reverse and regenerate through the rule',0.95);
    });
    const net={};
    posted.forEach(j=>j.lines.forEach(l=>{ if(l.account_code!=='291001') return; const m=memberOf(l)||'?'; net[m]=(net[m]||0)+(l.debit_amount||0)-(l.credit_amount||0); }));
    Object.entries(net).forEach(([m,v])=>{ if (v<-0.005 && Math.abs(v)>5000) flag('LOW','AI-291-AGE','291001 · '+m,`Open net balance for ${m}: ${money(v)}`,'Check whether a bank-feed match is missing (EXPA)',0.7); });
    const cash={};
    posted.forEach(j=>j.lines.forEach(l=>{ if(l.account_code!=='111000') return; cash[j.entity_id]=(cash[j.entity_id]||0)+(l.debit_amount||0)-(l.credit_amount||0); }));
    Object.entries(cash).forEach(([e,v])=>{ if (v<-0.01) flag('HIGH','AI-CASH-01','Entity '+e,`Operating Cash is negative: ${money(v)}`,'Check for missing capital contributions or receipts',0.92); });
    return F.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.risk]-{HIGH:0,MEDIUM:1,LOW:2}[b.risk]));
  },[jes, entity, ran]);
  const hi=findings.filter(f=>f.risk==='HIGH').length, med=findings.filter(f=>f.risk==='MEDIUM').length;
  return <div className="full-bleed">
    <h2 className="page-h">AI Audit · Ledger Review</h2>
    <div className="filter-bar"><Btn variant="primary" onClick={()=>setRan(r=>!r)}>Run ledger audit again</Btn><span className="muted sm">The rule engine scans posted journals line by line. AI provides recommendations only and never posts.</span></div>
    <div className="kpi-row"><KPI label="Posted journals scanned" value={jes.filter(j=>j.posting_status==='POSTED'&&(!entity||j.entity_id===entity)).length}/><KPI label="HIGH" value={hi} tone={hi?'bad':'ok'}/><KPI label="MEDIUM" value={med} tone={med?'warn':'ok'}/><KPI label="LOW" value={findings.length-hi-med}/></div>
    <Tabs tabs={Object.keys(TABMAP)} active={tab} onChange={setTab}/>
    <Table exportName="ai-audit-findings" pageSize={20} cols={[
      {h:'Risk',render:r=><Badge tone={r.risk==='HIGH'?'bad':r.risk==='MEDIUM'?'warn':'muted'}>{r.risk}</Badge>,csv:r=>r.risk},
      {h:'Rule',render:r=><span className="acct-code">{r.rule}</span>,csv:r=>r.rule},{h:'Object',k:'object'},
      {h:'Reason (AI rationale)',k:'reason'},{h:'Suggested action',k:'action'},
      {h:'Confidence',num:true,render:r=>(r.conf*100).toFixed(0)+'%',csv:r=>r.conf},{h:'Human review',render:r=>r.needs_human?<Badge tone="warn">YES</Badge>:<Badge tone="ok">No</Badge>,csv:r=>r.needs_human?'Y':'N'},
      {h:'Owner',render:r=>r.risk==='HIGH'?'CONTROLLER':'SENIOR_ACCT'},{h:'Due',render:r=>r.risk==='HIGH'?'2026-08-05':'2026-08-15'},
      {h:'Resolution action',render:r=>{ const jeNum=(r.object.match(/(?:JE-|\d{14})[\w-]*/)||[])[0]; const je=jeNum&&jes.find(j=>j.je_number===jeNum||r.object.startsWith(j.je_number)); return <span className="row-acts">{je&&<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();goto('je');}}>Open journal</Btn>}{je&&r.rule==='AI-LOAN-01'&&je.posting_status==='POSTED'&&<Btn size="sm" variant="danger" onClick={e=>{e.stopPropagation();ctx.actions.reverseJE(je.je_id);resolve(r);ctx.toast('Reversal created and finding resolved. Regenerate through Staging.');}}>Reverse journal</Btn>}</span>; }},
      {h:'Status',render:r=>resolved[r.rule+'|'+r.object]?<Badge tone="ok">RESOLVED · {resolved[r.rule+'|'+r.object].by}</Badge>:<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();resolve(r);}}>Resolve</Btn>},
    ]} rows={findings.filter(TABMAP[tab]||(()=>true))} empty="Ledger audit complete: no findings."/>
  </div>;
}
