import { useEffect, useMemo, useState } from 'react';
import { KPI, Badge, Money, Table, Btn, SectionTitle } from './ui.jsx';
import { SOURCE_DOCS } from './seed.js';
import { localReportReturnScopeLabel } from './report-return-context.js';

export function SourceDocs({ctx}) {
  const {jes, goto, navContext} = ctx;
  const docs = useMemo(()=>Object.values(SOURCE_DOCS),[]);
  const jeOf = {};
  jes.forEach(j=>{ if(j.source_doc_id) jeOf[j.source_doc_id]=(jeOf[j.source_doc_id]||[]).concat(j.je_number); });

  const [selectedId, setSelectedId] = useState(null);
  const [sourceRefNotice, setSourceRefNotice] = useState(null);

  useEffect(() => {
    if (navContext?.route !== 'sourcedocs') return;
    if (navContext.docId && SOURCE_DOCS[navContext.docId]) { setSelectedId(navContext.docId); setSourceRefNotice(null); return; }
    if (navContext.sourceRef) {
      const ref=String(navContext.sourceRef); const hit=docs.find(doc=>[doc.id,doc.doc_no,doc.external_id,doc.source_ref].filter(Boolean).map(String).includes(ref));
      if(hit){ setSelectedId(hit.id); setSourceRefNotice(null); } else { setSelectedId(null); setSourceRefNotice(ref); }
    }
  }, [navContext?.route, navContext?.docId, navContext?.sourceRef, docs]);

  const workspaceTargetFor = (d, jeNumber) => {
    const src = `${d.source_system||''} ${d.type||''}`.toUpperCase();
    if (src.includes('CLOSING')) return { route:'closing', label:'Open closing workspace' };
    if (src.includes('PM')) return { route:'pmpickup', context:{ route:'pmpickup', jeNumber }, label:'Open PM workspace' };
    if (src.includes('BANK')) return { route:'banktx', context:{ route:'banktx', jeNumber }, label:'Open bank workspace' };
    if (src.includes('WBS') || src.includes('PAYABLE') || src.includes('INVOICE')) return { route:'ap', context:{ route:'ap', tab:'Bills', jeNumber }, label:'Open AP workspace' };
    return null;
  };

  const docsOrdered = useMemo(() => {
    const copy = [...docs];
    copy.sort((a,b)=>{
      if (selectedId && a.id===selectedId) return -1;
      if (selectedId && b.id===selectedId) return 1;
      return String(b.date||'').localeCompare(String(a.date||'')) || String(a.doc_no).localeCompare(String(b.doc_no));
    });
    return copy;
  }, [docs, selectedId]);

  const selectedDoc = selectedId ? SOURCE_DOCS[selectedId] : null;
  const selectedJEList = selectedDoc ? (jeOf[selectedDoc.id] || []) : [];
  const selectedJE = selectedJEList.length ? jes.find(j=>j.je_number===selectedJEList[selectedJEList.length - 1]) : null;
  const selectedWorkspace = selectedDoc ? workspaceTargetFor(selectedDoc, selectedJE?.je_number) : null;
  const selectedSourceReturn = selectedDoc ? {
    route:'sourcedocs', docId:selectedDoc.id,
    expenseReturn:navContext?.expenseReturn?.route === 'ap' ? navContext.expenseReturn : null,
    receiptReturn:navContext?.receiptReturn?.route === 'receipts' ? navContext.receiptReturn : null,
    reportReturn:navContext?.reportReturn?.route === 'gl' ? navContext.reportReturn : null,
  } : null;

  return <div className="full-bleed">
    {navContext?.reportReturn?.route==='gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    <h2 className="page-h">Source Documents · 源单据登记簿</h2>
    <div className="kpi-row">
      <KPI label="源单据总数" value={docs.length}/>
      <KPI label="已关联 JE" value={Object.keys(jeOf).length} tone="ok"/>
      <KPI label="孤儿单据" value={docs.length-Object.keys(jeOf).length} tone={docs.length-Object.keys(jeOf).length?'warn':'ok'}/>
    </div>

    {navContext?.route==='sourcedocs' && selectedId && <div className="bank-health" role="status" style={{marginBottom:14}}>
      <span className="bank-health-icon">i</span><div><b>Drill context applied</b><p>Focused source document {selectedId} from the journal / report drill path.</p></div></div>}
    {navContext?.route==='sourcedocs' && sourceRefNotice && <div className="bank-health" role="status" style={{marginBottom:14}}>
      <span className="bank-health-icon">i</span><div><b>No retained source document found</b><p>AI requested source reference {sourceRefNotice}. It is retained in the finding evidence, but no local source-document register row matches it.</p></div></div>}

    {selectedDoc && <section className="source-doc-shell">
      <div className="source-doc-hero">
        <div>
          <p className="eyebrow">SOURCE DOCUMENT</p>
          <h3>{selectedDoc.doc_no}</h3>
          <p className="page-subtitle">Trace from source evidence into posted journal activity and the closest operating workspace.</p>
        </div>
        <div className="source-doc-hero-actions">
          {navContext?.journalReturn?.route==='je' && <Btn size="sm" variant="ghost" onClick={()=>goto('je',navContext.journalReturn)}>Back to journal entry</Btn>}
          {navContext?.receiptReturn?.route==='receipts' && <Btn size="sm" variant="ghost" onClick={()=>goto('receipts',navContext.receiptReturn)}>Back to Receipt evidence</Btn>}
          {navContext?.expenseReturn?.route==='ap' && <Btn size="sm" variant="ghost" onClick={()=>goto('ap',navContext.expenseReturn)}>{navContext.expenseReturn.billId != null ? 'Back to Bill' : navContext.expenseReturn.tab === 'AP Aging' ? 'Back to AP Aging' : 'Back to Expenses'}</Btn>}
          {navContext?.arReturn?.route==='ar' && navContext.arReturn.invoiceId && <Btn size="sm" variant="ghost" onClick={()=>goto('ar',navContext.arReturn)}>Back to Invoice detail</Btn>}
          <Badge tone="muted">{selectedDoc.type}</Badge>
          <Badge tone="ok">{selectedDoc.source_system}</Badge>
        </div>
      </div>

      <div className="source-doc-meta">
        <span><i>Doc ID</i><b>{selectedDoc.id}</b></span>
        <span><i>Uploaded by</i><b>{selectedDoc.uploaded_by || 'Not retained'}</b></span>
        <span><i>Uploaded at</i><b>{selectedDoc.uploaded_at || 'Not retained'}</b></span>
        <span><i>Ingestion confidence</i><b>{selectedDoc.confidence_score!=null ? `${(Number(selectedDoc.confidence_score)*100).toFixed(0)}%` : 'Not retained'}</b></span>
        <span><i>Match status</i><b>{selectedDoc.matched_status || 'Not retained'}</b></span>
        <span><i>Treatment status</i><b>{selectedDoc.accounting_treatment_status || 'Not retained'}</b></span>
        <span><i>Date</i><b>{selectedDoc.date || '—'}</b></span>
        <span><i>Amount</i><b>{selectedDoc.amount!=null ? `$${(+selectedDoc.amount).toLocaleString()}` : '—'}</b></span>
        <span><i>Counterparty</i><b>{selectedDoc.vendor || selectedDoc.buyer || selectedDoc.title_co || '—'}</b></span>
        <span><i>Unit</i><b>{selectedDoc.unit || '—'}</b></span>
        <span><i>PO / Contract</i><b>{[selectedDoc.po_no, selectedDoc.contract].filter(Boolean).join(' · ') || '—'}</b></span>
      </div>

      <div className="source-doc-trace">
        <span className="chip">Source</span>
        <span className="chip">{selectedDoc.type}</span>
        <span className="chip">{selectedDoc.source_system}</span>
        {selectedJE ? <span className="chip chip-on">JE {selectedJE.je_number}</span> : <span className="chip">No JE</span>}
        <span className="chip">GL</span>
      </div>

      <div className="source-doc-panel-grid">
        <div className="source-doc-panel">
          <h4>Document attributes</h4>
          <div className="source-doc-kv">
            {Object.entries({
              'Cost code': selectedDoc.cost_code,
              'Vendor': selectedDoc.vendor,
              'Buyer': selectedDoc.buyer,
              'Title company': selectedDoc.title_co,
              'PO number': selectedDoc.po_no,
              'Contract': selectedDoc.contract,
            }).filter(([,v])=>v).map(([k,v])=><span key={k}><i>{k}</i><b>{v}</b></span>)}
          </div>
        </div>
        <div className="source-doc-panel">
          <h4>Journal trace</h4>
          {selectedJE ? <div className="source-doc-kv">
            <span><i>JE number</i><b>{selectedJE.je_number}</b></span>
            <span><i>Posting date</i><b>{selectedJE.je_date}</b></span>
            <span><i>Source system</i><b>{selectedJE.source_system}</b></span>
            <span><i>Rule</i><b>{selectedJE.rule_code || '—'}</b></span>
            <span><i>Description</i><b>{selectedJE.description}</b></span>
          </div> : <div className="muted sm">No journal entry is linked to this source document yet.</div>}
        </div>
      </div>

      <div className="src-actions">
        {selectedJE ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:selectedJE.je_number,sourceDocumentReturn:selectedSourceReturn})}>Open JE</Btn> : null}
        {selectedWorkspace ? <Btn size="sm" variant="ghost" onClick={()=>goto(selectedWorkspace.route, selectedWorkspace.context || null)}>{selectedWorkspace.label}</Btn> : null}
      </div>
    </section>}

    <SectionTitle right={selectedId ? <Btn size="sm" variant="ghost" onClick={()=>setSelectedId(null)}>Clear focus</Btn> : null}>Source document register</SectionTitle>
    <Table exportName="source-documents" rowKey="id" pageSize={25} onRow={d=>setSelectedId(d.id)} cols={[
      {h:'Doc ID',k:'id'},
      {h:'Focus',render:r=>selectedId===r.id?<Badge tone="ok">Focused</Badge>:<span className="muted sm">—</span>,csv:r=>selectedId===r.id?'Y':''},
      {h:'Type',render:r=><Badge tone="muted">{r.type}</Badge>,csv:r=>r.type},
      {h:'Doc No',render:r=><b>{r.doc_no}</b>,csv:r=>r.doc_no},
      {h:'Source System',k:'source_system'},
      {h:'PO / Contract',render:r=>[r.po_no,r.contract].filter(Boolean).join(' · ')||'—'},
      {h:'Unit',render:r=>r.unit||'—'},
      {h:'Vendor/Buyer',render:r=>r.vendor||r.buyer||'—'},
      {h:'Date',k:'date'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
      {h:'JE Trace',render:r=>(jeOf[r.id]||[]).slice(0,2).join(', ')||<Badge tone="warn">未关联</Badge>,csv:r=>(jeOf[r.id]||[]).join(';')},
      {h:'Action',render:r=>{ const jeList = jeOf[r.id] || []; const jeNumber = jeList[jeList.length - 1]; const ws = workspaceTargetFor(r, jeNumber);
        return <span className="row-acts">
          <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); setSelectedId(r.id);}}>View</Btn>
          {jeNumber ? <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); goto('je', {jeNumber,sourceDocumentReturn:{route:'sourcedocs',docId:r.id}});}}>Open JE</Btn> : null}
          {ws ? <Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation(); goto(ws.route, ws.context || null);}}>{ws.label}</Btn> : null}
        </span>; },csv:()=>''},
    ]} rows={docsOrdered}/>
  </div>;
}
