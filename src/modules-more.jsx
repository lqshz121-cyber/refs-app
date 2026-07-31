import { useState } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { COA, ENTITIES, VENDORS, CUSTOMERS, LOANS, BANK_ACCOUNTS, MAPPINGS, PROPERTIES, PROJECTS } from './data.js';
import { LOAN_TXNS, IC_TXNS, CLOSINGS } from './seed.js';
import { acct, money, sum, jeTotals, trialBalance, statements, downloadCSV } from './engine.js';

export function GLTrialBalance({ctx}) {
  const {jes, entity} = ctx;
  const [tab, setTab] = useState('Trial Balance');
  const [drill, setDrill] = useState(null);
  const tb = trialBalance(jes, entity);
  const st = statements(jes, entity);
  return <div>
    <h2 className="page-h">General Ledger</h2>
    <Tabs tabs={['Trial Balance','Balance Sheet','Income Statement']} active={tab} onChange={setTab} />
    {tab==='Trial Balance' && <>
      <div style={{textAlign:'right',marginBottom:8}}><Btn size="sm" onClick={()=>downloadCSV('trial-balance.csv',[['Account','Name','Type','Debit','Credit','Balance'],...tb.rows.map(r=>[r.account_code,r.name,r.type,r.debit,r.credit,r.balance])])}>导出 CSV</Btn></div>
      <Table cols={[
        {h:'科目',render:r=>`${r.account_code} ${r.name}`},
        {h:'类型',render:r=><Badge tone="muted">{r.type}</Badge>},
        {h:'借方',num:true,render:r=><Money v={r.debit}/>},
        {h:'贷方',num:true,render:r=><Money v={r.credit}/>},
        {h:'余额',num:true,render:r=><Money v={r.balance}/>},
      ]} rows={tb.rows} rowKey="account_code" onRow={r=>setDrill(r.account_code)} />
      <div className="tb-tot"><span>合计</span><Money v={tb.totalDebit} bold/><Money v={tb.totalCredit} bold/>
        <Badge tone={Math.abs(tb.totalDebit-tb.totalCredit)<0.005?'ok':'bad'}>{Math.abs(tb.totalDebit-tb.totalCredit)<0.005?'✓ 平衡':'✗ 不平'}</Badge></div>
    </>}
    {tab==='Balance Sheet' && (()=>{ const rhs=st.liabilities+st.equity+st.netIncome; const ok=Math.abs(st.assets-rhs)<0.01; return <div className="stmt">
      <div className="stmt-row"><span>资产合计 Total Assets</span><Money v={st.assets} bold/></div>
      <div className="stmt-row" style={{marginTop:12}}><span>负债 Liabilities</span><Money v={st.liabilities}/></div>
      <div className="stmt-row"><span>权益 Equity</span><Money v={st.equity}/></div>
      <div className="stmt-row"><span>本期净利 Current-Year Earnings</span><Money v={st.netIncome}/></div>
      <div className="stmt-row tot"><span>负债 + 权益合计</span><Money v={rhs} bold/></div>
      <div className="stmt-row" style={{borderBottom:0}}><span>平衡检查 Assets = Liabilities + Equity</span><Badge tone={ok?'ok':'bad'}>{ok?'✓ 平衡':'✗ 不平'}</Badge></div>
    </div>; })()}
    {drill && tab==='Trial Balance' && (()=>{ const lines=[]; jes.filter(j=>j.posting_status==='POSTED'&&(!entity||j.entity_id===entity)).forEach(j=>j.lines.forEach(l=>{ if(l.account_code===drill) lines.push({je:j.je_number, date:j.je_date, desc:j.description, src:j.source_system, dr:l.debit_amount, cr:l.credit_amount}); }));
      return <div style={{marginTop:16}}><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setDrill(null)}>关闭</Btn>}>Drill-down · {drill} {acct(drill).account_name}（{lines.length} 行）</SectionTitle>
      <Table exportName={'gl-'+drill} cols={[{h:'JE',k:'je'},{h:'日期',k:'date'},{h:'描述',k:'desc'},{h:'来源',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},{h:'借方',num:true,render:r=><Money v={r.dr}/>,csv:r=>r.dr},{h:'贷方',num:true,render:r=><Money v={r.cr}/>,csv:r=>r.cr}]} rows={lines}/></div>; })()}
    {tab==='Income Statement' && <div className="stmt">
      <div className="stmt-row"><span>收入 Revenue</span><Money v={st.revenue} bold/></div>
      <div className="stmt-row"><span>费用 Expense</span><Money v={st.expense}/></div>
      <div className="stmt-row tot"><span>净利 Net Income</span><Money v={st.netIncome} bold/></div>
    </div>}
  </div>;
}

