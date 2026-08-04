import { useState, useEffect } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { COA, ENTITIES, VENDORS, CUSTOMERS, LOANS, BANK_ACCOUNTS, MAPPINGS, PROPERTIES, PROJECTS } from './data.js';
import { LOAN_TXNS, IC_TXNS, CLOSINGS, PM_ROWS, SOURCE_DOCS } from './seed.js';
import { acct, money, sum, jeTotals, trialBalance, statements, downloadCSV } from './engine.js';
import { normalizeReportFavorites, toggledReportFavorites } from './report-favorites.js';
import { filterAccountingRuleEvidence } from './accounting-rule-listing.js';
import { REPORT_BUSINESS_SCOPE, isReportCapabilityExcluded } from './report-business-scope.js';
import { localReportCapability, localReportWorkflowTarget } from './report-workflow-targets.js';
import { localGLSourceTarget } from './gl-source-target.js';
import { localGLDrillState, localGLDrillAccountCodes, localGLRunningBalanceRows } from './gl-drill-state.js';
import { dimensionScopeLabel, scopedPostedJournalEntries } from './gl-dimension-scope.js';
import { postedJournalEntriesAsOf } from './balance-sheet-asof.js';
import { buildLocalCashFlow } from './cash-flow-evidence.js';
import { isOperatingCashAccount, localBankEvidenceForCashGroup, localCashAccountRows, localCashAccountGroup } from './cash-account-scope.js';
import { localReportControlEvidence } from './report-control-evidence.js';
import { createLocalReportScope, localReportScopeForEntity, normalizeLocalReportScopes, saveLocalReportScope } from './report-scope-presets.js';
import { localAssetSubledger, localAssetSubledgerControl } from './asset-subledger-evidence.js';
import { localDimensionScopeEvidence } from './dimension-scope-evidence.js';
import { localApAgingEvidenceRows, localArAgingEvidenceRows, localAgingGlTbBridgeEvidence } from './aging-local-evidence.js';
import { localVendorCreditEvidence } from './vendor-credit-evidence.js';
import { localReconciliationGlTbBridgeEvidence } from './reconciliation-local-evidence.js';
import { localReportReturnContext } from './report-return-context.js';
import { localReportWorkflowContext } from './report-workflow-return.js';
import { localIncomeStatementSection } from './income-statement-classification.js';
import { localReportScopeState } from './report-scope-empty-state.js';
import { localLedgerReportLaunchContext } from './report-launch-context.js';
import { localPaymentReturnScopeLabel } from './payment-return-context.js';
import { localReconciliationJournalReturnScopeLabel } from './reconciliation-journal-return.js';
import { localAccountRegisterReturnScopeLabel } from './account-register-return.js';
import { localBalanceSheetRegisterTarget } from './balance-sheet-register-return.js';
import { localCashFlowRegisterTarget } from './cash-flow-register-return.js';
import { localBankTransactionJournalReturnScopeLabel } from './bank-transaction-return.js';

