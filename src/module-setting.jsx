import { useState } from 'react';
import { Btn, Badge, Table, Tabs, Drawer, Field } from './ui.jsx';
import { ENTITIES, COA } from './data.js';
import { WBS_COA_MAP } from './coa-wbs.js';
import { loadSetting, saveSetting, copySetting } from './settings.js';
import { aiJudge } from './ai.js';

export function CompanySetting({ctx}) {
  const {entity, toast} = ctx;
  const en = ENTITIES.find(e=>e.entity_id===(entity||15)) || ENTITIES[0];
  const [tab, setTab] = useState('Account Setting');
  const [s, setS] = useState(()=>loadSetting(en));
  const [showCopy, setShowCopy] = useState(false);
  const [fromId, setFromId] = useState(15);
  const save = (next)=>{ setS(next); saveSetting(en, next); };
  const nameOf = c => (WBS_COA_MAP[c]||{}).name || (COA.find(a=>a.account_code===c)||{}).account_name || '';
  const KEY = {'Account Setting':'account_setting','Cost Setting':'cost_setting','Payable Setting':'payable_setting','Batch Setting':'batch_setting'}[tab];
  const rows = s[KEY];
  const upd = (r, field, v)=>{ const n=structuredClone(s); const row=n[KEY][rows.indexOf(r)]; row[field]=v; row.updated_at=new Date().toISOString().slice(0,16).replace('T',' '); save(n); };
  const testRule = (r)=>{ const j=aiJudge({category:r.category, type:r.type, detail:r.detail, cost_code:(r.detail||'').slice(0,6), status:'UNDER_CONSTRUCTION', payee:'Test Vendor', amount:1000, description:r.detail}, en); toast(`Test: Dr ${j.suggested.dr} / Cr ${j.suggested.cr} · ${(j.confidence*100).toFixed(0)}% · ${j.rule_used}`); };
  const addRow = ()=>{ const n=structuredClone(s); n[KEY].push(KEY==='batch_setting'?{memo:'',dr:'',cr:'',sequential:false,reverse_next_month:false,status:'DRAFT'}:{category:rows[0]?.category||'Bank Transaction', type:'', detail:'', account:'', desc:'', project:'', status:'DRAFT'}); save(n); toast('Row added as DRAFT. Promote it to LIVE only after validation.'); };
  const delRow = (r)=>{ const n=structuredClone(s); n[KEY].splice(rows.indexOf(r),1); save(n); toast('Row deleted.','warn'); };
  const AcctIn = ({r,f})=><span className="row-acts"><input className="date-in" style={{width:74}} value={r[f]||''} onChange={e=>upd(r,f,e.target.value)}/><span className="muted sm">{nameOf(r[f])||'—'}</span></span>;
  const aiCheck = (r)=>{ const code=r.account||r.dr; if(!code) return <Badge tone="bad">ACCOUNT_REQUIRED</Badge>;
    if(!(WBS_COA_MAP[code]||COA.find(a=>a.account_code===code))) return <Badge tone="bad">ACCOUNT_NOT_FOUND</Badge>;
    if(r.project==='Select') return <Badge tone="warn">PROJECT_REQUIRED</Badge>;
    return <Badge tone="ok">AVAILABLE</Badge>; };
  return <div className="full-bleed">
    <h2 className="page-h">Company Account Settings</h2>
    <div className="filter-bar">
      <Badge tone="muted">{en.entity_code} · {en.entity_name}</Badge>
      <label>Fiscal year <select defaultValue="2026"><option>2026</option><option>2025</option></select></label>
      <span className="muted sm">Journal-code configuration is determined by Category, Type, Detail, Project, and Account.</span>
      <span style={{flex:1}}/>
      <Btn size="sm" onClick={()=>setShowCopy(true)}>Copy settings</Btn>
      <Btn size="sm" variant="primary" onClick={addRow}>Add row</Btn>
    </div>
    <Tabs tabs={['Account Setting','Cost Setting','Payable Setting','Batch Setting']} active={tab} onChange={setTab}/>
    {KEY!=='batch_setting' ? <Table rowKey={null} pageSize={30} cols={[
      {h:'No.',render:r=>rows.indexOf(r)+1},
      {h:'Actions',render:r=><span className="row-acts"><button className="x-sm" title="Add row" onClick={e=>{e.stopPropagation();addRow();}}>Add</button><button className="x-sm" title="Delete row" onClick={e=>{e.stopPropagation();delRow(r);}}>Delete</button></span>},
      {h:'Category',k:'category'},
      {h:'Type',render:r=><Badge tone={/Loan/.test(r.type||'')?'warn':/Sales|Dividend/.test(r.type||'')?'ok':'muted'}>{r.type||'—'}</Badge>},
      {h:'Detail',render:r=><b style={{fontSize:12.5}}>{r.detail}</b>},
      {h:'Project',render:r=> r.project==='Select' ? <Badge tone="warn">Select</Badge> : (r.project||'—')},
      {h:'Account',render:r=><AcctIn r={r} f="account"/>},
      {h:'Description',k:'desc'},
      {h:'Entity',render:r=>r.entity||'—'},
      {h:'Rule status',render:r=><button className="link-btn" onClick={e=>{e.stopPropagation(); upd(r,'status', r.status==='LIVE'?'INACTIVE':'LIVE');}}><Badge tone={r.status==='LIVE'?'ok':'muted'}>{r.status||'LIVE'}</Badge></button>},
      {h:'Validation',render:aiCheck},
      {h:'Last updated',render:r=><span className="muted sm">{r.updated_at||'—'}</span>},
      {h:'Test',render:r=><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); testRule(r);}}>Test rule</Btn>},
    ]} rows={rows}/>
    : <Table rowKey={null} cols={[
      {h:'No.',render:r=>rows.indexOf(r)+1},
      {h:'Memo',render:r=><input className="desc-line" value={r.memo} onChange={e=>upd(r,'memo',e.target.value)}/>},
      {h:'Debit account',render:r=><AcctIn r={r} f="dr"/>},
      {h:'Credit account',render:r=><AcctIn r={r} f="cr"/>},
      {h:'Sequential',render:r=><input type="checkbox" checked={!!r.sequential} onChange={e=>upd(r,'sequential',e.target.checked)}/>},
      {h:'Reverse next month',render:r=><input type="checkbox" checked={!!r.reverse_next_month} onChange={e=>upd(r,'reverse_next_month',e.target.checked)}/>},
      {h:'Rule status',render:r=><Badge tone={r.status==='LIVE'?'ok':'muted'}>{r.status}</Badge>},
      {h:'Validation',render:aiCheck},
      {h:'Actions',render:r=><button className="x-sm" onClick={()=>delRow(r)}>Delete</button>},
    ]} rows={rows}/>}
    <p className="muted sm">Aligned with the observed WBS account-setting columns: Number, Actions, Category, Type, Detail, Project, Account, Description, and Supplementary. Batch settings include Sequential and Reverse Next Month.</p>
    <Drawer open={showCopy} onClose={()=>setShowCopy(false)} title="Copy settings" width={460}
      actions={<><Btn onClick={()=>setShowCopy(false)}>Cancel</Btn><Btn variant="primary" onClick={()=>{const from=ENTITIES.find(x=>x.entity_id===+fromId); const t=copySetting(from,en); setS(t); setShowCopy(false); toast(`Copied the configuration from ${from.entity_code} to ${en.entity_code}.`);}}>Copy</Btn></>}>
      <Field label="Copy from"><select value={fromId} onChange={e=>setFromId(e.target.value)}>{ENTITIES.map(x=><option key={x.entity_id} value={x.entity_id}>{x.entity_code} {x.entity_name}</option>)}</select></Field>
      <Field label="Copy to current entity"><input disabled value={en.entity_code+' · '+en.entity_name}/></Field>
      <p className="muted sm">The observed WBS copy action supports cloning a configuration for later entity- or year-specific adjustments.</p>
    </Drawer>
  </div>;
}
