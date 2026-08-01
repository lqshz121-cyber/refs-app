import { useState } from 'react';
import { Btn, Badge, Table, Tabs, SectionTitle } from './ui.jsx';
import { ENTITIES, COA } from './data.js';
import { WBS_COA_MAP } from './coa-wbs.js';
import { loadSetting, saveSetting } from './settings.js';

// Company Account Setting — WBS cashOrBankBookAccountSetting 复刻升级
export function CompanySetting({ctx}) {
  const {entity, toast} = ctx;
  const en = ENTITIES.find(e=>e.entity_id===(entity||15)) || ENTITIES[0];
  const [tab, setTab] = useState('Account Setting');
  const [s, setS] = useState(()=>loadSetting(en));
  const save = (next)=>{ setS(next); saveSetting(en, next); };
  const nameOf = c => (WBS_COA_MAP[c]||{}).name || (COA.find(a=>a.account_code===c)||{}).account_name || '';
  const AcctCell = ({row, onChange}) => <span className="row-acts">
    <input className="date-in" style={{width:76}} value={row.account} onChange={e=>onChange(e.target.value)}/>
    <span className="muted sm">{nameOf(row.account)||'—'}</span></span>;
  return <div className="full-bleed">
    <h2 className="page-h">Company Account Setting</h2>
    <div className="filter-bar">
      <Badge tone="muted">{en.entity_code} · {en.entity_name}</Badge>
      <span className="muted sm">Journal Code Configuration · Year 2026 · 每家公司独立配置,驱动 Auto Reconciliation 的分录生成</span>
    </div>
    <Tabs tabs={['Account Setting','Cost Setting','Payable Setting','Batch Setting']} active={tab} onChange={setTab}/>
    {tab==='Account Setting' && <>
      <Table rowKey={null} cols={[
        {h:'No',render:(r)=>s.account_setting.indexOf(r)+1},
        {h:'Category',k:'category'},
        {h:'Type',render:r=><Badge tone={r.type==='Bank'?'muted':'warn'}>{r.type}</Badge>},
        {h:'Detail',render:r=><b>{r.detail}</b>},
        {h:'Project',render:r=>r.project||'—'},
        {h:'Account → 分录科目',render:(r)=><AcctCell row={r} onChange={v=>{const n=structuredClone(s); n.account_setting[s.account_setting.indexOf(r)].account=v; save(n); toast('配置已保存(将影响该公司后续 Incur 分录)');}}/>,},
      ]} rows={s.account_setting}/>
      <p className="muted sm">银行账号行:该账号流水入账的现金科目。Construction Loan 行:Draw/Repayment/Interest/Escrow 各自入账科目——Auto Bank Rec 的 Incur 按此写分录。</p>
    </>}
    {tab==='Cost Setting' && <Table cols={[
      {h:'Cost Code',k:'cost_code'},
      {h:'建设状态',render:r=><Badge tone={r.status==='UNDER_CONSTRUCTION'?'warn':r.status==='ANY'?'muted':'ok'}>{r.status}</Badge>},
      {h:'借方科目',render:(r)=><AcctCell row={r} onChange={v=>{const n=structuredClone(s); n.cost_setting[s.cost_setting.indexOf(r)].account=v; save(n); toast('Cost Setting 已保存');}}/>},
      {h:'说明',k:'desc'},
    ]} rows={s.cost_setting}/>}
    {tab==='Payable Setting' && <Table cols={[
      {h:'Payee 类型',k:'payee_type'},
      {h:'贷方科目(挂账)',render:(r)=><AcctCell row={r} onChange={v=>{const n=structuredClone(s); n.payable_setting[s.payable_setting.indexOf(r)].credit_account=v; save(n); toast('Payable Setting 已保存');}}/>},
      {h:'核算对象来源',render:r=><Badge tone="muted">member = {r.member}</Badge>},
      {h:'说明',k:'desc'},
    ]} rows={s.payable_setting.map(r=>({...r, account:r.credit_account}))}/>}
    {tab==='Batch Setting' && <div className="stmt-wide">
      <div className="stmt-h">Batch / Journal 配置</div>
      <div className="kv"><span>Journal No 前缀</span><b>{s.batch_setting.journal_prefix}+序号</b></div>
      <div className="kv"><span>需要 Review</span><Badge tone={s.batch_setting.review_required?'ok':'muted'}>{String(s.batch_setting.review_required)}</Badge></div>
      <div className="kv"><span>EXPA 自动过账</span><Badge tone={s.batch_setting.auto_post_expa?'ok':'muted'}>{String(s.batch_setting.auto_post_expa)}</Badge></div>
      <div className="kv"><span>重复检测</span><Badge tone="ok">{String(s.batch_setting.dup_check)}</Badge></div>
    </div>}
  </div>;
}
