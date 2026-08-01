import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { acct, money, sum } from './engine.js';
import { aiJudge } from './ai.js';
import { ENTITIES } from './data.js';
import { repo } from './repo.js';

// Accounting Staging Center — 灵魂链路: Source→Classification→Setting→AI→Review→Draft JE (§4/§6/§9/§12)
const SEED_STAGING = [
 {id:'STG-001', category:'Bank Transaction', type:'Bank', source_system:'BANK', source_id:'BANKTXN-Z-4471', entity_id:4, date:'2026-07-30', amount:1250, direction:'CREDIT', description:'ACH UNKNOWN TENANT', payee:'', cost_code:'', status:'', mapping:'MISSING', stage:'Pending Mapping'},
 {id:'STG-002', category:'Construction Loan', type:'Contruction Loan', detail:'Draw', source_system:'WBS_CL', source_id:'DRAW-2026-0801', entity_id:5, date:'2026-08-01', amount:250000, description:'Draw Request #8 · Cedar Ridge', payee:'First National Bank', cost_code:'', status:'UNDER_CONSTRUCTION', mapping:'OK', stage:'Pending Coding'},
 {id:'STG-003', category:'FAST Cost', type:'Cost', source_system:'FAST', source_id:'FAST-88412', entity_id:5, date:'2026-07-29', amount:18400, description:'Framing labor · Lot 103 Block B', payee:'Summit General Contractors', cost_code:'2HD220', status:'UNDER_CONSTRUCTION', mapping:'OK', stage:'Pending Coding'},
 {id:'STG-004', category:'FAST Cost', type:'Cost', source_system:'FAST', source_id:'FAST-88413', entity_id:5, date:'2026-07-29', amount:6200, description:'Punch-out · Lot 101 Block A (完工单元)', payee:'Summit General Contractors', cost_code:'2HD850', status:'COMPLETED', mapping:'OK', stage:'Pending Coding'},
 {id:'STG-005', category:'Faster PO', type:'Cost', source_system:'FASTER_PO', source_id:'FPO-2026-3321', entity_id:15, date:'2026-07-28', amount:4300, description:'Marketing services Q3', payee:'Wan Bridge Land LLC', cost_code:'24E060', status:'', mapping:'OK', stage:'Pending Review'},
 {id:'STG-006', category:'Property Operation', type:'Yardi', source_system:'PM', source_id:'YARDI-5585', entity_id:11, date:'2026-07-31', amount:120, description:'PET_FEE · Unit C-050', payee:'', cost_code:'', status:'', mapping:'MISSING', stage:'Pending Mapping'},
 {id:'STG-007', category:'Sales Income', type:'Sales income', detail:'Confirmed amount', source_system:'CLOSING', source_id:'HUD-WBCR-2608', entity_id:5, date:'2026-08-01', amount:391000, description:'Closing · Lot 102 Block B · Confirmed amount', payee:'Apex Title LLC', cost_code:'', status:'SOLD', mapping:'OK', stage:'Pending Review'},
 {id:'STG-008', category:'Sales Income', type:'Sales income', detail:'Title Withholding', source_system:'CLOSING', source_id:'HUD-WBCR-2608', entity_id:5, date:'2026-08-01', amount:3910, description:'Closing · Title Withholding', payee:'Apex Title LLC', cost_code:'', status:'SOLD', mapping:'OK', stage:'Pending Review'},
 {id:'STG-009', category:'Dividend', type:'Dividend', detail:'Actual dividend amount', source_system:'RETAIL_INV', source_id:'DIV-202608-B1', entity_id:2, date:'2026-08-01', amount:4200, description:'Dividend · Lot 205 Block A8 · Hui Chen', payee:'Hui Chen', cost_code:'', status:'', mapping:'OK', stage:'Pending Review'},
 {id:'STG-010', category:'Intercompany', type:'Internal Transfer', detail:'Normal', source_system:'BANK', source_id:'BANKTXN-IT-889', entity_id:1, date:'2026-07-31', amount:50000, description:'Transfer WBGR→WBDE operating funding', payee:'Wan Bridge Development LLC', cost_code:'', status:'', mapping:'OK', stage:'Pending Coding'},
];
export function StagingCenter({ctx}) {
  const {actions, toast, entity, can} = ctx;
  const [rows, setRows] = useState(()=>repo.load('staging', SEED_STAGING));
  const [tab, setTab] = useState('全部');
  const [aiRow, setAiRow] = useState(null);
  const save = (r)=>{ setRows(r); repo.save('staging', r); };
  const enOf = id => ENTITIES.find(e=>e.entity_id===id)||ENTITIES[0];
  const judge = (r)=> aiJudge({category:r.category, type:r.type, detail:r.detail||r.description, direction:r.direction, amount:r.amount, description:r.description, payee:r.payee, cost_code:r.cost_code, status:r.status}, enOf(r.entity_id));
  const STAGES=['全部','Pending Mapping','Pending Coding','Pending Review','Ready to Post','Draft JE','Exception','AI 决策日志'];
  const list = rows.filter(r=>(tab==='全部'||r.stage===tab) && (!entity||r.entity_id===entity));
  const stageTone = s=>({'Pending Mapping':'bad','Pending Coding':'warn','Pending Review':'warn','Ready to Post':'ok','Draft JE':'ok','Exception':'bad'}[s]||'muted');
  const advance = (r)=>{
    if (r.stage==='Pending Mapping'){ toast('缺 Mapping:先到 Mapping Center 配置(已登记 Exception)','bad');
      actions.ensureException({exception_type:'GL_MAPPING_MISSING', severity:'HIGH', object_type:'STAGING', object_ref:r.source_id, entity_id:r.entity_id, owner:'PROPERTY_ACCT', root_cause:'Staging 无匹配 Setting'}); return; }
    const j = judge(r);
    if (r.stage==='Pending Coding'){ save(rows.map(x=>x.id===r.id?{...x, stage:'Pending Review', ai:j}:x)); toast(`AI 已编码: Dr ${j.suggested.dr} / Cr ${j.suggested.cr} (${(j.confidence*100).toFixed(0)}%)`); return; }
    if (r.stage==='Pending Review'){ save(rows.map(x=>x.id===r.id?{...x, stage:'Ready to Post', ai:j}:x)); toast('人工复核通过 → Ready to Post'); return; }
    if (r.stage==='Ready to Post'){
      import('./ai.js').then(m=>m.logAI({input_digest:'human', input_summary:r.source_id, entity:enOf(r.entity_id).entity_code, human_decision:'APPROVED→DraftJE', suggested:j.suggested, confidence:j.confidence, rule:j.rule_used, diff:'none(采纳AI建议)'}));
      const id = actions.newJEFromRule({entity_id:r.entity_id, source_system:r.source_system, payee:r.payee||null,
        source_doc_id:r.source_id,description:`${r.description} [${r.source_id}]`, rule_code:j.rule_used,setting_used:j.setting_used||`${enOf(r.entity_id).entity_code}:approved-setting`,mapping_used:`${r.mapping}:${r.category}:${r.type}`,je_type:'AUTO',
        lines:[{account_code:j.suggested.dr, debit_amount:r.amount, credit_amount:0, member: j.suggested.dr.startsWith('291')?r.payee:undefined, cost_code:r.cost_code||undefined, description:r.cost_code||undefined},
               {account_code:j.suggested.cr, debit_amount:0, credit_amount:r.amount, member: j.suggested.cr.startsWith('291')?(r.payee||'Wan Bridge Development LLC'):undefined, description: j.suggested.cr.startsWith('291')?('Due to/from_'+(r.payee||'WBDE')):undefined}]});
      if(!id){toast(`Draft JE blocked for ${r.source_id}; source remains Ready to Post.`,'bad');return;}
      save(rows.map(x=>x.id===r.id?{...x, stage:'Draft JE', je_id:id}:x));
      toast(`Draft JE 已生成并进入审批流(source trace: ${r.source_id})`); return; }
  };
  const actLabel = {'Pending Mapping':'去配 Mapping','Pending Coding':'🤖 AI 编码','Pending Review':'复核通过','Ready to Post':'生成 Draft JE','Posted':'✓','Exception':'处理'}
  return <div className="full-bleed">
    <h2 className="page-h">Accounting Staging Center</h2>
    <div className="filter-bar">
      <span className="muted sm">Source → Classification → Company Setting → AI Coding → Human Review → Draft JE → Approval → GL(§4 全链路,禁止跳步)</span>
    </div>
    <div className="kpi-row">
      <KPI label="Pending Mapping" value={rows.filter(r=>r.stage==='Pending Mapping').length} tone="bad"/>
      <KPI label="Pending Coding/Review" value={rows.filter(r=>/Coding|Review/.test(r.stage)).length} tone="warn"/>
      <KPI label="Ready to Post" value={rows.filter(r=>r.stage==='Ready to Post').length} tone="ok"/>
      <KPI label="Posted" value={rows.filter(r=>r.stage==='Posted').length}/>
    </div>
    <Tabs tabs={STAGES} active={tab} onChange={setTab}/>
    {tab==='AI 决策日志' && (()=>{ const log=repo.load('ai_log',[]);
      return <Table exportName="ai-decision-log" pageSize={20} cols={[
        {h:'Time',k:'ts'},{h:'Model',render:r=><Badge tone="muted">{r.model}</Badge>},{h:'Prompt Ver',k:'prompt_version'},
        {h:'Input',render:r=><span className="muted sm">{r.input_summary} · {r.input_digest}</span>},
        {h:'Entity',k:'entity'},
        {h:'Suggested',render:r=>r.suggested?`Dr ${r.suggested.dr} / Cr ${r.suggested.cr}`:'—'},
        {h:'Conf',render:r=>r.confidence?(r.confidence*100).toFixed(0)+'%':'—'},
        {h:'人工决策/差异',render:r=>r.human_decision?<Badge tone="ok">{r.human_decision}</Badge>:<span className="muted sm">建议(待人审)</span>},
      ]} rows={log} empty="尚无 AI 判断记录"/>; })()}
    {tab!=='AI 决策日志' && <Table rowKey="id" pageSize={20} exportName="staging" onRow={r=>setAiRow(r)} cols={[
      {h:'',w:8,render:r=><span style={{display:'inline-block',width:8,height:26,borderRadius:3,background:{bad:'#D93025',warn:'#F5B300',ok:'#0B9E58',muted:'#9aa2af'}[stageTone(r.stage)]}}/>},
      {h:'Source ID',render:r=><b style={{fontSize:12.5}}>{r.source_id}</b>,csv:r=>r.source_id},
      {h:'Category',render:r=><Badge tone="muted">{r.category}</Badge>,csv:r=>r.category},
      {h:'Entity',render:r=>enOf(r.entity_id).entity_code},
      {h:'Date',k:'date'},
      {h:'Description',k:'description'},
      {h:'Cost Code',render:r=>r.cost_code||'—'},
      {h:'Status',render:r=>r.status||'—'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},
      {h:'Mapping',render:r=>r.mapping==='OK'?<Badge tone="ok">OK</Badge>:<Badge tone="bad">MISSING</Badge>},
      {h:'Stage',render:r=><Badge tone={stageTone(r.stage)}>{r.stage}</Badge>,csv:r=>r.stage},
      {h:'Action',render:r=> r.stage==='Draft JE' ? <span className="muted sm">Draft JE ✓</span> :
        <Btn size="sm" variant={r.stage==='Ready to Post'?'primary':'default'} onClick={e=>{e.stopPropagation(); advance(r);}}>{actLabel[r.stage]}</Btn>},
    ]} rows={list} empty="本阶段无待处理源数据"/>}
    {aiRow && (()=>{ const j=judge(aiRow); return <div className="src-card" style={{marginTop:14}}>
      <div className="src-chain"><span className="chip">{aiRow.source_system}</span>→<span className="chip">{aiRow.category}</span>→<span className="chip">Setting {enOf(aiRow.entity_id).entity_code}·2026</span>→<span className="chip chip-on">AI Judge</span>→<span className="chip">Draft JE</span></div>
      <div className="src-grid">
        <span><i>Suggested JE</i><b>Dr {j.suggested.dr} {j.suggested.dr_name} · Cr {j.suggested.cr} {j.suggested.cr_name}</b></span>
        <span><i>Confidence</i><b>{(j.confidence*100).toFixed(0)}%</b></span>
        <span><i>Rule</i><b>{j.rule_used}</b></span>
        <span><i>Risk</i><b>{j.risk}</b></span>
        <span><i>需人工</i><b>{j.need_human?'YES':'no'}</b></span>
        <span><i>金额</i><b>{money(aiRow.amount)}</b></span>
      </div>
      <p className="muted sm" style={{margin:'8px 0 0'}}>Reason: {j.reason} · Evidence: {j.evidence.slice(0,70)} · AI 只建议,人工确认后才生成 Draft JE</p>
    </div>; })()}
  </div>;
}
