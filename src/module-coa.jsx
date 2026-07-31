import { useState } from 'react';
import { Btn, Badge, Money, Table, Drawer, Field, SectionTitle } from './ui.jsx';
import { trialBalance } from './engine.js';

export function COAWorkspace({ctx}) {
  const {coa, jes, actions, toast, can, entity} = ctx;
  const [showNew, setShowNew] = useState(false);
  const [f, setF] = useState({account_code:'', account_name:'', account_type:'EXPENSE'});
  const tb = trialBalance(jes, entity);
  const balOf = (code) => { const r = tb.rows.find(x=>x.account_code===code); return r? r.balance : 0; };
  const add = () => {
    if(!/^[0-9]{4}$/.test(f.account_code)){ toast('科目编码需为4位数字','bad'); return; }
    const r = actions.addAccount({...f, normal_balance:['ASSET','EXPENSE'].includes(f.account_type)?'DEBIT':'CREDIT'});
    if (r.dup){ toast('编码已存在 [4004]','bad'); return; }
    toast('科目已创建'); setShowNew(false); setF({account_code:'',account_name:'',account_type:'EXPENSE'});
  };
  return <div>
    <h2 className="page-h">科目表 Chart of Accounts</h2>
    <div style={{marginBottom:12}}><Btn variant="primary" onClick={()=>setShowNew(true)} disabled={!can('GL.COA.CREATE')}>+ 新建科目</Btn></div>
    <Table exportName="chart-of-accounts" rowKey="account_code" cols={[
      {h:'编码',k:'account_code'},
      {h:'科目名称',k:'account_name'},
      {h:'类型',render:r=><Badge tone="muted">{r.account_type}</Badge>,csv:r=>r.account_type},
      {h:'方向',k:'normal_balance'},
      {h:'当前余额',num:true,render:r=><Money v={balOf(r.account_code)}/>,sortVal:r=>balOf(r.account_code),csv:r=>balOf(r.account_code)},
      {h:'状态',render:r=> r.inactive? <Badge tone="bad">停用</Badge> : <Badge tone="ok">启用</Badge>,csv:r=>r.inactive?'停用':'启用'},
      {h:'操作',render:r=> Math.abs(balOf(r.account_code))<0.005 ?
        <Btn size="sm" variant="ghost" onClick={()=>{actions.toggleAccount(r.account_code); toast(r.inactive?'已启用':'已停用');}}>{r.inactive?'启用':'停用'}</Btn>
        : <span className="muted sm" title="有余额的科目不可停用">余额≠0 锁定</span>},
    ]} rows={coa} />
    <p className="muted sm">控制规则：编码唯一；有余额科目不可停用；停用不影响历史分录（版本化）。</p>
    <Drawer open={showNew} onClose={()=>setShowNew(false)} title="新建科目"
      actions={<><Btn onClick={()=>setShowNew(false)}>取消</Btn><Btn variant="primary" onClick={add}>创建</Btn></>}>
      <Field label="编码 (4位)" required><input value={f.account_code} onChange={e=>setF(s=>({...s,account_code:e.target.value}))} maxLength={4}/></Field>
      <Field label="名称" required><input value={f.account_name} onChange={e=>setF(s=>({...s,account_name:e.target.value}))}/></Field>
      <Field label="类型"><select value={f.account_type} onChange={e=>setF(s=>({...s,account_type:e.target.value}))}>
        {['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'].map(t=><option key={t}>{t}</option>)}</select></Field>
    </Drawer>
  </div>;
}
