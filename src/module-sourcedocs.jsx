import { KPI, Badge, Money, Table } from './ui.jsx';
import { SOURCE_DOCS } from './seed.js';
import { money } from './engine.js';

export function SourceDocs({ctx}) {
  const {jes, goto} = ctx;
  const docs = Object.values(SOURCE_DOCS);
  const jeOf = {}; jes.forEach(j=>{ if(j.source_doc_id) jeOf[j.source_doc_id]=(jeOf[j.source_doc_id]||[]).concat(j.je_number); });
  return <div className="full-bleed">
    <h2 className="page-h">Source Documents · 源单据登记簿</h2>
    <div className="kpi-row">
      <KPI label="源单据总数" value={docs.length}/>
      <KPI label="已关联 JE" value={Object.keys(jeOf).length} tone="ok"/>
      <KPI label="孤儿单据" value={docs.length-Object.keys(jeOf).length} tone={docs.length-Object.keys(jeOf).length?'warn':'ok'}/>
    </div>
    <Table exportName="source-documents" rowKey="id" pageSize={25} onRow={()=>goto('je')} cols={[
      {h:'Doc ID',k:'id'},
      {h:'Type',render:r=><Badge tone="muted">{r.type}</Badge>,csv:r=>r.type},
      {h:'Doc No',render:r=><b>{r.doc_no}</b>,csv:r=>r.doc_no},
      {h:'Source System',k:'source_system'},
      {h:'PO / Contract',render:r=>[r.po_no,r.contract].filter(Boolean).join(' · ')||'—'},
      {h:'Unit',render:r=>r.unit||'—'},
      {h:'Vendor/Buyer',render:r=>r.vendor||r.buyer||'—'},
      {h:'Date',k:'date'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
      {h:'JE Trace',render:r=>(jeOf[r.id]||[]).slice(0,2).join(', ')||<Badge tone="warn">未关联</Badge>,csv:r=>(jeOf[r.id]||[]).join(';')},
    ]} rows={docs}/>
  </div>;
}