export function GLTrialBalance({ctx}) {
  const {jes, entity, navContext, ap, ar, bank, toast} = ctx;
  const preset = navContext && navContext.route === 'gl' ? navContext : {};
  const paymentReturn = preset.paymentReturn?.route === 'ap' ? preset.paymentReturn : null;
  const bankTransactionReturn = preset.bankTransactionReturn?.route === 'banktx' ? preset.bankTransactionReturn : null;
  const reconciliationReturn = preset.reconciliationReturn?.route === 'bankrec' ? preset.reconciliationReturn : null;
  const registerReturn = preset.registerReturn?.route === 'register' ? preset.registerReturn : null;
  const coaReturn = preset.coaReturn?.route === 'coa' ? preset.coaReturn : null;
  const reportEntity = preset.entityId || entity || null;
  const presetTab = ['Trial Balance','GL Detail','Balance Sheet','Income Statement','Cash Flow'].includes(preset.tab) ? preset.tab : null;
  const toCodeList = (raw) => {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (!Array.isArray(raw.accounts) && !Array.isArray(raw.lines) && !Array.isArray(raw.codes)) return [];
    return (raw.codes || raw.accounts || raw.lines || []).map(r => r.account_code || r);
  };
  const initCodes = toCodeList(preset.drillAccounts || preset.drill || null);
  const [tab, setTab] = useState(presetTab || 'Trial Balance');
  const [fromP, setFromP] = useState('2026-01');
  const [toP, setToP] = useState('2026-07');
  const [propertyId, setPropertyId] = useState(String(preset.propertyId || 'ALL'));
  const [projectId, setProjectId] = useState(String(preset.projectId || 'ALL'));
  const [loanId, setLoanId] = useState(String(preset.loanId || 'ALL'));
  const [drill, setDrill] = useState(initCodes.length ? { accounts:initCodes, label:preset.drillLabel || 'Selected accounts', asOf:preset.asOf === true } : null);
  const [reportTool, setReportTool] = useState(null);
  const [savedScopes, setSavedScopes] = useState(() => {
    try { return normalizeLocalReportScopes(JSON.parse(localStorage.getItem('refs_local_report_scopes') || '[]')); }
    catch { return []; }
  });
  const postedBase = jes.filter(j=>j.posting_status==='POSTED' && (!reportEntity||j.entity_id===Number(reportEntity)) && j.period_code>=fromP && j.period_code<=toP);
  const posted = scopedPostedJournalEntries(postedBase, { propertyId, projectId, loanId, properties:PROPERTIES });
  const asOfBase = postedJournalEntriesAsOf(jes, { entityId:reportEntity, toPeriod:toP });
  const bsPosted = scopedPostedJournalEntries(asOfBase, { propertyId, projectId, loanId, properties:PROPERTIES });
  const reportAsOfDate = `${toP}-${String(new Date(Number(toP.slice(0,4)), Number(toP.slice(5)), 0).getDate()).padStart(2,'0')}`;
  const reportBankTransactions = Object.values(bank?.accounts || {}).flatMap(account => account.txns || []);
  const reportVendorCredits = localVendorCreditEvidence({bills:ap?.bills || [],journals:jes || [],bankTransactions:reportBankTransactions});
  const reportApAgingRows = localApAgingEvidenceRows(ap?.bills || [], jes || [], reportBankTransactions, reportAsOfDate, reportVendorCredits);
  const reportArAgingRows = localArAgingEvidenceRows(ar?.invoices || [], jes || [], reportBankTransactions, reportAsOfDate);
  const agingGlTbBridge = localAgingGlTbBridgeEvidence({apRows:reportApAgingRows,arRows:reportArAgingRows,journals:bsPosted,entityId:reportEntity,asOfDate:reportAsOfDate,propertyId,projectId});
  const reconciliationGlTbBridge = localReconciliationGlTbBridgeEvidence({bankAccounts:bank?.accounts || {},history:bank?.history || [],journals:jes || [],bankAccountMaster:BANK_ACCOUNTS,entityId:reportEntity,asOfDate:reportAsOfDate,propertyId,projectId});
  const openingBase = jes.filter(j=>j.posting_status==='POSTED' && (!reportEntity||j.entity_id===Number(reportEntity)) && j.period_code<fromP);
  const openingPosted = scopedPostedJournalEntries(openingBase, { propertyId, projectId, loanId, properties:PROPERTIES });
  const cashFlow = buildLocalCashFlow({ openingJournals:openingPosted, periodJournals:posted });
  const reportControls = localReportControlEvidence({ periodJournals:posted, asOfJournals:bsPosted, entityId:reportEntity, toPeriod:toP, cashFlow });
  const dimensionLabel = dimensionScopeLabel({ propertyId, projectId, loanId }, { properties:PROPERTIES, projects:PROJECTS, loans:LOANS });
  const dimensionEvidence = localDimensionScopeEvidence([...postedBase,...asOfBase], {entityId:reportEntity,propertyId,projectId,loanId}, PROPERTIES);
  const entityScopes = localReportScopeForEntity(savedScopes, reportEntity);
  const currentScope = createLocalReportScope({entityId:reportEntity, tab, fromP, toP, propertyId, projectId, loanId});
  const incomeScopeState = localReportScopeState({journals:jes,entityId:reportEntity,fromPeriod:fromP,toPeriod:toP});
  const saveScope = () => {
    if (!currentScope) { toast('Select one local entity and a valid period before saving a report scope.','bad'); return; }
    const next = saveLocalReportScope(savedScopes, currentScope);
    setSavedScopes(next);
    try { localStorage.setItem('refs_local_report_scopes', JSON.stringify(next)); } catch {}
    toast('Local report scope saved for the current entity only.');
  };
  const loadScope = key => {
    const scope = entityScopes.find(item => item.label === key);
    if (!scope) return;
    setTab(scope.tab); setFromP(scope.fromP); setToP(scope.toP);
    setPropertyId(scope.propertyId); setProjectId(scope.projectId); setLoanId(scope.loanId); setDrill(null);
    toast('Local entity-bound report scope loaded.');
  };

  useEffect(() => {
    if (!preset.route || preset.route !== 'gl') return;
    if (presetTab) setTab(presetTab);
    if (preset.fromP) setFromP(preset.fromP);
    if (preset.toP) setToP(preset.toP);
    if (preset.propertyId != null) setPropertyId(String(preset.propertyId));
    if (preset.projectId != null) setProjectId(String(preset.projectId));
    if (preset.loanId != null) setLoanId(String(preset.loanId));
    const codeList = toCodeList(preset.drillAccounts || preset.drill || null);
    if (codeList.length) setDrill({accounts: codeList, label: preset.drillLabel || preset.label || 'Selected accounts', asOf:preset.asOf === true});
  }, [preset.route, preset.tab, preset.fromP, preset.toP, preset.propertyId, preset.projectId, preset.loanId, preset.drill, preset.drillAccounts, preset.drillLabel, preset.label, preset.asOf]);
  useEffect(()=>{ if (preset.route!=='gl') setDrill(null); }, [preset.route]);
  useEffect(()=>{ if (drill) window.scrollTo({top:0,behavior:'auto'}); }, [drill]);

  const MONTHS=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
  const tb = trialBalance(posted);
  const st = statements(posted);
  const bsTb = trialBalance(bsPosted);
  const bsSt = statements(bsPosted);
  const tbAsOf = trialBalance(bsPosted);
  const ORDER=['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'];
  const CN={ASSET:'Assets',LIABILITY:'Liabilities',EQUITY:'Equity',REVENUE:'Revenue',EXPENSE:'Expenses'};
  const groups = ORDER.map(t=>({t, rows: tbAsOf.rows.filter(r=>r.type===t)})).filter(g=>g.rows.length);
  const openAccounts = (rows,label,options={}) => setDrill({accounts:localGLDrillAccountCodes(rows),label,...options});
  const openJournalFromReport = (jeNumber, options = {}) => ctx.goto('je',{jeNumber,reportReturn:localReportReturnContext({tab,fromP,toP,entityId:reportEntity,propertyId,projectId,loanId,cashScope:'ALL',drillAccounts:options.drillAccounts || null,drillLabel:options.drillLabel || '',asOf:options.asOf === true})});
  const registerTargetForReport = (row) => {
    const accountCode = String(row?.account_code || '');
    if (!accountCode || dimensionEvidence.state !== 'LOCAL_SCOPE_COMPLETE' || (!localCashAccountGroup(accountCode) && !['120200','291001'].includes(accountCode))) return null;
    return {route:'register', accountCode, fromPeriod:fromP, throughPeriod:toP, reportReturn:localReportReturnContext({tab,fromP,toP,entityId:reportEntity,propertyId,projectId,loanId,cashScope:localCashAccountGroup(accountCode) || 'CONTROL',drillAccounts:[accountCode],drillLabel:`${accountCode} ${row?.name || ''}`.trim()})};
  };
  const balanceSheetRegisterTarget = row => localBalanceSheetRegisterTarget({entityId:reportEntity,accountCode:row?.account_code,accountName:row?.name,fromP,toP,propertyId,projectId,loanId,dimensionState:dimensionEvidence.state});
  const sourceTargetFor = (journal, options = {}) => {
    const target = localGLSourceTarget(journal, { apBills: ap?.bills || [], arInvoices: ar?.invoices || [], bankAccounts: bank?.accounts || {}, sourceDocuments: SOURCE_DOCS });
    return target ? {...target,context:{...target.context,reportReturn:localReportReturnContext({tab,fromP,toP,entityId:reportEntity,propertyId,projectId,loanId,cashScope:'ALL',drillLabel:`${journal.je_number} source trace`,asOf:options.asOf === true})}} : null;
  };
  const drillLine = (label,accounts,value,options={}) => {
    const {key,isTotal=false,extraClass='',style={},registerTarget=null} = options;
    const rowLabel = `${label}`;
    const open = ()=>openAccounts(accounts,rowLabel,{asOf:options.asOf===true});
    return <div
      key={key ?? rowLabel}
      className={`stmt-row stmt-drill-row drill-target${isTotal?' tot':''} ${extraClass}`}
      style={style}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' ') { e.preventDefault(); open(); } }}
    >
      <span>{rowLabel}{registerTarget && <button type="button" className="source-drill" onClick={(e)=>{e.stopPropagation();ctx.goto('register',registerTarget);}} title="Open retained local account register">Open local register</button>}</span>
      <button type="button" className={`report-drill ${isTotal?'total':''}`} onClick={(e)=>{e.stopPropagation(); open();}}>
        <Money v={value} bold={isTotal}/>
        <span aria-hidden="true" className="drill-caret" />
      </button>
    </div>;
  };
  const secRows = [];
  groups.forEach(g=>{ secRows.push({_sec:g.t});
    g.rows.forEach(r=>secRows.push(r));
    secRows.push({_sub:g.t, debit:sum(g.rows,r=>r.debit), credit:sum(g.rows,r=>r.credit), balance:sum(g.rows,r=>r.balance)}); });
  const notify = msg => toast ? toast(msg) : undefined;
  const reportShell = <div className="qbo-report-builder">
    <div className="qbo-report-back"><button type="button" onClick={()=>paymentReturn ? ctx.goto('ap', paymentReturn) : bankTransactionReturn ? ctx.goto('banktx', bankTransactionReturn) : reconciliationReturn ? ctx.goto('bankrec', reconciliationReturn) : registerReturn ? ctx.goto('register', registerReturn) : coaReturn ? ctx.goto('coa', coaReturn) : ctx.goto('reports')}>{paymentReturn ? 'Back to Bill payments' : bankTransactionReturn ? 'Back to bank evidence' : reconciliationReturn ? 'Back to reconciliation' : registerReturn ? 'Back to Account Register' : coaReturn ? 'Back to Chart of Accounts' : 'Back to reports'}</button><span>{paymentReturn ? localPaymentReturnScopeLabel(paymentReturn) : bankTransactionReturn ? localBankTransactionJournalReturnScopeLabel(bankTransactionReturn) : reconciliationReturn ? localReconciliationJournalReturnScopeLabel(reconciliationReturn) : registerReturn ? localAccountRegisterReturnScopeLabel(registerReturn) : coaReturn ? `Retained COA scope · ${coaReturn.qboQuery || 'all accounts'}` : tab}</span></div>
    <div className="qbo-report-controls" aria-label="Report controls">
      <label><span>Report period</span><select value={`${fromP}|${toP}`} onChange={e=>{const [f,t]=e.target.value.split('|');setFromP(f);setToP(t);}}><option value="2026-01|2026-07">Year to date</option><option value="2026-07|2026-07">This month</option><option value="2026-04|2026-06">Last quarter</option></select></label>
      <label><span>From</span><select value={fromP} onChange={e=>setFromP(e.target.value)}>{MONTHS.map(m=><option key={m}>{m}</option>)}</select></label>
      <label><span>To</span><select value={toP} onChange={e=>setToP(e.target.value)}>{MONTHS.filter(m=>m>=fromP).map(m=><option key={m}>{m}</option>)}</select></label>
      <label><span>Property</span><select value={propertyId} onChange={e=>setPropertyId(e.target.value)}><option value="ALL">All properties</option>{PROPERTIES.filter(p=>!reportEntity||p.entity_id===Number(reportEntity)).map(p=><option key={p.property_id} value={p.property_id}>{p.property_code} · {p.property_name}</option>)}</select></label>
      <label><span>Project</span><select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="ALL">All projects</option>{PROJECTS.filter(p=>!reportEntity||p.entity_id===Number(reportEntity)).map(p=><option key={p.project_id} value={p.project_id}>{p.project_code} · {p.project_name}</option>)}</select></label>
      <label><span>Loan</span><select value={loanId} onChange={e=>setLoanId(e.target.value)}><option value="ALL">All loans</option>{LOANS.filter(l=>!reportEntity||l.entity_id===Number(reportEntity)).map(l=><option key={l.loan_id} value={l.loan_id}>{l.loan_code} · {l.lender_name}</option>)}</select></label>
      <label><span>Saved local scope</span><select aria-label="Saved local report scope" value="" onChange={e=>loadScope(e.target.value)}><option value="">Load a saved entity scope</option>{entityScopes.map(scope=><option key={scope.label} value={scope.label}>{scope.label}</option>)}</select></label>
      {tab !== 'Cash Flow' && <div className="qbo-segment" role="group" aria-label="Accounting method"><button type="button" className="on">Accrual</button><button type="button" onClick={()=>notify('Cash basis preview is not enabled for this dataset yet')}>Cash</button></div>}
      <label title="Comparison columns are not established for the retained local evidence set"><span>Display columns by</span><select value="Total" disabled><option>Total</option></select></label>
      <button type="button" onClick={()=>notify('Report refreshed')}>Refresh</button>
      <button type="button" disabled title="QBO-style report customization is outside the retained local evidence scope">Customize unavailable</button>
      {['Balance Sheet','Income Statement'].includes(tab) && <button type="button" disabled title="Period comparison is not established for the retained local evidence set">Compare to</button>}
      {['Balance Sheet','Income Statement','Cash Flow'].includes(tab) && <button type="button" disabled title="Automated narrative insights are outside the local reporting scope">Insights</button>}
      <button type="button" onClick={saveScope} disabled={!currentScope} title={currentScope?'Save only this entity/period/dimension scope locally':'An explicit entity and valid period are required'}>Save local scope</button>
      <button type="button" onClick={()=>notify('Compact density retained at 100%')}>Compact | 100%</button>
      <button type="button" disabled title="External report delivery is outside the local evidence scope">Email</button>
      <button type="button" disabled title="Printing is outside the local evidence scope">Print</button>
      <button type="button" disabled title="Business-data export is outside the local evidence scope">Export</button>
      <button type="button" disabled title="QBO-style report sharing, notes, and management actions are outside the retained local evidence scope">More unavailable</button>
      <button type="button" disabled title="Automated KPIs and narrative insights are outside the retained local evidence scope">Insights unavailable</button>
    </div>
    {reportTool && <div className="qbo-report-toolpanel">
      <div><b>{reportTool}</b><span>{reportTool==='Customize'?'Rows, columns, filters and presentation controls':reportTool==='More'?'Management actions for this report view':'Calculated signals from the current report result'}</span></div>
      {reportTool==='Customize' && <div className="qbo-toolgrid"><label><input type="checkbox" defaultChecked /> Show account numbers</label><label><input type="checkbox" defaultChecked /> Show non-zero rows</label><label><input type="checkbox" /> Compare another period</label><label><input type="checkbox" defaultChecked /> Keep drillable amounts</label></div>}
      {reportTool==='More' && <div className="qbo-toolgrid"><button type="button" onClick={()=>notify('Management report copy prepared')}>Copy</button><button type="button" onClick={()=>notify('Report note area opened')}>Add note</button><button type="button" onClick={()=>notify('Audit trail opened')}>Audit trail</button></div>}
      {reportTool==='Insights' && <div className="qbo-toolgrid qbo-insight-metrics"><span><i>Posted JEs</i><b>{posted.length}</b></span><span><i>Active accounts</i><b>{tb.rows.length}</b></span><span><i>Net income</i><b>{money(st.netIncome)}</b></span></div>}
    </div>}
  </div>;
  const periodBar = <div className="filter-bar accounting-filter-bar">
    <label><span className="filter-label">From</span><select aria-label="From period" value={fromP} onChange={e=>setFromP(e.target.value)}>{MONTHS.map(m=><option key={m}>{m}</option>)}</select></label>
    <label><span className="filter-label">To</span><select aria-label="To period" value={toP} onChange={e=>setToP(e.target.value)}>{MONTHS.filter(m=>m>=fromP).map(m=><option key={m}>{m}</option>)}</select></label>
    <span className="muted sm">Accrual basis · as of {toP} · {tbAsOf.rows.length} accounts with activity · {dimensionLabel}</span>
  </div>;
  // A drill replaces the report surface. It never appends a transaction table
  // below the statement, so the Back action has one unambiguous destination.
  return <div className={drill ? 'full-bleed report-replacement-view' : 'full-bleed'}>
    <h2 className="page-h">{drill ? 'General Ledger · Transaction detail' : 'General Ledger'}</h2>
    {!drill && <>
    {reportShell}
    <Tabs tabs={['Trial Balance','GL Detail','Balance Sheet','Income Statement','Cash Flow']} active={tab} onChange={t=>{setTab(t); setDrill(null);}} />
    {periodBar}
    <div className="gl-overview-strip">
      <span><i>View</i><b>{tab}</b></span>
      <span><i>Period</i><b>{fromP} ~ {toP}</b></span>
      <span><i>Posted JEs</i><b>{posted.length}</b></span>
      <span><i>Dimension scope</i><b>{dimensionLabel}</b></span>
      <span><i>Scope evidence</i><b><Badge tone={dimensionEvidence.state==='LOCAL_SCOPE_COMPLETE'?'ok':'warn'}>{dimensionEvidence.state}</Badge></b></span>
      <span><i>Assets</i><b>{money(st.assets)}</b></span>
      <span><i>Net income</i><b>{money(st.netIncome)}</b></span>
    </div>
    <section className="report-workbench" aria-label="Local report control evidence" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Local report control evidence</b><div className="page-subtitle">Same entity, cutoff, dimension scope, and POSTED JE set only.</div></div></div>
      <div className="qbo-drill-summary"><span><i>TB debit = credit</i><b><Badge tone={reportControls.tbBalanced?'ok':'bad'}>{reportControls.tbBalanced?'TIED':'DIFFERENCE'}</Badge></b></span><span><i>GL balances = TB</i><b><Badge tone={reportControls.glTbTied?'ok':'bad'}>{reportControls.glTbTied?'TIED':'DIFFERENCE'}</Badge></b></span><span><i>BS assets = L + E</i><b><Badge tone={reportControls.bsBalanced?'ok':'bad'}>{reportControls.bsBalanced?'TIED':'DIFFERENCE'}</Badge></b></span><span><i>Total cash / restricted</i><b>{money(reportControls.totalCash)} / {money(reportControls.restrictedCash)}</b></span><span><i>Available operating cash</i><b>{money(reportControls.operatingCash)}</b></span></div>
      <div className="qbo-toolgrid">{reportControls.cashGroups.filter(group=>group.accounts.length).map(group=><span key={group.group}><i>{group.group}</i><b>{money(group.amount)} · {group.accounts.join(', ')}</b></span>)}<span><i>Cash groups = BS cash</i><b><Badge tone={reportControls.cashGroupsTied?'ok':'bad'}>{reportControls.cashGroupsTied?'TIED':'DIFFERENCE'}</Badge></b></span><span><i>Operating cash = CF closing</i><b><Badge tone={reportControls.cashFlowOperatingTied?'ok':'bad'}>{reportControls.cashFlowOperatingTied?'TIED':'DIFFERENCE'}</Badge></b></span></div>
      <p className="muted sm" style={{margin:'8px 0 0'}}><Badge tone={dimensionEvidence.state==='LOCAL_SCOPE_COMPLETE'?'ok':'warn'}>{dimensionEvidence.state}</Badge> In scope {dimensionEvidence.totals.inScope} · missing dimension {dimensionEvidence.totals.missingDimension} · cross scope {dimensionEvidence.totals.crossScope} · entity mismatch {dimensionEvidence.totals.entityMismatch}. Out-of-scope lines are excluded from local statements and require retained assignment evidence; they are never silently consolidated.</p>
      <p className="muted sm" style={{margin:'10px 0 0'}}>Restricted, escrow/trust, security-deposit, payroll-restricted, and loan-draw availability are never assumed to be operating cash. A drill remains limited to retained POSTED JE and its supported local source route.</p>
    </section>
    <section className="report-workbench" aria-label="GL TB aging control bridge" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>GL / TB ↔ AP / AR control bridge</b><div className="page-subtitle">Same local entity, {reportAsOfDate} cutoff, property/project scope, and retained POSTED JE set.</div></div><Badge tone={agingGlTbBridge.state==='LOCAL_GL_TB_AGING_TIED'?'ok':'warn'}>{agingGlTbBridge.state}</Badge></div>
      <div className="qbo-drill-summary"><span><i>AR aging / GL 120200</i><b>{money(agingGlTbBridge.ar.reconciliation.detailTotal)} / {money(agingGlTbBridge.ar.reconciliation.postedControlTotal)}</b></span><span><i>AP aging / GL 291001</i><b>{money(agingGlTbBridge.ap.reconciliation.detailTotal)} / {money(agingGlTbBridge.ap.reconciliation.postedControlTotal)}</b></span><span><i>Scoped review rows</i><b>{agingGlTbBridge.issues.length}</b></span></div>
      {agingGlTbBridge.issues.length ? <Table rowKey="key" features={{exportable:false}} cols={[{h:'Report',render:r=><Badge tone="warn">{r.reportType}</Badge>},{h:'Category',render:r=><Badge tone="warn">{r.category}</Badge>},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},{h:'Reason',k:'reason'},{h:'JE',render:r=>r.journal?<Btn size="sm" variant="ghost" onClick={()=>openJournalFromReport(r.journal.je_number,{drillAccounts:[r.reportType==='AR'?'120200':'291001'],drillLabel:`${r.reportType} control review`})}>{r.journal.je_number}</Btn>:<span className="muted">No retained drill</span>}]} rows={agingGlTbBridge.issues} empty="No scoped local control difference evidence."/>:<p className="muted sm" style={{margin:'8px 0 0'}}>No retained AP/AR control exception in the selected scope. This is a local proof result, not a QBO equivalence claim.</p>}
      <p className="muted sm" style={{margin:'8px 0 0'}}>Unapplied credits, partial/cross-period activity, reversals, bank-date mismatches, deposits/trust/escrow/CWIP/prepaid misclassification, related-party and cross-entity conflicts remain review-only. No adjustment, posting, payment, or allocation is created here.</p>
    </section>
    <section className="report-workbench" aria-label="Bank reconcile GL TB evidence bridge" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Bank / Reconcile ↔ GL / TB evidence</b><div className="page-subtitle">Matched, cleared, and signed-off are independent retained facts; the report never infers one from another.</div></div><Badge tone={reconciliationGlTbBridge.state==='LOCAL_BANK_GL_TB_EVIDENCE_RETAINED'?'ok':'warn'}>{reconciliationGlTbBridge.state}</Badge></div>
      {reconciliationGlTbBridge.rows.length ? <Table rowKey="key" features={{exportable:false}} cols={[{h:'Bank account',k:'accountCode'},{h:'Bank date',render:r=>r.bankTransaction?.txn_date || '—'},{h:'Matched',render:r=><Badge tone={r.matched?'ok':'muted'}>{String(r.matched)}</Badge>},{h:'Cleared',render:r=><Badge tone={r.cleared?'ok':'muted'}>{String(r.cleared)}</Badge>},{h:'Signed off',render:r=><Badge tone={r.signedOff?'ok':'muted'}>{String(r.signedOff)}</Badge>},{h:'State',render:r=><Badge tone={r.state==='RETAINED_BANK_GL_EVIDENCE'?'ok':'warn'}>{r.state}</Badge>},{h:'JE',render:r=>r.journal?<Btn size="sm" variant="ghost" onClick={()=>openJournalFromReport(r.journal.je_number,{drillLabel:`${r.accountCode} bank evidence`})}>{r.journal.je_number}</Btn>:<span className="muted">No retained drill</span>},{h:'Reconcile',render:r=><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('bankrec',{route:'bankrec',acctCode:r.accountCode,bankTxnId:r.bankTransaction?.bank_txn_id,reportReturn:localReportReturnContext({tab,fromP,toP,entityId:reportEntity,propertyId,projectId,loanId,cashScope:r.accountCode,drillLabel:`${r.accountCode} bank evidence`})})}>Open local review</Btn>}]} rows={reconciliationGlTbBridge.rows}/>:<div className="empty-state">No retained matched bank evidence for this entity/date/dimension scope.</div>}
      <p className="muted sm" style={{margin:'8px 0 0'}}>Operating cash only can be retained as a same-scope bridge. Escrow/trust/restricted cash, loan draws, deposits, and unresolved bank items remain separate review boundaries; no feed import, auto-match, quick adjustment, or sign-off is performed here.</p>
    </section>
    {tab==='Trial Balance' && <>
      <div className="stmt-h">Trial Balance · As of {toP} <span className="muted sm">(same-entity, same-dimension, cumulative POSTED local evidence)</span></div>
      <div style={{textAlign:'right',marginBottom:8}}><Btn size="sm" disabled title="Business-data export is outside the local evidence scope">Export CSV</Btn></div>
      <div className="table-wrap table-journal-entries trial-balance-table">
      <table className="tbl stmt-tbl">
        <thead><tr><th>Account</th><th className="ta-r" style={{width:150}}>Debit</th><th className="ta-r" style={{width:150}}>Credit</th><th className="ta-r" style={{width:160}}>Balance</th></tr></thead>
        <tbody>{secRows.map((r,i)=> r._sec ?
          <tr key={i} className="sec-row"><td colSpan={4}>{CN[r._sec]}</td></tr>
          : r._sub ?
          <tr key={i} className="sub-row"><td>Total {CN[r._sub]}</td><td className="ta-r"><Money v={r.debit} bold/></td><td className="ta-r"><Money v={r.credit} bold/></td><td className="ta-r"><Money v={r.balance} bold/></td></tr>
          :
          <tr key={i} className="tr-click balance-row" onClick={()=>openAccounts([r],`${r.account_code} ${r.name}`,{asOf:true})}><td><span className="acct-code">{r.account_code}</span> {r.name}{registerTargetForReport(r) && <button type="button" className="source-drill" onClick={event=>{event.stopPropagation();ctx.goto('register',registerTargetForReport(r));}} title="Open retained local account register">Open local register</button>}</td><td className="ta-r"><Money v={r.debit}/></td><td className="ta-r"><Money v={r.credit}/></td><td className="ta-r"><Money v={r.balance}/></td></tr>)}
        </tbody>
        <tfoot><tr className="grand-row"><td>TOTAL</td><td className="ta-r"><Money v={tbAsOf.totalDebit} bold/></td><td className="ta-r"><Money v={tbAsOf.totalCredit} bold/></td>
          <td className="ta-r"><Badge tone={Math.abs(tbAsOf.totalDebit-tbAsOf.totalCredit)<0.01?'ok':'bad'}>{Math.abs(tbAsOf.totalDebit-tbAsOf.totalCredit)<0.01?'✓ Balanced':'✓ Out of balance'}</Badge></td></tr></tfoot>
      </table></div>
    </>}
    {tab==='Balance Sheet' && (()=>{ const rhs=bsSt.liabilities+bsSt.equity+bsSt.netIncome; const ok=Math.abs(bsSt.assets-rhs)<0.01;
      const sec=(t)=>bsTb.rows.filter(r=>r.type===t);
      const assetRows=sec('ASSET');
      const cashGroups=['Operating','Escrow','Restricted','Security deposit','Payroll restricted'].map(group=>({group,rows:assetRows.filter(row=>localCashAccountGroup(row.account_code)===group)})).filter(group=>group.rows.length);
      const nonCashAssetRows=assetRows.filter(row=>!localCashAccountGroup(row.account_code));
      const assetCategory=(row)=>row.account_code.startsWith('164') ? 'CWIP / development' : row.account_code.startsWith('161') ? 'Land and buildings' : row.account_code.startsWith('165') ? 'Prepaids' : 'Other assets';
      const nonCashGroups=['CWIP / development','Land and buildings','Prepaids','Other assets'].map(group=>({group,rows:nonCashAssetRows.filter(row=>assetCategory(row)===group)})).filter(group=>group.rows.length);
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Balance Sheet · As of {toP} <span className="muted sm">(cumulative posted local evidence · {dimensionLabel})</span></div>
        {!bsTb.rows.length ? <div className="empty">No posted local activity through {toP} for {dimensionLabel}.</div> : <>
        <div className="stmt-sec">Assets</div>
        {cashGroups.map(group=><div key={group.group}><div className="stmt-sec">{group.group} cash</div>{group.rows.map(r=>drillLine(`${r.account_code} ${r.name}`,[r],r.balance,{key:r.account_code,asOf:true,registerTarget:balanceSheetRegisterTarget(r)}))}{drillLine(`Total ${group.group} cash`,group.rows,sum(group.rows,row=>row.balance),{key:`cash-${group.group}`,isTotal:true,asOf:true})}</div>)}
        {nonCashGroups.map(group=><div key={group.group}><div className="stmt-sec">{group.group}</div>{group.rows.map(r=>drillLine(`${r.account_code} ${r.name}`,[r],r.balance,{key:r.account_code,asOf:true}))}</div>)}
        {drillLine('Total Assets',assetRows,bsSt.assets,{isTotal:true,asOf:true})}
        <div className="stmt-sec">Liabilities</div>
        {sec('LIABILITY').map(r=>drillLine(`${r.account_code} ${r.name}`,[r],-r.balance,{key:r.account_code,asOf:true}))}
        {drillLine('Total Liabilities',sec('LIABILITY'),bsSt.liabilities,{isTotal:true,asOf:true})}
        <div className="stmt-sec">Equity</div>
        {sec('EQUITY').map(r=>drillLine(`${r.account_code} ${r.name}`,[r],-r.balance,{key:r.account_code,asOf:true}))}
        {drillLine(`Cumulative earnings through ${toP}`,[...sec('REVENUE'),...sec('EXPENSE')],bsSt.netIncome,{extraClass:'',asOf:true})}
        {drillLine('Total Liabilities & Equity',[...sec('LIABILITY'),...sec('EQUITY'),...sec('REVENUE'),...sec('EXPENSE')],rhs,{isTotal:true,asOf:true})}
        <div className="stmt-row" style={{borderBottom:0}}><span>Check: Assets = L + E</span><Badge tone={ok?'ok':'bad'}>{ok?'✓ Balanced':'✓ Off by $'+Math.abs(bsSt.assets-rhs).toLocaleString()}</Badge></div>
        </>}
      </div>; })()}
    {tab==='Income Statement' && (()=>{ const rev=tb.rows.filter(r=>r.type==='REVENUE'); const exp=tb.rows.filter(r=>r.type==='EXPENSE');
      const sectionRows=(rows,section)=>rows.filter(row=>localIncomeStatementSection(row)===section);
      const rentalIncome=sectionRows(rev,'Rental income'), otherPropertyIncome=sectionRows(rev,'Other property income'), otherIncome=sectionRows(rev,'Other income · review');
      const cogs=sectionRows(exp,'Cost of goods sold'), propertyOps=sectionRows(exp,'Property operations'), interestExpense=sectionRows(exp,'Interest and financing'), capitalReview=sectionRows(exp,'Capital / completion review'), generalAdmin=sectionRows(exp,'General and administrative'), otherOpex=sectionRows(exp,'Other operating expense · review');
      const revT=sum(rev,r=>-r.balance), cogsT=sum(cogs,r=>r.balance), opexT=sum(exp.filter(r=>!cogs.includes(r)),r=>r.balance);
      const expenseGroups=[['Property operations',propertyOps],['Interest and financing',interestExpense],['Capital / completion review',capitalReview],['General and administrative',generalAdmin],['Other operating expense · review',otherOpex]].filter(([,rows])=>rows.length);
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Income Statement · {fromP} ~ {toP} <span className="muted sm">(same-entity, same-dimension POSTED accrual evidence)</span></div>
        {!rev.length && !exp.length ? <div className="empty-state"><b>{incomeScopeState.state === 'NO_LOCAL_EVIDENCE_IN_SCOPE' ? 'Select an entity before viewing Income Statement' : incomeScopeState.state === 'NO_POSTED_LOCAL_ACTIVITY' ? 'No POSTED local activity in this Income Statement scope' : 'No revenue or expense activity in this Income Statement scope'}</b><span>{incomeScopeState.detail}</span><small>Scope: {fromP} to {toP} · {dimensionLabel}. CWIP, prepaid, deposits, escrow and restricted cash are not substituted for P&L activity.</small></div> : <>
        {[["Rental income",rentalIncome],["Other property income",otherPropertyIncome],["Other income · review",otherIncome]].filter(([,rows])=>rows.length).map(([section,rows])=><div key={section}><div className="stmt-sec">{section}</div>{rows.map(r=>drillLine(`${r.account_code} ${r.name}`,[r],-r.balance,{key:r.account_code}))}</div>)}
        {drillLine('Total Income',rev,revT,{isTotal:true})}
        {cogs.length>0 && <><div className="stmt-sec">Cost of Goods Sold</div>
        {cogs.map(r=>drillLine(`${r.account_code} ${r.name}`,[r],r.balance,{key:r.account_code}))}
        {drillLine('Gross Profit',[...rev,...cogs],revT-cogsT,{isTotal:true})}</>}
        {expenseGroups.map(([section,rows])=><div key={section}><div className="stmt-sec">{section}</div>{rows.map(r=>drillLine(`${r.account_code} ${r.name}`,[r],r.balance,{key:r.account_code}))}</div>)}
        {drillLine('Total Expenses',opex,opexT,{isTotal:true})}
        {drillLine('Net Income',[...rev,...exp],revT-cogsT-opexT,{isTotal:true,extraClass:'',style:{fontSize:16}})}
        <p className="muted sm" style={{margin:'10px 0 0'}}>CWIP, land/building acquisition, prepaid balances, escrow/deposit and deferred/related-party balances are balance-sheet evidence, not current operating P&L. Capitalized versus expensed interest requires retained source and completion evidence; this presentation never adjusts or posts it.</p>
        </>}
      </div>; })()}
    {tab==='GL Detail' && (()=>{ const lines=[]; const openingByAccount=new Map(); openingPosted.forEach(j=>j.lines.forEach(l=>openingByAccount.set(l.account_code,(openingByAccount.get(l.account_code)||0)+(l.debit_amount||0)-(l.credit_amount||0)))); posted.forEach(j=>j.lines.forEach((l,lineIndex)=>{ const property=PROPERTIES.find(p=>p.property_id===l.property_id); const project=PROJECTS.find(p=>p.project_id===l.project_id || (property&&p.project_id===property.project_id)); const loan=LOANS.find(x=>x.loan_id===l.loan_id); lines.push({je:j.je_number, date:j.je_date, lineIndex, entity_id:j.entity_id, src:j.source_system, acct:l.account_code, name:acct(l.account_code).account_name, memo:l.description||j.description, member:l.member||'', dimensions:[property&&property.property_code,project&&project.project_code,loan&&loan.loan_code].filter(Boolean).join(' · ')||'—', dr:l.debit_amount||0, cr:l.credit_amount||0, sourceTarget:sourceTargetFor(j)}); })); const detailRows=localGLRunningBalanceRows(lines,openingByAccount);
      return <Table exportName={'gl-detail-'+fromP+'_'+toP} features={{exportable:false}} className="table-journal-entries" onRow={(r)=>openJournalFromReport(r.je,{drillAccounts:[r.acct],drillLabel:`${r.acct} ${r.name}`})} pageSize={30} cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},{h:'Entity',render:r=>'E'+r.entity_id},
        {h:'Source',render:r=>r.sourceTarget?<button type="button" className="source-drill" onClick={e=>{e.stopPropagation();ctx.goto(r.sourceTarget.route, r.sourceTarget.context);}} title={'Open '+r.src+' source workflow'}><Badge tone="muted">{r.src}</Badge></button>:<Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Account',render:r=><span><span className="acct-code">{r.acct}</span> {r.name}</span>,csv:r=>r.acct},
        {h:'Property / Project / Loan',k:'dimensions'},
        {h:'Memo / dimension member',render:r=><span>{r.memo}{r.member?<Badge tone="muted" >{r.member.slice(0,18)}</Badge>:null}</span>,csv:r=>r.memo},
        {h:'Debit',num:true,render:r=>r.dr?<Money v={r.dr}/>:'',sortVal:r=>r.dr,csv:r=>r.dr||''},
        {h:'Credit',num:true,render:r=>r.cr?<Money v={r.cr}/>:'',csv:r=>r.cr||''},
        {h:'Running balance',num:true,render:r=><Money v={r.runningBalance}/>,csv:r=>r.runningBalance},
      ]} rows={detailRows}/>; })()}
    {tab==='Cash Flow' && (()=>{ const openCategory=(category)=>{ const matches=cashFlow.entries.filter(entry=>entry.category===category); setDrill({accounts:cashFlow.cashAccounts,label:`Cash flow · ${category}`,journalNumbers:matches.map(entry=>entry.je)}); };
      const openCashScope = (scope) => { const group=reportControls.cashGroups.find(row=>row.group===scope); if (!group?.accounts.length) return; setDrill({accounts:group.accounts,label:`Cash scope · ${scope}`,asOf:true}); };
      const cashFlowRegisterTarget = scope => { const group=reportControls.cashGroups.find(row=>row.group===scope); return localCashFlowRegisterTarget({entityId:reportEntity,accountCodes:group?.accounts || [],scope,fromP,toP,propertyId,projectId,loanId,dimensionState:dimensionEvidence.state}); };
      const bsCash=sum(bsTb.rows.filter(row=>isOperatingCashAccount(row.account_code)),row=>row.balance);
      const totalBsCash=reportControls.totalCash;
      const ready=Math.abs(cashFlow.reconciliationDifference)<0.01 && !cashFlow.unclassified.length && Math.abs(cashFlow.closingCash-bsCash)<0.01;
      const totalScopeReady=Math.abs(cashFlow.totalClosingCash-totalBsCash)<0.01;
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Statement of Cash Flows · {fromP} ~ {toP} <span className="muted sm">(posted local cash evidence · {dimensionLabel})</span></div>
        {!cashFlow.entries.length ? <div className="empty">No posted local cash activity for {fromP} ~ {toP} in {dimensionLabel}.</div> : <>
        <div className="stmt-row"><span>Opening operating cash before {fromP}</span><Money v={cashFlow.openingCash}/></div>
        {['Operating','Investing','Financing'].map(category=><div key={category} className="stmt-row drill-target" role="button" tabIndex={0} onClick={()=>openCategory(category)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCategory(category);}}}><span>Cash from {category} Activities</span><button type="button" className="report-drill" onClick={e=>{e.stopPropagation();openCategory(category);}}><Money v={cashFlow[category.toLowerCase()]}/><span aria-hidden="true" className="drill-caret" /></button></div>)}
        {cashFlow.unclassified.length>0 && <div className="stmt-row"><span>Unclassified cash evidence — review required</span><Badge tone="bad">{cashFlow.unclassified.length} JE{cashFlow.unclassified.length===1?'':'s'}</Badge></div>}
        <div className="stmt-row tot"><span>Closing operating cash through {toP}</span><Money v={cashFlow.closingCash} bold/></div>
        <div className="stmt-sec">Cash scope reconciliation</div>
        {cashFlow.scopes.map(scope=>{ const canDrill=reportControls.cashGroups.some(row=>row.group===scope.scope && row.accounts.length); const registerTarget=cashFlowRegisterTarget(scope.scope); const open=()=>openCashScope(scope.scope); return <div key={scope.scope} className={'stmt-row'+(canDrill?' drill-target':'')} role={canDrill?'button':undefined} tabIndex={canDrill?0:undefined} onClick={canDrill?open:undefined} onKeyDown={canDrill?(e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}}):undefined}><span>{scope.scope} cash · opening / movement / closing{registerTarget&&<button type="button" className="source-drill" onClick={e=>{e.stopPropagation();ctx.goto('register',registerTarget);}} title="Open retained local account register">Open local register</button>}</span>{canDrill?<button type="button" className="report-drill" onClick={e=>{e.stopPropagation();open();}}><Money v={scope.openingCash}/> / <Money v={scope.movement}/> / <Money v={scope.closingCash}/><span aria-hidden="true" className="drill-caret" /></button>:<span><Money v={scope.openingCash}/> / <Money v={scope.movement}/> / <Money v={scope.closingCash}/></span>}</div>;})}
        <div className="stmt-row tot"><span>Total cash through {toP} · all retained scopes</span><Money v={cashFlow.totalClosingCash} bold/></div>
        <div className="stmt-row"><span>Cross-check: same-scope Balance Sheet operating cash</span><span><Money v={bsCash}/><Badge tone={ready?'ok':'bad'}>{ready?'Ready':'Review classification/scope'}</Badge></span></div>
        <div className="stmt-row"><span>Cross-check: same-scope Balance Sheet total cash</span><span><Money v={totalBsCash}/><Badge tone={totalScopeReady?'ok':'bad'}>{totalScopeReady?'TIED':'Review cash scope'}</Badge></span></div>
        </>}
      </div>; })()}
    </>}
    {drill && (()=>{ const accounts=drill.accounts||[drill]; const label=drill.label||accounts.join(', '); const scopeComplete=dimensionEvidence.state==='LOCAL_SCOPE_COMPLETE'; const registerTarget=accounts.length===1 ? registerTargetForReport({account_code:accounts[0],name:label}) : null; const agingTarget=scopeComplete && accounts.length===1 && ['120200','291001'].includes(accounts[0]) ? {route:accounts[0]==='120200'?'ar':'ap',tab:accounts[0]==='120200'?'AR Aging':'AP Aging',asOfDate:reportAsOfDate,reportReturn:localReportReturnContext({tab,fromP,toP,entityId:reportEntity,propertyId,projectId,loanId,cashScope:'CONTROL',drillAccounts:[accounts[0]],drillLabel:label})} : null; const drillJournals=(drill.asOf?bsPosted:posted).filter(j=>!drill.journalNumbers || drill.journalNumbers.includes(j.je_number)); const lines=[]; drillJournals.forEach(j=>j.lines.forEach(l=>{ if(accounts.includes(l.account_code)) lines.push({je:j.je_number, date:j.je_date, desc:j.description, src:j.source_system, account:l.account_code, dr:l.debit_amount, cr:l.credit_amount, sourceTarget:sourceTargetFor(j,{asOf:drill.asOf === true})}); }));
      const drillDebit=sum(lines,r=>r.dr||0), drillCredit=sum(lines,r=>r.cr||0);
      const drillState=localGLDrillState(lines,label,drill.asOf?'Opening':fromP,toP); const canCrossDrill=!drillState.isEmpty;
      return <div className="report-drill-panel qbo-transaction-report"><div className="qbo-report-back"><button type="button" onClick={()=>setDrill(null)}>Back to {tab}</button><span>Transaction detail</span></div><div className="gl-drill-head"><div><div className="gl-drill-crumb">General Ledger · Drilldown</div><h3>Transaction detail</h3><div className="gl-drill-account" title={label}>{label}</div></div><div className="gl-drill-actions"><span className="gl-drill-count"><b>{lines.length}</b> transactions</span>{registerTarget&&canCrossDrill?<Btn size="sm" variant="ghost" onClick={()=>ctx.goto('register',registerTarget)}>Open local register</Btn>:<Btn size="sm" variant="ghost" disabled title={canCrossDrill?(scopeComplete?'Only a single local cash or AR/AP control account can open Account Register':'Dimension scope requires review before any cross-workspace drill'):'No posted local activity exists in this scoped drill'}>No register scope</Btn>}{agingTarget&&canCrossDrill&&<Btn size="sm" variant="ghost" onClick={()=>ctx.goto(agingTarget.route,agingTarget)}>{agingTarget.route==='ar'?'Open AR Aging':'Open AP Aging'}</Btn>}<Btn size="sm" variant="ghost" onClick={()=>setDrill(null)}>Close</Btn></div></div>
      <div className="qbo-report-previewbar"><button type="button" onClick={()=>notify('Drill report refreshed')}>Refresh</button><button type="button" disabled title="QBO-style report customization is outside the retained local evidence scope">Customize unavailable</button><button type="button" disabled title="Business-data export is outside the local evidence scope">Export</button><button type="button" disabled title="Printing is outside the local evidence scope">Print</button><button type="button" onClick={()=>notify('Source trace controls opened')}>More actions</button></div>
      <div className="qbo-drill-summary"><span><i>Report period</i><b>{drill.asOf?`Opening ~ ${toP}`:`${fromP} ~ ${toP}`}</b></span><span><i>Dimension scope</i><b>{dimensionLabel}</b></span><span><i>Accounting method</i><b>Accrual</b></span><span><i>Total debit</i><b>{money(drillDebit)}</b></span><span><i>Total credit</i><b>{money(drillCredit)}</b></span></div>
      <div className="report-drill-hint">Select a journal entry to review its posting; open a source badge to continue into the originating workflow.</div>
      <Table exportName={'gl-drill-detail'} features={{exportable:false}} className="table-journal-entries" onRow={r=>openJournalFromReport(r.je,{drillAccounts:[r.account],drillLabel:label,asOf:drill.asOf === true})} empty={drillState.emptyLabel} cols={[{h:'JE',k:'je'},{h:'Date',k:'date'},{h:'Account',k:'account'},{h:'Description',k:'desc'},{h:'Source',render:r=>r.sourceTarget?<button type="button" className="source-drill" onClick={e=>{e.stopPropagation();ctx.goto(r.sourceTarget.route, r.sourceTarget.context);}} title={'Open '+r.src+' source workflow'}><Badge tone="muted">{r.src}</Badge></button>:<Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},{h:'Debit',num:true,render:r=><Money v={r.dr}/>,csv:r=>r.dr},{h:'Credit',num:true,render:r=><Money v={r.cr}/>,csv:r=>r.cr}]} rows={lines}/></div>; })()}
  </div>;
}