export function Reports({ctx}) {
  const {jes, entity, toast} = ctx;
  const st = statements(jes, entity);
  const reports = [
    ['Trial Balance','基础','GL'],['Balance Sheet','基础','GL'],['Income Statement','基础','GL'],
    ['Construction Loan Rollforward','贷款','Loan'],['Draw Reconciliation','贷款','Loan'],['Debt Maturity','贷款','Loan'],
    ['Project Cost Report','项目','Cost'],['Budget vs Actual','项目','Cost'],['Cost to Complete','项目','Cost'],
    ['Property Operating Statement','物业','Ops'],['Rent Roll Summary','物业','Ops'],['NOI Report','物业','Ops'],
    ['Exception Aging','管理','Mgmt'],['Manual JE Report','管理','Mgmt'],['Data Sync Report','管理','Mgmt'],
  ];
  return <div>
    <h2 className="page-h">报表中心</h2>
    <div className="kpi-row">
      <KPI label="总资产" value={money(st.assets)} />
      <KPI label="本期收入" value={money(st.revenue)} tone="ok" />
      <KPI label="本期净利" value={money(st.netIncome)} tone={st.netIncome>=0?'ok':'bad'} />
    </div>
    <SectionTitle>报表清单（支持 Drill Down · Export · Source Trace）</SectionTitle>
    <div className="rep-grid">{reports.map(([n,g,t])=>
      <Card key={n} hover className="rep-card" onClick={()=>toast(`打开报表：${n}（原型）`)}>
        <div className="rep-name">{n}</div><div className="rep-tag"><Badge tone="muted">{g}</Badge></div>
      </Card>)}</div>
  </div>;
}

function SimpleList({title, cols, rows, note}) {
  return <div><h2 className="page-h">{title}</h2>{note&&<p className="muted sm">{note}</p>}<Table cols={cols} rows={rows} /></div>;
}

