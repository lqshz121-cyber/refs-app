import { useState } from 'react';
import { Btn, Badge, Table, Tabs, SectionTitle, Drawer, Field } from './ui.jsx';
import { ENTITIES, COA } from './data.js';
import { WBS_COA_MAP } from './coa-wbs.js';
import { loadSetting, saveSetting, copySetting } from './settings.js';

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
  const upd = (r, field, v)=>{ const n=structuredClone(s); n[KEY][rows.indexOf(r)][field]=v; save(n); };
  const addRow = ()=>{ const n=structuredClone(s); n[KEY].push(KEY==='batch_setting'?{memo:'',dr:'',cr:'',sequential:false,reverse_next_month:false,status:'DRAFT'}:{category:rows[0]?.category||'Bank Transaction', type:'', detail:'', account:'', desc:'', project:'', status:'DRAFT'}); save(n); toast('已加行(DRAFT,测试通过后转 LIVE)'); };
  const delRow = (r)=>{ const n=structuredClone(s); n[KEY].splice(rows.indexOf(r),1); save(n); toast('已删行','warn'); };
  const AcctIn = ({r,f})=><span className="row-acts"><input className="date-in" style={{width:74}} value={r[f]||''} onChange={e=>upd(r,f,e.target.value)}/><span className="muted sm">{nameOf(r[f])||'—'}</span></span>;
  const aiCheck = (r)=>{ const code=r.account||r.dr; if(!code) return <Badge tone="bad">缺科目</Badge>;
    if(!(WBS_COA_MAP[code]||COA.find(a=>a.account_code===code))) return <Badge tone="bad">科目不存在</Badge>;
    if(r.project==='Select') return <Badge tone="warn">需选 Project</Badge>;
    return <Badge tone="ok">✓ 可用</Badge>; };
  return <div className="full-bleed">
    <h2 className="page-h">Company Account Setting</h2>
    <div className="filter-bar">
      <Badge tone="muted">{en.entity_code} · {en.entity_name}</Badge>
      <label>Fiscal Year <select defaultValue="2026"><option>2026</option><option>2025</option></select></label>
      <span className="muted sm">Journal Code Configuration · Category+Type+Detail+Project+Account 共同决定分录</span>
      <span style={{flex:1}}/>
      <Btn size="sm" onClick={()=>setShowCopy(true)}>Copy Setting</Btn>
      <Btn size="sm" variant="primary" onClick={addRow}>+ Add Line</Btn>
    </div>
    <Tabs tabs={['Account Setting','Cost Setting','Payable Setting','Batch Setting']} active={tab} onChange={setTab}/>
    {KEY!=='batch_setting' ? <Table rowKey={null} pageSize={30} cols={[
      {h:'No',render:r=>rows.indexOf(r)+1},
      {h:'Operate',render:r=><span className="row-acts"><button className="x-sm" title="加行" onClick={e=>{e.stopPropagation();addRow();}}>＋</button><button className="x-sm" title="删行" onClick={e=>{e.stopPropagation();delRow(r);}}>－</button></span>},
      {h:'Category',k:'category'},
      {h:'Type',render:r=><Badge tone={/Loan/.test(r.type||'')?'warn':/Sales|Dividend/.test(r.type||'')?'ok':'muted'}>{r.type||'—'}</Badge>},
      {h:'Detail',render:r=><b style={{fontSize:12.5}}>{r.detail}</b>},
      {h:'Project',render:r=> r.project==='Select' ? <Badge tone="warn">Select</Badge> : (r.project||'—')},
      {h:tab==='Payable Setting'?'Account':'Account →科目',render:r=><AcctIn r={r} f="account"/>},
      {h:'Description',k:'desc'},
      {h:'Entity',render:r=>r.entity||'—'},
      {h:'Rule Status',render:r=><Badge tone={r.status==='LIVE'?'ok':'muted'}>{r.status||'LIVE'}</Badge>},
      {h:'AI Check',render:aiCheck},
    ]} rows={rows}/>
    : <Table rowKey={null} cols={[
      {h:'No',render:r=>rows.indexOf(r)+1},
      {h:'Memo',render:r=><input className="desc-line" value={r.memo} onChange={e=>upd(r,'memo',e.target.value)}/>},
      {h:'Dr Account',render:r=><AcctIn r={r} f="dr"/>},
      {h:'Cr Account',render:r=><AcctIn r={r} f="cr"/>},
      {h:'Sequential',render:r=><input type="checkbox" checked={!!r.sequential} onChange={e=>upd(r,'sequential',e.target.checked)}/>},
      {h:'Reverse Next Month',render:r=><input type="checkbox" checked={!!r.reverse_next_month} onChange={e=>upd(r,'reverse_next_month',e.target.checked)}/>},
      {h:'Rule Status',render:r=><Badge tone={r.status==='LIVE'?'ok':'muted'}>{r.status}</Badge>},
      {h:'AI Check',render:aiCheck},
      {h:'',render:r=><button className="x-sm" onClick={()=>delRow(r)}>－</button>},
    ]} rows={rows}/>}
    <p className="muted sm">与 WBS cashOrBankBookAccountSetting 逐列对齐(No/Operate/Category/Type/Detail/Project/Account/Description/Supplementary);Batch 含 Sequential 与 Reverse Next Month(自动冲回)。</p>
    <Drawer open={showCopy} onClose={()=>setShowCopy(false)} title="Copy Setting" width={460}
      actions={<><Btn onClick={()=>setShowCopy(false)}>取消</Btn><Btn variant="primary" onClick={()=>{const from=ENTITIES.find(x=>x.entity_id===+fromId); const t=copySetting(from,en); setS(t); setShowCopy(false); toast(`已从 ${from.entity_code} 复制整套 Setting 到 ${en.entity_code}`);}}>复制</Btn></>}>
      <Field label="从哪家公司复制"><select value={fromId} onChange={e=>setFromId(e.target.value)}>{ENTITIES.map(x=><option key={x.entity_id} value={x.entity_id}>{x.entity_code} {x.entity_name}</option>)}</select></Field>
      <Field label="到当前公司"><input disabled value={en.entity_code+' · '+en.entity_name}/></Field>
      <p className="muted sm">对应 WBS 的 Copy 按钮:支持跨公司/跨年度复制后修改。</p>
    </Drawer>
  </div>;
}