export function Reports({ctx}) {
  const {jes, exceptions, entity} = ctx;
  const [open, setOpen] = useState(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Standard reports');
  const [menuReport, setMenuReport] = useState(null);
  const [favorites, setFavorites] = useState(()=>{
    try { return new Set(JSON.parse(localStorage.getItem('refs_report_favorites') || '[]')); }
    catch { return new Set(); }
  });
  const [previewTool, setPreviewTool] = useState(null);
  const [managementView, setManagementView] = useState('Published');
  const [dashboardQuery, setDashboardQuery] = useState('');
  const RETAINED_REPORT_NAMES = new Set([
    'Trial Balance', 'General Ledger', 'Balance Sheet', 'Income Statement',
    'Profit and Loss', 'Cash Flow', 'AP Aging',
    'Accounts receivable aging summary', 'Reconciliation History',
  ]);
  const st = statements(jes, entity);
  const posted = jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity));
  const reportScope = localReportScopeState({journals:jes,entityId:entity,fromPeriod:'2026-01',toPeriod:'2026-07'});
  const openGLReport = (tab, options={}) => {
    ctx.goto('gl', localLedgerReportLaunchContext(tab, entity, options));
  };
  const launchReport = (name, route) => {
    const capability = localReportCapability(name);
    if (capability.state === 'REFERENCE_ONLY') { setOpen(name); return; }
    const workflowTarget = localReportWorkflowTarget(name);
    if (workflowTarget) return ctx.goto(workflowTarget.route, localReportWorkflowContext(workflowTarget, name));
    if (route==='gl' && glReportHints[name]) return openGLReport(glReportHints[name], { drillLabel:name });
    if (route) return ctx.goto(route);
    setOpen(prev=>prev===name ? null : name);
  };
  const glReportHints = {
    'Trial Balance':'Trial Balance',
    'General Ledger':'GL Detail',
    'Balance Sheet':'Balance Sheet',
    'Income Statement':'Income Statement',
    'Profit and Loss':'Income Statement',
    'Cash Flow':'Cash Flow',
    'Cost General Ledger':'GL Detail',
    'Cost GL Reconciliation':'GL Detail',
  };
  const REPORTS = {
    'Construction Loan Rollforward': () => { const rows = LOANS.map(l=>{ const draws=sum(LOAN_TXNS.filter(t=>t.loan_id===l.loan_id&&t.txn_type==='DRAW'),t=>t.amount); const rep=sum(LOAN_TXNS.filter(t=>t.loan_id===l.loan_id&&t.txn_type==='REPAYMENT'),t=>t.amount);
        return {loan:l.loan_code, lender:l.lender_name, begin:l.current_principal-draws+rep, draws, repayments:rep, end:l.current_principal, avail:l.commitment_amount-l.current_principal}; });
      return <Table exportName="loan-rollforward" cols={[{h:'璐锋',k:'loan'},{h:'Lender',k:'lender'},{h:'鏈熷垵鏈噾',num:true,render:r=><Money v={r.begin}/>,csv:r=>r.begin},{h:'+ Draws',num:true,render:r=><Money v={r.draws}/>,csv:r=>r.draws},{h:'鈭?Repayments',num:true,render:r=><Money v={r.repayments}/>,csv:r=>r.repayments},{h:'鏈熸湯鏈噾',num:true,render:r=><Money v={r.end}/>,csv:r=>r.end},{h:'鍓╀綑棰濆害',num:true,render:r=><Money v={r.avail}/>,csv:r=>r.avail}]} rows={rows}/>; },
    'Manual JE Report': () => <Table exportName="manual-je" cols={[{h:'JE',k:'je_number'},{h:'Date',k:'je_date'},{h:'Description',k:'description'},{h:'Amount',num:true,render:r=><Money v={jeTotals(r).dr}/>,csv:r=>jeTotals(r).dr},{h:'Created by',k:'created_by'},{h:'Attachment',render:r=>r.has_attachment?'Attached':'Missing',csv:r=>r.has_attachment?'Y':'N'},{h:'Status',render:r=><Badge>{r.posting_status}</Badge>,csv:r=>r.posting_status}]} rows={jes.filter(j=>j.je_type==='MANUAL')}/>,
    'Exception Aging': () => <Table exportName="exception-aging" cols={[{h:'Type',k:'exception_type'},{h:'Severity',render:r=><Badge>{r.severity}</Badge>,csv:r=>r.severity},{h:'Object',k:'object_ref'},{h:'Aging (days)',num:true,k:'aging_days'},{h:'Owner',k:'owner'},{h:'Status',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status}]} rows={[...exceptions].sort((a,b)=>b.aging_days-a.aging_days)}/>,
    'Data Sync Report': () => <Table cols={[{h:'Source',k:'s'},{h:'Batch',k:'b'},{h:'Records',k:'n'},{h:'Success rate',k:'r'},{h:'Status',render:r=><Badge tone={r.r==='100%'?'ok':'warn'}>{r.r==='100%'?'COMPLETED':'PARTIAL'}</Badge>}]} rows={[{s:'WBS_CL',b:'CL-20260731-007',n:4,r:'100%'},{s:'PM',b:'PM-202607-P0020',n:5,r:'80%'},{s:'BANK',b:'BANK-20260731',n:4,r:'100%'}]}/>,
    'Inventory Rollforward': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo'].includes(e.entity_type)).map(en=>{
        let inAdd=0, cogs=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>j.lines.forEach(l=>{
          if(l.account_code==='163000') inAdd+=(l.debit_amount||0)-(l.credit_amount||0);
          if(l.account_code==='510000') cogs+=(l.debit_amount||0);
        }));
        return {e:en.entity_code, name:en.entity_name, beg:0, xfer:inAdd+cogs, cogs:-cogs, end:inAdd};
      }).filter(r=>r.xfer||r.cogs);
      return <Table exportName="inventory-rollforward" cols={[
        {h:'Entity',render:r=><b>{r.e}</b>},{h:'Company',k:'name'},
        {h:'Beginning',num:true,render:r=><Money v={r.beg}/>},
        {h:'+ CWIP鈫扞nventory',num:true,render:r=><Money v={r.xfer}/>},
        {h:'鈭?COGS',num:true,render:r=><Money v={r.cogs}/>},
        {h:'Ending Inventory',num:true,render:r=><Money v={r.end} bold/>},
        ]} rows={rows} empty="No inventory rollforward rows match the current data."/>; },
    'Cost GL Reconciliation': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo','LandCo'].includes(e.entity_type)).slice(0,20).map(en=>{
        let glCost=0, srcCost=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>{
          j.lines.forEach(l=>{ if(['164100','164200','164400','164500','510000'].includes(l.account_code)) glCost+=(l.debit_amount||0)-(l.credit_amount||0); });
          if(['PAYABLE','CLOSING','WBS_CL'].includes(j.source_system)) j.lines.forEach(l=>{ if(['164100','164200','164400','164500','510000'].includes(l.account_code)) srcCost+=(l.debit_amount||0)-(l.credit_amount||0); });
        });
        return {e:en.entity_code, gl:glCost, src:srcCost, diff:+(glCost-srcCost).toFixed(2)};
      }).filter(r=>r.gl||r.src);
      return <Table exportName="cost-gl-recon" cols={[
        {h:'Entity',render:r=><b>{r.e}</b>},
        {h:'GL cost balance',num:true,render:r=><Money v={r.gl}/>},
        {h:'Source-system balance (PAYABLE/CLOSING/WBS_CL)',num:true,render:r=><Money v={r.src}/>},
        {h:'Difference',num:true,render:r=><Money v={r.diff} bold/>},
        {h:'Status',render:r=><Badge tone={Math.abs(r.diff)<0.01?'ok':'bad'}>{Math.abs(r.diff)<0.01?'Balanced':'Review'}</Badge>},
      ]} rows={rows}/>; },
    'CWIP Rollforward': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo','LandCo'].includes(e.entity_type)).map(en=>{
        let add=0, capint=0, rel=0, tout=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>j.lines.forEach(l=>{
          if(['164100','164200','164400'].includes(l.account_code)){ add+=(l.debit_amount||0); if(j.source_system==='CLOSING') rel+=(l.credit_amount||0); else if(j.rule_code==='R-UT-OUT-01') tout+=(l.credit_amount||0); else rel+= (j.source_system==='CLOSING'?0:0); }
          if(l.account_code==='164500') capint+=(l.debit_amount||0)-(l.credit_amount||0);
        }));
        const other = jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).reduce((s,j)=>s+j.lines.reduce((x,l)=>['164100','164200','164400'].includes(l.account_code)&&j.source_system!=='CLOSING'&&j.rule_code!=='R-UT-OUT-01'?x+(l.credit_amount||0):x,0),0);
        const end = add+capint-rel-tout-other;
        return {e:en.entity_code, name:en.entity_name, beg:0, add, capint, rel:-rel, tout:-tout, other:-other, end};
      }).filter(r=>r.add||r.end);
      const T=k=>sum(rows,r=>r[k]);
      return <Table exportName="cwip-rollforward" pageSize={30} cols={[
        {h:'Entity',render:r=><b>{r.e}</b>,csv:r=>r.e},{h:'Company',k:'name'},
        {h:'Beginning',num:true,render:r=><Money v={r.beg}/>,csv:r=>r.beg},
        {h:'+ Additions',num:true,render:r=><Money v={r.add}/>,csv:r=>r.add},
        {h:'+ Cap. Interest',num:true,render:r=><Money v={r.capint}/>,csv:r=>r.capint},
        {h:'鈭?COGS Relief',num:true,render:r=><Money v={r.rel}/>,csv:r=>r.rel},
        {h:'鈭?Transfer Out',num:true,render:r=><Money v={r.tout}/>,csv:r=>r.tout},
        {h:'鈭?Other',num:true,render:r=><Money v={r.other}/>,csv:r=>r.other},
        {h:'Ending CWIP',num:true,render:r=><Money v={r.end} bold/>,sortVal:r=>r.end,csv:r=>r.end},
      ]} rows={rows}/>; },
    'INTER COMPANY Balance Report': () => <Table exportName="ic-balance" cols={[{h:'IC pair',k:'ic_pair_id'},{h:'Initiator',k:'initiator_entity'},{h:'Counterparty',k:'counterparty_entity'},{h:'Due to/from amount',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'Match',render:r=><Badge tone={r.match_status==='MATCHED'?'ok':'bad'}>{r.match_status}</Badge>,csv:r=>r.match_status}]} rows={IC_TXNS}/>,
    'SREO Report': () => <Table exportName="sreo" cols={[{h:'Property',k:'p'},{h:'Entity',k:'e'},{h:'Loan',k:'l'},{h:'Lender',k:'ld'},{h:'Principal',num:true,render:r=><Money v={r.pr}/>,csv:r=>r.pr},{h:'Est. Value',num:true,render:r=><Money v={r.v}/>,csv:r=>r.v},{h:'Equity',num:true,render:r=><Money v={r.v-r.pr}/>,csv:r=>r.v-r.pr}]} rows={LOANS.map((l,i)=>({p:['Cedar Ridge','Maple Court','Palm Bay'][i%3], e:'E'+l.entity_id, l:l.loan_code, ld:l.lender_name, pr:l.current_principal, v:l.commitment_amount*1.4}))}/>,
    'Draw Request Report': () => <Table exportName="draw-requests" cols={[{h:'Draw',k:'wbs_txn_id'},{h:'Date',k:'transaction_date'},{h:'Type',render:r=><Badge tone="muted">{r.txn_type}</Badge>,csv:r=>r.txn_type},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'Status',render:()=> <Badge tone="ok">FUNDED</Badge>}]} rows={LOAN_TXNS.filter(t=>t.txn_type==='DRAW')}/>,
    'Payable Report': () => <Table exportName="payable-report" cols={[{h:'Bill',k:'bill_no'},{h:'Payee',k:'vendor_name'},{h:'Due date',k:'due_date'},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'Status',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status}]} rows={ctx.ap.bills}/>,
    'Property Operating Statement': () => { const rev=sum(PM_ROWS.filter(r=>r.kind==='REVENUE'),r=>r.amount); const exp=sum(PM_ROWS.filter(r=>r.kind==='EXPENSE'),r=>r.amount);
      return <div className="stmt"><div className="stmt-row"><span>杩愯惀鏀跺叆 (PM Pickup)</span><Money v={rev} bold/></div><div className="stmt-row"><span>杩愯惀璐圭敤</span><Money v={-exp}/></div><div className="stmt-row tot"><span>NOI</span><Money v={rev-exp} bold/></div></div>; },
  };
  const reports = [
    ['Trial Balance','GL','gl'],['Adjusted Trial Balance','GL',null],['General Ledger','GL','gl'],['Balance Sheet','GL','gl'],['Income Statement','GL','gl'],['Profit and Loss','GL','gl'],['Cash Flow','GL','gl'],
    ['Construction Loan Rollforward','Construction',null],['Manual JE Report','Management',null],['Exception Aging','Management',null],
    ['Data Sync Report','Management',null],['Property Operating Statement','Property',null],
    ['Budget vs Actual','Projects','cost'],['Cost to Complete','Projects','cost'],['AP Aging','Transactions','ap'],['Accounts receivable aging summary','Transactions','ar'],['Reconciliation History','Transactions','bankrec'],
    ['CWIP Rollforward','Real Estate',null],['Inventory Rollforward','Real Estate',null],['Cost GL Reconciliation','Real Estate',null],
    ['INTER COMPANY Balance Report','WBS',null],['SREO Report','WBS',null],['Draw Request Report','WBS',null],['Payable Report','WBS',null],
    ['Cost General Ledger','WBS','gl'],['Unit CWIP and EM Report','WBS','cost'],['Budget and Execution Report','WBS','cost'],['Project Cost Reconciliation','WBS','cost'],
  ];
  const featuredReports = [
    {name:'Trial Balance', caption:'Control totals with account drillback', route:'gl', badge:'Quick drill'},
    {name:'Balance Sheet', caption:'As-of position with account drillback', route:'gl', badge:'Quick drill'},
    {name:'Profit and Loss', caption:'Local P&L drill into ledger and source workflow', route:'gl', badge:'Quick drill'},
    {name:'Cash Flow', caption:'Posted cash movement with scope cross-checks', route:'gl', badge:'Quick drill'},
  ];
  const reportRows = reports.filter(([name])=>RETAINED_REPORT_NAMES.has(name)).map(([name, category, route])=>({
    name,
    category,
    route,
    capability:localReportCapability(name),
    evidenceState: localReportCapability(name).state==='REFERENCE_ONLY' ? 'REFERENCE_ONLY' : localReportCapability(name).state==='LOCAL_PREVIEW' ? 'REVIEW_REQUIRED' : posted.length ? 'AVAILABLE_LOCAL_EVIDENCE' : 'NO_LOCAL_EVIDENCE',
    experience: localReportCapability(name).state==='LOCAL_LEDGER' ? 'Linked statement' : localReportCapability(name).state==='LOCAL_WORKFLOW' ? 'Operational workspace' : localReportCapability(name).state==='LOCAL_PREVIEW' ? 'Local preview' : 'QBO reference only',
    drillPath: localReportCapability(name).state==='LOCAL_LEDGER' ? 'Report -> account detail -> JE -> source queue' : localReportCapability(name).state==='LOCAL_WORKFLOW' ? 'Report hub -> source workspace' : localReportCapability(name).state==='LOCAL_PREVIEW' ? 'Preview only; no source drill' : 'No local workflow target',
  }));
  const reportNames = reportRows.filter(report=>report.capability.state!=='REFERENCE_ONLY').map(report=>report.name);
  useEffect(()=>{
    const normalized = normalizeReportFavorites([...favorites], reportNames);
    try { localStorage.setItem('refs_report_favorites', JSON.stringify([...normalized])); } catch {}
  }, [favorites, reportNames.join('|')]);
  const toggleFavorite = reportName => setFavorites(current=>toggledReportFavorites(current, reportName, reportNames));
  const shortcutNames = new Set(['Balance Sheet','Income Statement','Profit and Loss','Trial Balance','General Ledger','Cash Flow','AP Aging','Accounts receivable aging summary','Reconciliation History']);
  const visibleRows = reportRows.filter(r=>((category==='Standard reports' && shortcutNames.has(r.name)) || (category==='All reports') || (category==='Favorites' && favorites.has(r.name)) || r.category===category) && (!search || `${r.name} ${r.category} ${r.drillPath}`.toLowerCase().includes(search.toLowerCase())));
  const previewMeta = open ? reportRows.find(r=>r.name===open) : null;
  if (open) return <div className="reports-library report-replacement-view">
    <div className="qbo-report-back"><button type="button" onClick={()=>{setOpen(null);setPreviewTool(null);setMenuReport(null)}}>Back to Reports Center</button><span>{previewMeta?.capability.state==='LOCAL_PREVIEW'?'Local report detail':'Reference-only report'}</span></div>
    <div className="report-preview-head"><div className="report-preview-titlewrap"><div className="report-preview-crumb">Reports Center · {previewMeta?.capability.state==='LOCAL_PREVIEW'?'Local evidence':'Observed reference'}</div><SectionTitle>{open}</SectionTitle><p className="page-subtitle">{previewMeta?.capability.state==='LOCAL_PREVIEW'?'This replaces the report list. It uses retained local evidence only; use Back to return to the same Reports Center.':'This replaces the report list with an explicit unavailable state. It does not expose source data, a connector, or a local workflow.'}</p></div>{previewMeta && <div className="report-preview-meta"><span><i>Category</i><b>{previewMeta.category}</b></span><span><i>Capability</i><b>{previewMeta.capability.label}</b></span><span><i>Evidence</i><b><Badge tone={previewMeta.evidenceState==='AVAILABLE_LOCAL_EVIDENCE'?'ok':previewMeta.evidenceState==='REVIEW_REQUIRED'?'warn':'muted'}>{previewMeta.evidenceState}</Badge></b></span></div>}</div>
    <div className="qbo-report-previewbar"><button type="button" disabled={previewMeta?.capability.state!=='LOCAL_PREVIEW'} onClick={()=>ctx.toast('Local report view refreshed')}>Refresh</button><button type="button" className={previewTool==='Scope'?'on':''} onClick={()=>setPreviewTool(t=>t==='Scope'?null:'Scope')}>Evidence scope</button><button type="button" disabled title="Custom report creation is outside the local evidence scope">Save As</button><button type="button" disabled title="Printing is outside the local evidence scope">Print</button><button type="button" disabled title="Business-data export is outside the local evidence scope">Export</button></div>
    {previewTool==='Scope' && <div className="qbo-report-toolpanel qbo-preview-toolpanel"><div><b>Local evidence scope</b><span>Entity, period, dimension, account/control account and retained local source evidence are passed only by the destination workflow.</span></div><div className="qbo-toolgrid"><span><i>Authority</i><b>Local POSTED evidence</b></span><span><i>External delivery</i><b>Unavailable</b></span><span><i>QBO equivalence</i><b>Not claimed</b></span></div></div>}
    {previewMeta?.capability.state==='LOCAL_PREVIEW' && REPORTS[open]
      ? REPORTS[open]()
      : <div className="empty-state"><b>Reference only — no local workflow</b><span>This observed QuickBooks report surface is not part of the real-estate close scope. REFS does not connect, synchronize, create, save, share, email, print, export, or expose its source data here.</span><small>Use Back to return to the Reports Center.</small></div>}
  </div>;
  return <div className="reports-library">
    <div className="accounting-page-head reports-head">
      <div>
        <div className="page-eyebrow">FINANCIAL INTELLIGENCE · CONTROLLED REPORTING</div>
        <h2 className="page-h">Reports Center</h2>
        <div className="reports-clean-title">Reports Center</div>
        <div className="page-subtitle">Local financial statements, aging, and reconciliation evidence with scoped drill-down context.</div>
      </div>
      <div className="report-period-chip"><span>Reporting basis</span><b>Accrual · FY2026</b><small>{entity ? 'Entity ' + entity : 'Entity required'}</small></div>
    </div>
    <nav aria-label="Observed QuickBooks Reports navigation" className="report-shelf" style={{marginBottom:12}}>
      {['Financial statements','Aging & reconciliation'].map(item=><span className="report-shelf-chip" key={item}>{item}</span>)}
    </nav>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QuickBooks Reports navigation shell. The local workspaces below remain separately scoped and are not a claim of destination-level equivalence.</p>
    <section className="report-workbench" aria-label="Local reports scope and evidence state" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Local reports scope</b><div className="page-subtitle">Entity {entity || 'required'} · 2026-01 to 2026-07 · accrual · retained local POSTED evidence only.</div></div><Badge tone={reportScope.state==='POSTED_LOCAL_EVIDENCE_AVAILABLE'?'ok':'warn'}>{reportScope.state}</Badge></div>
      <div className="qbo-toolgrid"><span><i>Posted local journals</i><b>{reportScope.postedCount}</b></span><span><i>Cash scope</i><b>Operating / Restricted / Escrow / Trust / Loan draw separated</b></span><span><i>Dimension boundary</i><b>{reportScope.missingDimensions || 0} review-required</b></span></div>
      <p className="muted sm" style={{margin:'10px 0 0'}}>{reportScope.detail}</p>
    </section>
    <section className="report-workbench" aria-label="REFS business-fit reporting scope" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Business-fit reporting scope</b><div className="page-subtitle">Use QuickBooks as a reference, but keep REFS focused on the local bookkeeping close.</div></div></div>
      <div className="qbo-toolgrid"><div><b>Included</b>{REPORT_BUSINESS_SCOPE.included.map(item=><div key={item} className="muted sm">{item}</div>)}</div><div><b>Reference-only or excluded</b>{REPORT_BUSINESS_SCOPE.excluded.map(item=><div key={item} className="muted sm">{item}</div>)}</div></div>
      <p className="muted sm" style={{margin:'10px 0 0'}}>QBO navigation is evidence only. REFS does not build or connect external sales channels, apps, spreadsheet sync, bulk sync, or multi-company reporting unless this business later requires them.</p>
    </section>
    <div className="report-shelf"><span className="report-shelf-chip report-shelf-chip-on">Local control reports</span><span className="report-shelf-chip">Construction & WBS</span><span className="report-shelf-chip">Control reports</span><span className="report-shelf-chip">Drill to ledger</span><span className="report-shelf-spacer" /><span className="report-shelf-note">Posted-evidence cadence · source-linked</span></div>
    <div className="qbo-report-centerbar">
      <label className="qbo-report-search"><span aria-hidden="true" /><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Type report name here" /></label>
      <button type="button" disabled title="Custom report creation is not adopted for the local close workflow">Create new report</button>
      <button type="button" className="qbo-icon-btn" disabled title="Custom report creation is not adopted for the local close workflow">+</button>
    </div>
    {false && <><section className="qbo-report-promo" aria-label="Observed QuickBooks smart reporting tip">
      <span>YOUR SMART TIP: SMART REPORTING</span><b>Keep a pulse on your key metrics with smart reporting and customizable dashboards in Advanced.</b>
      <p>Performance center: view and create custom charts to track your business performance.</p>
      <div className="row-acts"><button type="button" disabled>Check out smart reporting</button><button type="button" disabled>View dashboard</button></div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed Standard reports tip and Performance center shortcut. Their destination, plan eligibility, chart configuration, and dashboard behavior are not verified in REFS.</p>
    <section className="report-shelf" aria-label="Observed QuickBooks Standard reports favorites" style={{marginBottom:12}}>
      <b>Favorites</b>
      {['Accounts receivable aging summary','Balance Sheet','Profit and Loss'].map(name=><span className="report-shelf-chip" key={name}>{name} <button type="button" aria-label={`Favorite ${name}`} aria-pressed="true" disabled>★</button><button type="button" aria-label={`More options for ${name}`} disabled>More Options</button></span>)}
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>These QBO favorite states and More Options controls are visual evidence only; REFS does not infer their persistence or actions.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks Management reports shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Management reports</b><div className="page-subtitle">Observed Published list shell and its empty state.</div></div><div className="row-acts"><Btn size="sm" variant="ghost" disabled>Switch to legacy management reports</Btn><Btn size="sm" variant="ghost" disabled>+ Create report</Btn></div></div>
      <div className="report-shelf"><button type="button" className={`report-shelf-chip ${managementView==='Drafts'?'report-shelf-chip-on':''}`} onClick={()=>setManagementView('Drafts')}>Drafts</button><button type="button" className={`report-shelf-chip ${managementView==='Published'?'report-shelf-chip-on':''}`} onClick={()=>setManagementView('Published')}>Published</button><span className="report-shelf-spacer" /><Btn size="sm" variant="ghost" disabled>Filters</Btn><Btn size="sm" variant="ghost" disabled>Search</Btn></div>
      <div className="qbo-drill-summary">{(managementView==='Published'?['Name','Published by','Published on','Reporting period','Actions']:['Name','Created by','Last modified','Reporting period','Scheduled','Actions']).map(label=><span key={label}><i>{label}</i><b>{label==='Actions'?'Column':'Resizable column'}</b></span>)}</div>
      {managementView==='Published'?<div className="empty-state"><b>No management reports yet</b><span>After you create a report, you'll see it here.</span><small>0 - 0 of 0 items · Page 1 of 1</small></div>:<div className="empty-state"><span>Observed Drafts view exposed blank table placeholders only.</span><small>0 - 0 of 0 items · Page 1 of 1</small></div>}
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Management-report mode, legacy switch, create flow, filters, search, tabs, records, actions, resizing, and pagination behavior remain unverified in REFS.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks Custom reports list shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Custom reports</b><div className="page-subtitle">Observed QBO custom-report list; report actions are intentionally unavailable.</div></div><Btn size="sm" variant="ghost" disabled>Create new report</Btn></div>
      <div className="qbo-drill-summary">{['Report name','Created by','Last Modified By','Date range','Access','Email','Action'].map(label=><span key={label}><i>{label}</i><b>Observed column</b></span>)}</div>
      <div className="qbo-toolgrid">{['Transaction Drilldown Report','Transaction Report','Transaction Report'].map((name,index)=><div key={`${name}-${index}`} className="qbo-drill-summary"><span><b>{name}</b><i>BIN WAN</i></span><span><b>{index===0?'Customized':'Shared'}</b><i>Observed access/status text</i></span><span><button type="button" disabled>Edit</button><button type="button" disabled>Expand Menu</button></span></div>)}</div>
      <div className="report-shelf"><button type="button" disabled>First</button><button type="button" disabled>Previous</button><span className="report-shelf-chip">1 - 3</span><button type="button" disabled>Next</button><button type="button" disabled>Last</button></div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Custom-report dates, email values, access semantics, report contents, Edit, menus, creation, pagination behavior, permissions, and audit are unverified in REFS.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks Transaction Drilldown Report shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Transaction Drilldown Report</b><div className="page-subtitle">Read-only observed report-detail shell.</div></div><Btn size="sm" variant="ghost" disabled>Back to reports</Btn></div>
      <div className="report-shelf"><span className="report-shelf-chip">Report period: Custom dates</span><span className="report-shelf-chip">From date</span><span className="report-shelf-chip">To date</span><Btn size="sm" variant="ghost" disabled>From Calendar</Btn><Btn size="sm" variant="ghost" disabled>To Calendar</Btn><Btn size="sm" variant="ghost" disabled>Customize</Btn><Btn size="sm" variant="ghost" disabled>Save</Btn><Btn size="sm" variant="ghost" disabled>Pivot</Btn><Btn size="sm" variant="ghost" disabled>Chart</Btn><Btn size="sm" variant="ghost" disabled>Compact | 100%</Btn><Btn size="sm" variant="ghost" disabled>Refresh</Btn><Btn size="sm" variant="ghost" disabled>Email</Btn><Btn size="sm" variant="ghost" disabled>Print</Btn><Btn size="sm" variant="ghost" disabled>Export</Btn><Btn size="sm" variant="ghost" disabled>More actions</Btn><Btn size="sm" variant="ghost" disabled>Company name</Btn><Btn size="sm" variant="ghost" disabled>Enter report name</Btn><Btn size="sm" variant="ghost" disabled>Add note</Btn></div>
      <div className="qbo-drill-summary">{['Transaction date','Transaction type','Num','Name','Description','Account full name','Item split account','Amount','Balance'].map(label=><span key={label}><i>{label}</i><b>Sortable column</b></span>)}</div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Report period, date controls, customize, save, Pivot, Chart, compact mode, sorting, rows, drill paths, permissions, audit, and responsive behavior remain unverified in REFS.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks KPIs shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>KPI Scorecard</b><div className="page-subtitle">Observed KPI list and control shell.</div></div><div className="row-acts"><Btn size="sm" variant="ghost" disabled>Create KPI</Btn><Btn size="sm" variant="ghost" disabled>Manage scorecard</Btn><Btn size="sm" variant="ghost" disabled>Filters</Btn><Btn size="sm" variant="ghost" disabled>Search</Btn><Btn size="sm" variant="ghost" disabled>Refresh</Btn><Btn size="sm" variant="ghost" disabled>Export</Btn><Btn size="sm" variant="ghost" disabled>Customize</Btn></div></div>
      <div className="qbo-drill-summary">{['KPI name','Last month','Previous period','Variance','Variance %','Action'].map(label=><span key={label}><i>{label}</i><b>Observed column</b></span>)}</div>
      <div className="qbo-toolgrid">{[['Finance - Growth',['Revenue','Cost of Goods Sold','Number of Invoices','Value of Invoices','Total Expenses','Other Expense']],['Finance - Profitability',['Gross Profit','Gross Profit Margin','Net Profit','Net Profit Margin','Operating Expenses','Operating Expense Ratio','Expense as % of Revenue','Total Revenue','Net Operating Income','Operating Margin']],['Finance - Cash Flow',['Operating Cash Flow','Cash Flow Margin']]].map(([group,labels])=><div key={group}><b className="muted sm">{group}</b>{labels.map(label=><div key={label} className="qbo-drill-summary"><span><b>{label}</b><i>Observed KPI row</i></span><span><button type="button" disabled>View</button><button type="button" disabled>Expand Menu</button></span></div>)}</div>)}</div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Only finance KPI labels are retained as reference. Sales-growth KPI content is intentionally excluded; definitions, values, grouping, filters, search, refresh, export, customization, View destinations, permissions, audit, empty states, and responsive behavior remain unverified in REFS.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks Dashboards library" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Dashboards</b><div className="page-subtitle">Observed dashboard library shell.</div></div><Btn size="sm" variant="ghost" disabled>Create dashboard</Btn></div>
      <label className="qbo-report-search"><span className="filter-label">Search by dashboard name</span><input aria-label="Search by dashboard name" value={dashboardQuery} onChange={e=>setDashboardQuery(e.target.value)} placeholder="Search by dashboard name" /></label>
      {(() => { const all=['Profitability','Cash flow','Balance Sheet','Accounts Receivable','Accounts Payable','Revenue']; const shown=all.filter(name=>name.toLowerCase().includes(dashboardQuery.toLowerCase())); return <><div className="report-shelf"><b>Favorites</b>{shown.filter(name=>['Profitability','Cash flow','Balance Sheet'].includes(name)).map(name=><span className="report-shelf-chip" key={name}>{name}<small>Standard</small></span>)}</div><div className="report-shelf"><b>All dashboards</b>{shown.map(name=><span className="report-shelf-chip" key={name}>{name}<small>Standard</small></span>)}</div></>; })()}
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>The local dashboard-name search is functional. Sales-performance dashboards and any data-source connection are deliberately out of scope. QBO dashboard thumbnails, favorites, card menus, creation, card destinations, permissions, audit, empty states, and responsive behavior remain unverified in REFS.</p>
    <section className="report-workbench" aria-label="Observed QuickBooks Performance center shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Performance center</b><div className="page-subtitle">Observed dashboard layout, aging cards, time cards, and permission-denied states.</div></div><Btn size="sm" variant="ghost" disabled>Customize Layout</Btn></div>
      <div className="qbo-toolgrid">{[['ACCOUNTS RECEIVABLE BY AGING PERIODS','Total A/R amount'],['ACCOUNTS PAYABLE BY AGING PERIODS','Total A/P amount']].map(([title,total])=><div key={title} className="qbo-drill-summary"><span><b>{title}</b><i>As of today · {total}</i></span><span><i>Current · 1–7 days · 8–14 days · 15–21 days · 22–28 days · 29 days–2 months · 2–6 months · &gt;6 months</i></span></div>)}</div>
      <div className="qbo-toolgrid">{['EXPENSES BY TIME','REVENUE BY TIME'].map(title=><div key={title} className="qbo-drill-summary"><span><b>{title}</b><i>Period: This year to date</i></span><span><i>{title==='EXPENSES BY TIME'?'Total expenses':'Total revenue'}</i></span></div>)}</div>
      <div className="qbo-toolgrid">{['GROSS PROFIT BY TIME','NET PROFIT BY TIME','CASH FLOW','CURRENT RATIO BY TIME','QUICK RATIO BY TIME','NPM VS INDUSTRY BENCHMARKS','GPM VS INDUSTRY BENCHMARKS'].map(title=><div key={title} className="empty-state"><b>{title}</b><span>We're sorry! You don't have access rights to view this data.</span></div>)}</div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Layout customization, aging values, period options, chart data, access evaluation, permissions, audit, empty states, and responsive behavior remain unverified in REFS.</p>
    <section className="qbo-report-promo" aria-label="Observed QuickBooks Cash flow planner introduction">
      <span>FINANCIAL PLANNING · CASH FLOW PLANNER</span><b>Become a cash flow pro</b>
      <p>Keep track of your money and know what's coming in and going out so you can make smarter choices.</p>
      <div className="qbo-toolgrid"><span><b>Get a real-time view of your cash flow.</b></span><span><b>Plan future cash inflow and outflow from past trends and patterns.</b></span><span><b>Play with different outcomes without touching your books.</b></span></div>
      <div className="row-acts"><button type="button" disabled>See how it works</button><button type="button" disabled>Start planning</button></div>
    </section>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Cash-flow calculation, historical-trend modelling, scenario inputs, planner setup, preview, permissions, audit, and responsive behavior remain unverified in REFS.</p></>}
    <div className="report-shelf qbo-report-tabs"><button type="button" className={`report-shelf-chip ${category==='Standard reports'?'report-shelf-chip-on':''}`} onClick={()=>setCategory('Standard reports')}>Core financial reports</button><button type="button" className={`report-shelf-chip ${category==='Favorites'?'report-shelf-chip-on':''}`} onClick={()=>setCategory('Favorites')}>Favorites</button><button type="button" className={`report-shelf-chip ${category==='All reports'?'report-shelf-chip-on':''}`} onClick={()=>setCategory('All reports')}>All retained reports</button><span className="report-shelf-spacer" /><span className="report-shelf-note">POSTED local evidence · scoped drill and return</span></div>
    <div className="qbo-report-promo"><span>FOR YOU</span><b>Financial summary for June is ready</b><p>Review key local balance, income, and control signals before opening the report.</p><button type="button" onClick={()=>launchReport('Balance Sheet','gl')}>Review Summary</button></div>
    <div className="kpi-row">
      <KPI label="Total assets" value={money(st.assets)} />
      <KPI label="Current period revenue" value={money(st.revenue)} tone="ok" />
      <KPI label="Net income" value={money(st.netIncome)} tone={st.netIncome>=0?'ok':'bad'} />
      <KPI label="Posted JEs" value={posted.length} />
    </div>
    <SectionTitle>Local report shortcuts · open retained evidence</SectionTitle>
    <div className="rep-grid rep-grid-featured">{featuredReports.map(r=>
      <Card key={r.name} hover className={`rep-card rep-card-featured ${open===r.name?'rep-on':''}`} onClick={()=>launchReport(r.name, r.route)}>
        <div className="rep-main">
          <div className="rep-name">{r.name}</div>
          <div className="rep-desc">{r.caption}</div>
        </div>
        <div className="rep-tag">
          <Badge tone="muted">{r.badge}</Badge>
          <span className="rep-arrow" aria-hidden="true" />
        </div>
      </Card>)}</div>
    <SectionTitle>Retained report workbench</SectionTitle>
    <div className="report-workbench">
      <div className="report-workbench-head"><div><div className="report-preview-crumb">Reports Center · Workbench</div><div className="page-subtitle">Browse retained financial statements, aging, and reconciliation evidence with a consistent drill path.</div></div><div className="report-preview-meta"><span><i>Reports</i><b>{reportRows.length}</b></span><span><i>Linked statements</i><b>{reportRows.filter(r=>r.route==='gl').length}</b></span><span><i>Preview-only</i><b>{reportRows.filter(r=>!r.route).length}</b></span></div></div>
      <Table exportName="reports-workbench" features={{exportable:false}} className="table-journal-entries reports-workbench-table" onRow={r=>r.capability.state==='REFERENCE_ONLY' ? undefined : launchReport(r.name, r.route)} pageSize={12} cols={[
        {h:'Report',render:r=><span className="rep-table-name">{r.name}</span>,csv:r=>r.name},
        {h:'Category',render:r=><Badge tone="muted">{r.category}</Badge>,csv:r=>r.category},
        {h:'Experience',k:'experience'},
        {h:'Capability',render:r=><Badge tone={r.capability.state==='REFERENCE_ONLY'?'muted':r.capability.state==='LOCAL_PREVIEW'?'warn':'ok'}>{r.capability.label}</Badge>,csv:r=>r.capability.state},
        {h:'Evidence',render:r=><Badge tone={r.evidenceState==='AVAILABLE_LOCAL_EVIDENCE'?'ok':r.evidenceState==='REVIEW_REQUIRED'?'warn':'muted'}>{r.evidenceState}</Badge>,csv:r=>r.evidenceState},
        {h:'Drill path',k:'drillPath'},
        {h:'Favorite',render:r=>r.capability.state==='REFERENCE_ONLY'?<span className="muted sm">Unavailable</span>:<button type="button" className={'qbo-star-btn '+(favorites.has(r.name)?'is-favorite':'')} aria-label={'Favorite '+r.name} onClick={e=>{e.stopPropagation();toggleFavorite(r.name);ctx.toast(r.name+' favorite toggled');}}>{favorites.has(r.name)?'★':'☆'}</button>,csv:()=>''},
        {h:'Action',render:r=>r.capability.state==='REFERENCE_ONLY'?<span className="muted sm">Reference only — no local target</span>:<span className="qbo-report-row-actions"><button type="button" className="report-open-link" onClick={(e)=>{e.stopPropagation(); launchReport(r.name, r.route);}}><span>{r.capability.state==='LOCAL_PREVIEW'?'Preview':'Open'}</span><span className="rep-arrow" aria-hidden="true" /></button><span className="qbo-more-wrap"><button type="button" className="qbo-more-btn" onClick={(e)=>{e.stopPropagation();setMenuReport(prev=>prev===r.name?null:r.name)}}>More Options</button>{menuReport===r.name&&<span className="qbo-more-menu" role="menu"><button type="button" onClick={()=>{setFavorites(prev=>new Set(prev).add(r.name));setMenuReport(null);ctx.toast('Added to favorites')}}>Add to favorites</button><button type="button" onClick={()=>{setOpen(r.name);setMenuReport(null)}}>Preview</button></span>}</span></span>,csv:r=>r.capability.state},
      ]} rows={visibleRows} empty={reportScope.state==='POSTED_LOCAL_EVIDENCE_AVAILABLE' ? 'No local reports match this catalog/search scope.' : reportScope.detail} />
    </div>
  </div>;
}