export function ARModule() {
  return <SimpleList title="Accounts Receivable" note="客户/Owner/Tenant/关联方、账单、收款、账龄。"
    cols={[{h:'客户',render:r=>r.customer_name},{h:'类型',render:r=><Badge tone="muted">{r.customer_type}</Badge>},{h:'关联方',render:r=>r.is_related_party?'RP':'—'}]} rows={CUSTOMERS} />;
}
export function CashModule() {
  return <SimpleList title="Cash Management" note="银行账户主数据、Bank Feed、对账、划转。对账详见 Bank Reconciliation。"
    cols={[{h:'账户',k:'bank_account_code'},{h:'银行',k:'bank_name'},{h:'类型',render:r=><Badge tone="muted">{r.account_type}</Badge>},{h:'实体',render:r=>'E'+r.entity_id}]} rows={BANK_ACCOUNTS} />;
}
export function LoanRegister() {
  return <SimpleList title="Loan Register" note="贷款台账（与 WBS Loan Master 对齐）。提款/利息见 Construction Loan Workspace。"
    cols={[{h:'贷款',k:'loan_code'},{h:'类型',render:r=><Badge tone="muted">{r.loan_type}</Badge>},{h:'Lender',k:'lender_name'},{h:'Commitment',num:true,render:r=><Money v={r.commitment_amount}/>},{h:'当前本金',num:true,render:r=><Money v={r.current_principal}/>},{h:'利率',num:true,render:r=>(r.interest_rate*100).toFixed(2)+'%'}]} rows={LOANS} />;
}
export function ProjectCost() {
  const rows = LOAN_TXNS.filter(t=>t.txn_type==='DRAW').map(t=>({...t, cost:'CIP'}));
  return <SimpleList title="Project Cost Accounting" note="预算/合同/Commitment/Actual/CIP/资本化（原型：以 Draw 资金化为 CIP 示意）。"
    cols={[{h:'来源',k:'wbs_txn_id'},{h:'类型',render:r=><Badge tone="muted">{r.txn_type}</Badge>},{h:'日期',k:'transaction_date'},{h:'金额→CIP',num:true,render:r=><Money v={r.amount}/>}]} rows={rows} />;
}
export function Assets() {
  const rows = [{c:'Land',code:'1500',v:900000},{c:'Building',code:'1510',v:2100000}];
  return <SimpleList title="Fixed Asset & Property" note="Land/Building/折旧/处置（原型：来自 Closing 的资产入账）。"
    cols={[{h:'资产类',k:'c'},{h:'科目',render:r=>r.code+' '+acct(r.code).account_name},{h:'成本',num:true,render:r=><Money v={r.v}/>}]} rows={rows} />;
}
export function Intercompany({ctx}) {
  return <div><h2 className="page-h">Intercompany</h2>
    <p className="muted sm">Due to/from、镜像自动生成、Matching；不平进入异常（见 ICP-0007）。</p>
    <Table cols={[
      {h:'IC Pair',k:'ic_pair_id'},{h:'类型',render:r=><Badge tone="muted">{r.ic_type}</Badge>},
      {h:'发起方',k:'initiator_entity'},{h:'对手方',k:'counterparty_entity'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>},
      {h:'匹配',render:r=><Badge tone={r.match_status==='MATCHED'?'ok':'bad'}>{r.match_status}</Badge>},
    ]} rows={IC_TXNS} rowKey="ic_txn_id" /></div>;
}
export function IntegrationHub() {
  const batches = [
    {batch_id:'CL-20260731-007', src:'WBS_CL', status:'COMPLETED', n:4, ok:4},
    {batch_id:'PM-202607-P0020', src:'PM', status:'PARTIAL', n:5, ok:4},
    {batch_id:'BANK-20260731', src:'BANK', status:'COMPLETED', n:4, ok:4},
  ];
  return <div><h2 className="page-h">Integration Hub</h2>
    <p className="muted sm">外部数据先入 Staging，禁止直写 GL。批次幂等去重、Retry、失败补偿。</p>
    <Table cols={[
      {h:'批次',k:'batch_id'},{h:'来源',render:r=><Badge tone="muted">{r.src}</Badge>},
      {h:'记录',num:true,render:r=>r.ok+'/'+r.n},
      {h:'状态',render:r=><Badge tone={r.status==='COMPLETED'?'ok':'warn'}>{r.status}</Badge>},
    ]} rows={batches} rowKey="batch_id" /></div>;
}
export function MasterData() {
  const [tab,setTab] = useState('Entity');
  const map = {Entity:[ENTITIES,[{h:'编码',k:'entity_code'},{h:'名称',k:'entity_name'},{h:'类型',render:r=><Badge tone="muted">{r.entity_type}</Badge>}]],
    Project:[PROJECTS,[{h:'编码',k:'project_code'},{h:'名称',k:'project_name'},{h:'建设状态',render:r=><Badge tone={r.construction_status==='UNDER_CONSTRUCTION'?'warn':'ok'}>{r.construction_status}</Badge>}]],
    Property:[PROPERTIES,[{h:'编码',k:'property_code'},{h:'名称',k:'property_name'},{h:'状态',render:r=><Badge tone="muted">{r.property_status}</Badge>}]]};
  const [rows,cols] = map[tab];
  return <div><h2 className="page-h">Master Data Center</h2>
    <p className="muted sm">编码唯一、版本化、历史锁定；修改不覆盖历史。</p>
    <Tabs tabs={Object.keys(map)} active={tab} onChange={setTab} />
    <Table cols={cols} rows={rows} /></div>;
}
export function MappingCenter() {
  return <SimpleList title="Mapping Center" note="PM Charge Code → Owner GL 映射，版本化。注意 PET_FEE 缺映射（会触发 GL_MAPPING_MISSING）。"
    cols={[{h:'类型',render:r=><Badge tone="muted">{r.mapping_type}</Badge>},{h:'Charge Code',k:'source_code'},{h:'Owner GL',render:r=>r.owner_gl_account_code+' '+acct(r.owner_gl_account_code).account_name},{h:'收/支',k:'rev_exp_flag'},{h:'现/权',k:'cash_accrual_flag'}]} rows={MAPPINGS} />;
}
export function RuleCenter() {
  const rules = [
    ['R-LOAN-01','LOAN.DRAW','借 1400 CIP / 贷 2500','LIVE'],
    ['R-LOAN-03','LOAN.INTEREST(在建)','借 1405 / 贷 2100','LIVE'],
    ['R-LOAN-04','LOAN.INTEREST(投运)','借 5000 / 贷 2100','LIVE'],
    ['R-PM-11','PM.RENT','借 1000/1200 / 贷 4000','LIVE'],
    ['R-PM-16','PM.SEC_DEPOSIT','借 1000 / 贷 2200(负债)','LIVE'],
    ['R-CLS-21','CLOSING.ACQUISITION','借 Land/Building / 贷 Loan/Cash','TESTED'],
  ];
  return <div><h2 className="page-h">Accounting Rule Center</h2>
    <p className="muted sm">规则独立管理、版本化、沙箱测试；未 TESTED 不可 LIVE。</p>
    <Table cols={[{h:'Rule',k:0,render:r=>r[0]},{h:'Trigger',render:r=>r[1]},{h:'借贷逻辑',render:r=>r[2]},{h:'状态',render:r=><Badge tone={r[3]==='LIVE'?'ok':'warn'}>{r[3]}</Badge>}]} rows={rules} rowKey={0} /></div>;
}
export function AdminModule({ctx}) {
  return <div><h2 className="page-h">System Admin</h2>
    <p className="muted sm">RBAC、审批配置、期间管理。当前角色可在顶栏切换以体验权限差异。</p>
    <SectionTitle>职责分离 (SoD) 硬规则</SectionTitle>
    <ul className="sod-list">
      <li>建 Vendor 且付款 · 建 JE 且最终审批（Maker≠Approver）</li>
      <li>改银行信息且付款 · 改 Mapping 且批 Mapping</li>
      <li>上传外部数据且直接 Posting · 建主数据且批主数据</li>
    </ul>
    <p className="muted sm">本原型对「Maker≠Approver」做了实时拦截：用创建该分录的账号去审批/过账会被阻止。</p>
  </div>;
}
