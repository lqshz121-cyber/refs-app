import { Badge, KPI, Table, SectionTitle, Tabs } from './ui.jsx';
import { WBS_AUTORECON_PROGRESS } from './wbs-autorecon-progress.js';

// WBS views are evidence-only. They cannot issue WBS commands or create REFS journals.
export function AutoBankRec({ctx={}}) {
  const authoritative=ctx.authoritativeMode===true;
  return <div className="full-bleed">
    <h2 className="page-h">Auto Bank Reconciliation</h2>
    <section className="card" style={{marginBottom:16}}>
      <SectionTitle>WBS to REFS integration status</SectionTitle>
      <p className="muted sm">{authoritative?<><Badge tone="warn">AUTOREC_API_UNAVAILABLE</Badge> <Badge tone="warn">RECEIPT_EVIDENCE_PENDING</Badge> The authoritative service has not returned a scoped immutable receipt. No candidate, Draft, allocation, Release, Incur, approval, or posting action is available.</>:<><Badge tone="warn">DEMO_DATA_ONLY</Badge> <Badge tone="warn">{WBS_AUTORECON_PROGRESS.status}</Badge> {WBS_AUTORECON_PROGRESS.liveEvidence}</>}</p>
      <Table rowKey="source" rows={WBS_AUTORECON_PROGRESS.sources} cols={[
        {h:'WBS source',k:'source'},{h:'REFS role',k:'role'},{h:'Entry path',k:'entry'},{h:'Required gate',k:'gate'},
      ]}/>
      <SectionTitle>Observed WBS workflow and REFS authority boundary</SectionTitle>
      <Table rowKey="stage" rows={WBS_AUTORECON_PROGRESS.workflow} cols={[
        {h:'WBS stage',k:'stage'},{h:'Observed evidence',k:'observed'},{h:'REFS evidence path',k:'refs'},{h:'Authority boundary',k:'authority'},
      ]}/>
      <SectionTitle>Implemented accounting controls</SectionTitle>
      <ul className="muted sm">{WBS_AUTORECON_PROGRESS.controls.map(control=><li key={control}>{control}</li>)}</ul>
    </section>
    <section className="card">
      <SectionTitle>Release safeguards</SectionTitle>
      <p className="muted sm">This website presents a read-only progress view. Release, Incur, journal creation, approval, posting, and source refresh remain unavailable until the service returns an immutable WBS receipt and authoritative state.</p>
      <Badge tone="muted">NO LOCAL POSTING</Badge>
    </section>
  </div>;
}

export function CheckMgmt({ctx={}}) {
  if(ctx.authoritativeMode)return <section className="card" role="status"><h2 className="page-h">Payment Confirmation</h2><p>CHECK_API_UNAVAILABLE</p></section>;
  const checks=[
    {no:'CHK-1086',date:'07/12/2026',payee:'Summit General Contractors',amount:42000,status:'CLEARED',bank:'BA-001'},
    {no:'CHK-1087',date:'07/20/2026',payee:'BluePeak Utilities',amount:3200,status:'CLEARED',bank:'BA-003'},
    {no:'CHK-1088',date:'07/29/2026',payee:'WanBridge Property Mgmt',amount:2400,status:'OUTSTANDING',bank:'BA-003'},
    {no:'CHK-1089',date:'07/30/2026',payee:'Apex Title LLC',amount:1500,status:'PENDING',bank:'BA-001'},
  ];
  return <div><h2 className="page-h">Payment Confirmation</h2><div className="kpi-row"><KPI label="Outstanding checks" value={checks.filter(c=>c.status==='OUTSTANDING').length} tone="warn"/><KPI label="Pending print" value={checks.filter(c=>c.status==='PENDING').length}/><KPI label="Cleared this period" value={checks.filter(c=>c.status==='CLEARED').length} tone="ok"/><KPI label="Voided" value={0}/></div><Tabs tabs={['Check Register','Pending Payment']} active="Check Register" onChange={()=>{}}/><Table exportName="check-register" rowKey="no" rows={checks} cols={[{h:'Check No.',k:'no'},{h:'Date',k:'date'},{h:'Payee',k:'payee'},{h:'Bank account',k:'bank'},{h:'Amount',k:'amount',num:true},{h:'Status',render:r=><Badge tone={r.status==='CLEARED'?'ok':r.status==='VOID'?'bad':'warn'}>{r.status}</Badge>}]}/><p className="muted sm">This legacy display is read-only. Check printing, voiding, bank reconciliation, and journal reversal require the authoritative service workflow.</p></div>;
}