function SimpleList({title, cols, rows, note}) {
  return <div><h2 className="page-h">{title}</h2>{note&&<p className="muted sm">{note}</p>}<Table cols={cols} rows={rows} /></div>;
}
export function ARModule() {
  return <SimpleList title="Accounts Receivable" note="Customer, owner, tenant and related-party master data."
    cols={[{h:'Customer',render:r=>r.customer_name},{h:'Type',render:r=><Badge tone="muted">{r.customer_type}</Badge>},{h:'Related party',render:r=>r.is_related_party?'RP':'—'}]} rows={CUSTOMERS}/>;
}
export function CashModule({ctx}) {
  const rows=localCashAccountRows(ctx?.jes||[], {entityId:ctx?.entity||null, toPeriod:'2026-07'}).map(row=>({...row, name:acct(row.account_code).account_name, bankEvidence:localBankEvidenceForCashGroup(row.group,BANK_ACCOUNTS,ctx?.entity||null)}));
  return <div className="full-bleed"><h2 className="page-h">Cash Management</h2><p className="page-subtitle">Local posted-cash scope only. No bank feed, account connection, balance pull, or payment gateway is available.</p>
    <Table exportName="local-cash-account-scope" empty="No posted local cash evidence for this entity through 2026-07." cols={[{h:'Cash GL',render:r=><span><span className="acct-code">{r.account_code}</span> {r.name}</span>,csv:r=>r.account_code},{h:'Scope',render:r=><Badge tone={r.group==='Operating'?'ok':'warn'}>{r.group}</Badge>,csv:r=>r.group},{h:'Posted balance',num:true,render:r=><Money v={r.balance}/>,csv:r=>r.balance},{h:'Posted JEs',k:'posted_je_count'},{h:'Local bank evidence',render:r=><span><Badge tone={r.bankEvidence.state==='LOCAL_MASTER_ONLY'?'muted':'bad'}>{r.bankEvidence.state}</Badge> {r.bankEvidence.label}</span>,csv:r=>r.bankEvidence.label}]} rows={rows}/>
    <p className="muted sm">Operating cash is the default Cash Flow / Balance Sheet cross-check scope. Escrow, restricted, security-deposit, and payroll-restricted balances remain separate pending business and legal cash-availability policy; they are not silently included in available cash.</p>
  </div>;
}
export function LoanRegister() {
  return <SimpleList title="Loan Register" note="Loan master data aligned with the WBS Loan Master."
    cols={[{h:'Loan',k:'loan_code'},{h:'Type',render:r=><Badge tone="muted">{r.loan_type}</Badge>},{h:'Lender',k:'lender_name'},{h:'Commitment',num:true,render:r=><Money v={r.commitment_amount}/>},{h:'Current principal',num:true,render:r=><Money v={r.current_principal}/>},{h:'Interest rate',num:true,render:r=>(r.interest_rate*100).toFixed(2)+'%'}]} rows={LOANS}/>;
}
export function ProjectCost() {
  const CC = [
    {cc:'01-100 Land Acquisition', budget:900000, commit:900000, actual:900000},
    {cc:'02-200 Sitework', budget:450000, commit:430000, actual:392000},
    {cc:'03-300 Vertical Construction', budget:2600000, commit:2450000, actual:1585000},
    {cc:'04-400 Capitalized Interest', budget:120000, commit:0, actual:29200},
    {cc:'05-500 Soft Costs / A&E', budget:310000, commit:285000, actual:198500},
    {cc:'06-600 Contingency', budget:150000, commit:0, actual:0},
  ].map(r=>({...r, ctc:Math.max(0,r.budget-r.actual), fac:Math.max(r.budget, r.commit>r.budget?r.commit:r.budget), var:r.budget-Math.max(r.budget,r.commit)}));
  const T = k => sum(CC, r=>r[k]);
  return <div className="full-bleed">
    <h2 className="page-h">椤圭洰鎴愭湰 Project Cost 路 PRJ-CEDAR</h2>
    <div className="kpi-row">
      <KPI label="鎬婚绠?Budget" value={money(T('budget'))} />
      <KPI label="宸叉壙璇?Committed" value={money(T('commit'))} sub={(T('commit')/T('budget')*100).toFixed(0)+'% of budget'} />
      <KPI label="瀹為檯鍙戠敓 Actual" value={money(T('actual'))} sub={(T('actual')/T('budget')*100).toFixed(0)+'% complete'} tone="ok" />
      <KPI label="瀹屽伐灏氶渶 CTC" value={money(T('ctc'))} tone="warn" />
    </div>
    <SectionTitle>Budget → Commitment → Actual → Forecast by Cost Code</SectionTitle>
    <Table exportName="project-cost" cols={[
      {h:'Cost Code',k:'cc'},
      {h:'Original Budget',num:true,render:r=><Money v={r.budget}/>,sortVal:r=>r.budget,csv:r=>r.budget},
      {h:'Committed',num:true,render:r=><Money v={r.commit}/>,csv:r=>r.commit},
      {h:'Actual to Date',num:true,render:r=><Money v={r.actual}/>,csv:r=>r.actual},
      {h:'% Spent',num:true,render:r=>r.budget?((r.actual/r.budget*100).toFixed(1)+'%'):'—',csv:r=>r.budget?(r.actual/r.budget*100).toFixed(1):''},
      {h:'Cost to Complete',num:true,render:r=><Money v={r.ctc}/>,csv:r=>r.ctc},
      {h:'Budget alert',render:r=>r.commit>r.budget?<Badge tone="bad">Commitment over budget</Badge>:r.actual>r.budget?<Badge tone="bad">Actual over budget</Badge>:<Badge tone="ok">On track</Badge>,csv:r=>r.commit>r.budget||r.actual>r.budget?'OVER':'OK'},
    ]} rows={CC} />
    <p className="muted sm">Actuals come from AP and PO cost codes; commitments come from contracts and POs; CTC equals budget less actuals.</p>
  </div>;
}
function AssetsLegacy({ctx}) {
  const [tab,setTab] = useState('Assets');
  const [query,setQuery] = useState('');
  const [status,setStatus] = useState('All');
  const rows = [{c:'Land',code:'161000',v:900000},{c:'Building',code:'163000',v:2100000}];
  const visibleRows = rows.filter(r => (!query || `${r.c} ${r.code} ${acct(r.code).account_name}`.toLowerCase().includes(query.toLowerCase())) && (status==='All' || status==='Active'));
  return <div className="full-bleed"><div className="accounting-page-head"><div><div className="page-eyebrow">EXPENSES · FIXED ASSETS</div><h2 className="page-h">Fixed assets</h2><div className="page-subtitle">Track asset register, depreciation and disposal history with account drillback.</div></div><div className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>ctx?.toast?.('Asset export prepared')}>Export</Btn></div></div><div className="kpi-row"><KPI label="Asset cost" value={money(sum(rows,r=>r.v))}/><KPI label="Accumulated depreciation" value={money(0)}/><KPI label="Net book value" value={money(sum(rows,r=>r.v))} tone="ok"/></div><Tabs tabs={['Assets','Depreciation','Disposals']} active={tab} onChange={setTab}/>{tab==='Assets'&&<><div className="filter-bar accounting-filter-bar fixed-assets-filter"><label><span className="filter-label">Search</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search asset or account" /></label><label><span className="filter-label">Status</span><select value={status} onChange={e=>setStatus(e.target.value)}><option>All</option><option>Active</option></select></label><button type="button" className="text-btn" onClick={()=>{setQuery('');setStatus('All')}}>Clear</button></div><Table exportName="fixed-assets" cols={[{h:'Asset',k:'c'},{h:'Account',render:r=>r.code+' '+acct(r.code).account_name},{h:'Cost',num:true,render:r=><Money v={r.v}/>},{h:'Status',render:()=> <Badge tone="ok">ACTIVE</Badge>},{h:'Drill',render:r=><button type="button" className="source-drill" onClick={()=>ctx.goto('gl',{route:'gl',tab:'Balance Sheet',drillAccounts:[r.code],drillLabel:r.c})}>View account</button>}]} rows={visibleRows} empty="No assets match the current filters"/></>} {tab==='Depreciation'&&<div className="empty-state">No depreciation schedules have been posted for the current period.</div>}{tab==='Disposals'&&<div className="empty-state">No asset disposals recorded.</div>}</div>;
}
export function Assets({ctx}) {
  const {jes = [], entity, goto} = ctx;
  const [tab,setTab] = useState('Assets');
  const [query,setQuery] = useState('');
  const [showHowItWorks,setShowHowItWorks] = useState(false);
  const periods = [...new Set(jes.map(journal => journal.period_code).filter(Boolean))].sort();
  const [toPeriod,setToPeriod] = useState(periods[periods.length - 1] || '');
  const rows = entity ? localAssetSubledger(jes,{entityId:entity,toPeriod}) : [];
  const control = localAssetSubledgerControl(rows);
  const visibleRows = rows.filter(row => !query || [row.label,row.account_code,row.journal_numbers.join(' ')].join(' ').toLowerCase().includes(query.toLowerCase()));
  const dimension = row => ['Property ' + (row.property_id || '—'),'Project ' + (row.project_id || '—'),'Loan ' + (row.loan_id || '—')].join(' · ');
  return <div className="full-bleed">
    <div className="accounting-page-head"><div><div className="page-eyebrow">ACCOUNTING · FIXED ASSETS / CWIP</div><h2 className="page-h">Fixed assets</h2><div className="page-subtitle">Posted local acquisition, CWIP and capitalized-interest evidence only. No asset valuation or tax depreciation is inferred.</div></div><div className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>setShowHowItWorks(open=>!open)}>How it works</Btn><Btn size="sm" variant="ghost" onClick={()=>goto('gl',{route:'gl',tab:'Balance Sheet',toP:toPeriod})}>See reports</Btn><Btn size="sm" variant="primary" disabled title="Asset creation is not adopted in this evidence-only register">Add an asset</Btn></div></div>
    {showHowItWorks && <Card className="ai-report-note"><div className="row-acts"><b>Fixed-asset evidence workflow</b><Btn size="sm" variant="ghost" onClick={()=>setShowHowItWorks(false)}>Close</Btn></div><p>Review retained POSTED acquisition, capitalization, depreciation or disposal evidence by entity and cutoff. Land and CWIP are never depreciated here; buildings and improvements remain in review until an explicit in-service date and posted depreciation evidence are retained.</p><p className="muted sm">Single and bulk asset creation, automated depreciation, disposal posting, tax books, valuation, inventory scans, attachments, exports and external connections are intentionally not adopted.</p></Card>}
    <div className="kpi-row"><KPI label="Posted asset cost" value={money(control.total)}/><KPI label="CWIP / not depreciated" value={money(control.cwip)} tone={control.cwip?'warn':'ok'}/><KPI label="In-service basis review" value={money(control.inService)} tone="ok"/></div>
    <Tabs tabs={['Assets','Depreciation evidence','Disposals']} active={tab} onChange={setTab}/>
    <div className="filter-bar accounting-filter-bar fixed-assets-filter"><label><span className="filter-label">Search</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Asset account or source JE" /></label><label><span className="filter-label">Through</span><select value={toPeriod} onChange={e=>setToPeriod(e.target.value)}>{periods.map(period=><option key={period} value={period}>{period}</option>)}</select></label><Badge tone={entity?'ok':'warn'}>{entity ? 'ENTITY ' + entity : 'ENTITY REQUIRED'}</Badge><Badge tone="muted">{control.state}</Badge></div>
    {tab==='Assets' && <><p className="muted sm" style={{margin:'0 0 12px'}}>Cost is tied to the same entity, cutoff, asset account and POSTED JE set used for its GL drill. CWIP is separated from in-service basis; restricted or loan-linked asset evidence remains dimension-specific.</p><Table exportName="local-asset-subledger" features={{exportable:false}} rowKey="key" cols={[
      {h:'Asset / CWIP class',k:'label'}, {h:'GL account',render:row=>row.account_code + ' ' + acct(row.account_code).account_name},
      {h:'Dimensions',render:row=>dimension(row)}, {h:'Source JEs',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('gl',{route:'gl',tab:'GL Detail',toP:toPeriod,drillAccounts:[row.account_code],drillLabel:row.label})}>{row.journal_numbers.length + ' local JEs'}</Btn>},
      {h:'Source systems',render:row=>row.source_systems.join(', ')}, {h:'Cost',num:true,render:row=><Money v={row.cost}/>,sortVal:row=>row.cost},
      {h:'Status',render:row=><Badge tone={row.status==='IN_CONSTRUCTION'?'warn':'ok'}>{row.status}</Badge>}, {h:'Depreciation',render:row=><Badge tone={row.depreciation_state==='CWIP_NOT_DEPRECIATED'?'muted':'warn'}>{row.depreciation_state}</Badge>},
    ]} rows={visibleRows} empty={entity?'No posted local asset/CWIP evidence for this cutoff.':'Select an entity before viewing local asset evidence.'}/></>}
    {tab==='Depreciation evidence' && <div className="empty-state"><b>No local depreciation schedule is established.</b><span>CWIP is not depreciated. In-service balances require retained useful-life, in-service date, accumulated-depreciation, and POSTED depreciation JE evidence before a schedule can be shown.</span></div>}
    {tab==='Disposals' && <div className="empty-state"><b>No retained disposal/reversal chain is available.</b><span>Asset disposal is not inferred from an account credit. A complete source, proceeds, accumulated depreciation, gain/loss and reversal chain is required.</span></div>}
  </div>;
}
export function Intercompany({ctx}) {
  const [ic, setIc] = useState(IC_TXNS.map(t=>({...t})));
  const mirror = (r) => { ctx.actions.newJEFromRule({entity_id:3, je_type:'AUTO', source_system:'MAN', posting_status:'POSTED',
      description:`IC mirror ${r.ic_pair_id}: Due to ${r.initiator_entity}`,
      lines:[{account_code:'125000',debit_amount:r.amount,credit_amount:0},{account_code:'291000',debit_amount:0,credit_amount:r.amount}]});
    setIc(xs=>xs.map(x=>x.ic_txn_id===r.ic_txn_id?{...x, match_status:'MATCHED'}:x));
    ctx.toast('Counterparty mirror entry created. Match: '+r.ic_pair_id); };
  return <div><h2 className="page-h">Intercompany</h2>
    <p className="muted sm">Due to/from balances, mirrored entries and matching controls. Imbalances become exceptions.</p>
    <Table cols={[
      {h:'IC Pair',k:'ic_pair_id'},{h:'绫诲瀷',render:r=><Badge tone="muted">{r.ic_type}</Badge>},
        {h:'Initiator',k:'initiator_entity'},{h:'Counterparty',k:'counterparty_entity'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>},
      {h:'鍖归厤',render:r=><Badge tone={r.match_status==='MATCHED'?'ok':'bad'}>{r.match_status}</Badge>},
      {h:'Action',render:r=>r.match_status!=='MATCHED'?<Btn size="sm" variant="primary" onClick={()=>mirror(r)}>Create mirror entry</Btn>:<span className="muted sm">—</span>},
    ]} rows={ic} rowKey="ic_txn_id" /></div>;
}
export function IntegrationHub({ctx}) {
  // P0 English-only shell. Integration sources are displayed as retained local
  // evidence; external sync, retry, import and automated posting are excluded.
  const localSourceContracts = [
    ['Vendor Bill', 'Retained supplier bill and project-cost source', 'Review only: AP evidence may be traced to its posted journal', 'No portal, OCR, import, payment, or automatic posting'],
    ['Bank Transaction', 'Retained local bank transaction evidence', 'Review only: a matching journal remains distinct from clearance and reconciliation', 'No bank feed connection or automatic matching'],
    ['Project Cost', 'Retained property or project cost evidence', 'Classify to expense, prepaid, CWIP, or asset only after review', 'Cross-entity and missing-dimension evidence stays in Review'],
    ['Journal Entry', 'Retained local journal evidence', 'Draft, review, approval, and posted states remain explicit', 'No external synchronization or bulk posting'],
  ];
  const localBatches = [
    {batch_id:'LOCAL-AP-REVIEW', src:'Vendor Bill', status:'REVIEW_ONLY', count:'Retained evidence', err:'No external processing is available.'},
    {batch_id:'LOCAL-BANK-REVIEW', src:'Bank Transaction', status:'REVIEW_ONLY', count:'Retained evidence', err:'No bank feed connection is available.'},
  ];
  return <div className="full-bleed" aria-label="Integration Hub">
    <h2 className="page-h">Integration Hub</h2>
    <p className="muted sm">Local source evidence is reviewed before it can be used by a controlled accounting workflow. This workspace does not connect, import, retry, synchronize, or post external data.</p>
    <SectionTitle>Local source contracts</SectionTitle>
    <Table cols={[
      {h:'Source',render:row=><Badge tone="muted">{row[0]}</Badge>},
      {h:'Evidence scope',render:row=>row[1]},
      {h:'Accounting boundary',render:row=>row[2]},
      {h:'Unavailable actions',render:row=><span className="muted sm">{row[3]}</span>},
    ]} rows={localSourceContracts} />
    <SectionTitle>Local review status</SectionTitle>
    <Table rowKey="batch_id" cols={[
      {h:'Review id',k:'batch_id'},
      {h:'Source',render:row=><Badge tone="muted">{row.src}</Badge>},
      {h:'Evidence',k:'count'},
      {h:'Status',render:row=><Badge tone="warn">{row.status}</Badge>},
      {h:'Notes',k:'err'},
      {h:'Actions',render:()=> <Btn size="sm" variant="ghost" disabled title="External retry and source synchronization are outside the retained local evidence scope">Unavailable</Btn>},
    ]} rows={localBatches} />
  </div>;

  const [batches, setBatches] = useState([
    {batch_id:'CL-20260731-007', src:'WBS_CL', status:'COMPLETED', n:4, ok:4, err:null},
    {batch_id:'PM-202607-P0020', src:'PM', status:'PARTIAL', n:5, ok:4, err:'琛?: PET_FEE 缂?GL 鏄犲皠 [3020]'},
    {batch_id:'BANK-20260731', src:'BANK', status:'COMPLETED', n:4, ok:4, err:null},
  ]);
  const retry = (id) => { setBatches(bs=>bs.map(b=>b.batch_id===id?{...b, status:'RETRYING'}:b));
    setTimeout(()=>setBatches(bs=>bs.map(b=>b.batch_id===id?{...b, status:'PARTIAL'}:b)), 900);
    ctx.toast('閲嶈瘯瀹屾垚锛氭槧灏勪粛缂哄け锛岄渶鍏堝湪 Mapping Center 閰嶇疆 PET_FEE','warn'); };
  const FEEDS = [
    ['PAYABLE','涓婃父 AP 鍙戠エ(Contract & Invoice / Budget & Purchasing 瀹℃壒瀹屾垚)','Dr 璐圭敤绉戠洰(甯?Cost Code/Class/Payable No GUID/Unit) / Cr 291001 Due to/from_鎸塒ayee鎸傝处','涓よ涓€缁?Journal No=YYYYMMDD+搴忓彿'],
    ['EXPA','閾惰娴佹按 Feed 鑷姩鍖归厤浠樻(Auto Payments Reconciliation)','Dr 291001 Due to/from_Payee(娓呰处) / Cr 111000 Operating Cash_鍏徃_閾惰_璐﹀彿灏惧彿','memo 淇濈暀鍘熷 ACH/CCD 閾惰鎻忚堪鍏ㄦ枃'],
    ['AUTOC','Company-card or bank purchase feed','Dr 291001 Due to/from Vendor / Cr 111000 Operating Cash','When paired with PAYABLE, clears the payable balance'],
    ['DIVIDEND','涓氫富鍒嗙孩鍙戞斁鎵规(鎸?Lot/Unit)','Dr 291000 Due to/from_涓氫富(鎸?Lot 澶氳) / Cr 111000 鐜伴噾 + Cr 220204 Tax Payable(浠ｆ墸绋?','WBLD 瀹炴祴妯″紡'],
    ['NOT_MATCH','閾惰娴佹按鏃犳硶鑷姩鍖归厤','鏆傛寕,浜哄伐澶勭悊 鈫?杞?Match 鎴?Exception','瀵瑰簲 REFS Bank Transactions For Review'],
    ['REIMB / Reimbursement Invoice','鍛樺伐涓婁紶鎶ラ攢鍙戠エ(Upload Reimbursement Invoices)','瀹℃壒鍚?Dr 璐圭敤 / Cr 291001 Due to/from_鍛樺伐','Auto Reimbursement=鑷姩鐢熸垚鍒嗗綍'],
    ['AUTO_BANK_REIMB','閾惰鎵ｆ鑷姩娓呮姤閿€鎸傝处','Dr 291001 / Cr 111000','涓?EXPA 鍚屾満鍒?鏉ユ簮涓烘姤閿€'],
    ['INTERNAL_TRANSFER','Transfer between owned bank accounts','Dr 111000 receiving account / Cr 111000 paying account','Each bank feed is reconciled independently'],
    ['INTERNAL / INDIVIDUAL','Manual or individual journal entry','Draft → Review → Approve','Only reviewed items are available for posting'],
  ];
  return <div className="full-bleed"><h2 className="page-h">闆嗘垚涓績 Integration Hub</h2>
    <p className="muted sm">External data first enters staging, then moves through validation, GL mapping, approval, and posting. Retry behavior is shell-only until verified.</p>
    <SectionTitle>WBS 鏁版嵁鏉ユ簮瑙勫垯(涓?WBS 鐢熶骇绯荤粺閫愭潯瀵归綈)</SectionTitle>
    <Table cols={[
      {h:'Source',render:r=><Badge tone="muted">{r[0]}</Badge>},
      {h:'涓氬姟鏁版嵁鏉ユ簮',render:r=>r[1]},
      {h:'璁拌处瑙勫垯',render:r=>r[2]},
      {h:'澶囨敞',render:r=><span className="muted sm">{r[3]}</span>},
    ]} rows={FEEDS} />
    <SectionTitle>鎵规鐩戞帶</SectionTitle>
    <Table rowKey="batch_id" cols={[
      {h:'鎵规',k:'batch_id'},{h:'鏉ユ簮',render:r=><Badge tone="muted">{r.src}</Badge>},
      {h:'璁板綍',num:true,render:r=>r.ok+'/'+r.n},
      {h:'Status',render:r=><Badge tone={r.status==='COMPLETED'?'ok':'warn'}>{r.status}</Badge>},
      {h:'Error details',render:r=>r.err||'—'},
      {h:'Actions',render:r=>r.status!=='COMPLETED' ? <span className="row-acts"><Btn size="sm" onClick={()=>retry(r.batch_id)}>Retry</Btn><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('mapping')}>Open mapping</Btn></span> : <span className="muted sm">—</span>},
    ]} rows={batches} /></div>;
}
export function MasterData() {
  const [tab,setTab] = useState('Entity');
  const map = {Entity:[ENTITIES,[{h:'缂栫爜',k:'entity_code'},{h:'鍚嶇О',k:'entity_name'},{h:'绫诲瀷',render:r=><Badge tone="muted">{r.entity_type}</Badge>}]],
    Project:[PROJECTS,[{h:'Project code',k:'project_code'},{h:'Project name',k:'project_name'},{h:'Construction status',render:r=><Badge tone={r.construction_status==='UNDER_CONSTRUCTION'?'warn':'ok'}>{r.construction_status}</Badge>}]],
    Property:[PROPERTIES,[{h:'Property code',k:'property_code'},{h:'Property name',k:'property_name'},{h:'Status',render:r=><Badge tone="muted">{r.property_status}</Badge>}]]};
  const [rows,cols] = map[tab];
  return <div><h2 className="page-h">Master Data Center</h2>
    <p className="muted sm">Master data uses unique codes and versioned history. This shell does not assert QuickBooks master-data behavior as equivalent.</p>
    <Tabs tabs={Object.keys(map)} active={tab} onChange={setTab} />
    <Table cols={cols} rows={rows} /></div>;
}
export function MappingCenter({ctx}) {
  const FAMILIES = [
    ['Bank Detail 鈫?Account','Account Setting 路 Bank','閾惰璐﹀彿鈫掔幇閲戠鐩?111000瀛愯处)','setting'],
    ['Construction Loan Detail 鈫?Account','Account Setting 路 Contruction Loan','Draw/Repayment/Interest/Escrow脳7鈫掔鐩?Project','setting'],
    ['Cost Code Group 鈫?Account','Account Setting 路 Cost','0LD/2HD/24E/21E/9AM 鐮佺粍鈫扖WIP/璐圭敤','setting'],
    ['Cost Code 脳 Dr/Cr 鈫?Account','Cost Setting','Cost General Ledger 鎸夊崟鐮佸€熻捶鏄犲皠','setting'],
    ['Payable Cost Code 鈫?Dr Account','Payable Setting','鎸夌爜瀹氬€熸柟+褰掑睘鍏徃;Credit琛?291001','setting'],
    ['Batch Template 鈫?Dr/Cr Pair','Batch Setting','璁℃彁妯℃澘+Sequential+Reverse Next Month','setting'],
    ['PM Charge Code 鈫?Owner GL','涓嬭〃','RENT/LATE_FEE/SEC_DEPOSIT/UTILITIES/MGMT_FEE','pm'],
    ['Project Status → Capitalization','Rules Center','Under construction → 64500 Capitalized interest; complete → 95000 Expense','rules'],
    ['Unit Status 鈫?Inventory/COGS','Rule Center','鍦ㄥ缓CWIP鈫掑畬宸nventory鈫掑敭鍑篊OGS','rules'],
    ['Company 鈫?Rule Profile','Company Setting','姣忓叕鍙哥嫭绔嬪洓澶etting+Copy','setting'],
  ];
  return <div className="full-bleed"><h2 className="page-h">Mapping Center</h2>
    <p className="muted sm">Mapping families link source codes to controlled settings and rules. Behavior remains REFS-local until QBO evidence is observed.</p>
    <Table cols={[
      {h:'Mapping 瀹舵棌',render:r=><b>{r[0]}</b>},
      {h:'缁存姢浣嶇疆',render:r=><Badge tone="muted">{r[1]}</Badge>},
      {h:'瑙勫垯璇存槑',render:r=>r[2]},
      {h:'Open',render:r=><Btn size="sm" variant="ghost" onClick={()=>ctx.goto(r[3]==='pm'?'mapping':r[3]==='rules'?'rules':'setting')}>Open</Btn>},
    ]} rows={FAMILIES}/>
    <SectionTitle>PM Charge Code to Owner GL mapping</SectionTitle>
    <Table cols={[{h:'Type',render:r=><Badge tone="muted">{r.mapping_type}</Badge>},{h:'Charge Code',k:'source_code'},{h:'Owner GL',render:r=>r.owner_gl_account_code+' '+acct(r.owner_gl_account_code).account_name},{h:'Revenue/Expense',k:'rev_exp_flag'},{h:'Cash/Accrual',k:'cash_accrual_flag'}]} rows={MAPPINGS} />
  </div>;
}
export function RuleCenter() {
  const legacyRuleEvidence = [
    /* Legacy prototype descriptions are retained as non-executable reference text.
    ['R-LOAN-01','LOAN.DRAW','Dr 111000 Cash / Cr 270100 Loan Payable(璧勯噾娴佸叆鈮犳垚鏈?','LIVE'],
    ['R-LOAN-03','LOAN.INTEREST 路 鍦ㄥ缓','Dr 164500 CWIP-Cap Interest / Cr 220410','LIVE'],
    ['R-LOAN-04','LOAN.INTEREST 路 瀹屽伐','Dr 795000 Interest Expense / Cr 220410','LIVE'],
    ['R-LOAN-05','LOAN.REPAYMENT','Dr 270100 / Cr 111000(鎴栨寜鍏徃Setting鈫?91001)','LIVE'],
    ['R-AP-STD-01','PAYABLE(鎸塒ayee鎸傝处)','Dr 璐圭敤/CWIP(鎸塁ost Setting) / Cr 291001_Payee','LIVE'],
    ['R-EXPA-01','閾惰Feed鑷姩娓呰处','Dr 291001_Payee / Cr 111000(EXPA/AUTOC)','LIVE'],
    ['R-COST-2HD','Hard Cost 脳 鍦ㄥ缓','Dr 164400 CWIP / Cr 220300','LIVE'],
    ['R-COST-2HD-DONE','Hard Cost 脳 瀹屽伐','Dr 510000 COGS / Cr 220300(鐘舵€侀┍鍔?','LIVE'],
    ['R-PM-11','PM RENT(鏉冭矗)','Dr 120200 AR / Cr 421803 Rental Income','LIVE'],
    ['R-PM-16','SEC_DEPOSIT','Dr 111000 / Cr 225000 鎶奸噾璐熷€?绂佸叆鏀跺叆)','LIVE'],
    ['R-CLS-SALE-01','Closing 路 Confirmed amount','Dr 111000 / Cr 491800;Title Withholding鈫?20205','LIVE'],
    ['R-CLS-COGS-01','Closing 路 鎴愭湰缁撹浆','Dr 510000 / Cr 164400(鈮ょ疮璁WIP)','LIVE'],
    ['R-DIV-01','Dividend 鎵规','Dr 291000_涓氫富(鎸塋ot) / Cr 111000 + Cr 220204浠ｆ墸','LIVE'],
    ['R-UT-OUT-01','Unit Transfer A杞嚭','Dr 125000 Due from_B / Cr 164400 + 787001鎹熺泭','LIVE'],
    ['R-UT-IN-01','Unit Transfer B杞叆','Dr 164400(B Opening Basis) / Cr 291000 Due to_A','LIVE'],
    ['R-IC-01','Intercompany payment','Paying entity: Dr 125000 / Cr 111000; receiving entity: Dr 111000 / Cr 291000','LIVE'],
    */
  ];
  const rules = [
    {id:'R-LOAN-01', priority:1, trigger:'LOAN.DRAW', appliedTo:'Local controlled account set', conditions:'Local event is LOAN.DRAW', settings:'Local controlled rule-shell record', autoPost:'Unavailable', status:'Active (local)'},
    {id:'R-AP-STD-01', priority:2, trigger:'PAYABLE', appliedTo:'Local controlled account set', conditions:'Local event is PAYABLE', settings:'Local controlled rule-shell record', autoPost:'Unavailable', status:'Active (local)'},
    {id:'R-EXPA-01', priority:3, trigger:'BANK.FEED', appliedTo:'Local controlled account set', conditions:'Local event is BANK.FEED', settings:'Local controlled rule-shell record', autoPost:'Unavailable', status:'Active (local)'},
  ];
  const [query, setQuery] = useState('');
  const filteredRules = filterAccountingRuleEvidence(rules, query);
  return <div><h2 className="page-h">Accounting Rule Center</h2>
    <section className="report-workbench" aria-label="Observed QuickBooks Rules shell" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Rules</b><div className="page-subtitle">Observed QBO bank-rule list shell. Real QBO rule content is intentionally not copied into REFS.</div></div><Btn size="sm" variant="ghost" disabled>New rule</Btn></div>
      <div className="report-shelf"><button type="button" className="report-shelf-chip report-shelf-chip-on" disabled>Bank rules</button><button type="button" className="report-shelf-chip" disabled>Integration rules</button><label className="qbo-report-search"><input aria-label="Search local rules by name or conditions" placeholder="Search rules by name or conditions" value={query} onChange={e=>setQuery(e.target.value)} /></label><span className="report-shelf-chip">All rules</span><Btn size="sm" variant="ghost" disabled>Settings</Btn></div>
      <div className="qbo-drill-summary">{['Drag to reorder','Select','Priority','Rule name','Applied to','Conditions','Settings','Auto-post','Status','Actions'].map(label=><span key={label}><i>{label}</i><b>Observed column</b></span>)}</div>
      <p className="muted sm">Showing {filteredRules.length} locally controlled records. Priority is display-only; selection, auto-post, Edit, and menus remain unavailable.</p>
    </section>
    <p className="muted sm">Rules are controlled shell data. Search affects only these local records; LIVE and TESTED labels are local states, not verified QuickBooks workflow states.</p>
    {filteredRules.length ? <Table cols={[{h:'Priority',render:r=>r.priority},{h:'Rule name',render:r=>r.id},{h:'Applied to',render:r=>r.appliedTo},{h:'Conditions',render:r=>r.conditions},{h:'Settings',render:r=>r.settings},{h:'Auto-post',render:r=><span className="muted">{r.autoPost}</span>},{h:'Status',render:r=><Badge tone="ok">{r.status}</Badge>},{h:'Actions',render:()=> <Btn size="sm" variant="ghost" disabled>Edit</Btn>}]} rows={filteredRules} rowKey={r=>r.id} /> : <div className="empty-state"><b>No local rules found</b><p>Try a different rule name or condition. This does not query or modify QuickBooks.</p></div>}</div>;
}
export function AdminModule({ctx}) {
  return <div><h2 className="page-h">System Admin</h2>
    <p className="muted sm">Administrative shell controls are local REFS capabilities. They are not asserted as observed QuickBooks behavior.</p>
    <SectionTitle>Segregation of duties (SoD)</SectionTitle>
    <ul className="sod-list">
      <li>Vendor creation, payment approval, and journal-entry approval must be separated.</li>
      <li>Entity and ownership changes require controlled mapping review.</li>
      <li>Posting is limited to approved, current-period records.</li>
    </ul>
    <p className="muted sm">Approval chains, audit logs, and permission boundaries remain unverified against QuickBooks.</p>
  </div>;
}
