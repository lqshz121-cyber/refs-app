import { useEffect, useState } from 'react';
import { Btn, Badge, Money, Table } from './ui.jsx';
import { localAccountRegisterEntries, localAccountRegisterOpeningBalance, localCashRegisterScope, localRegisterAccountOptions, localRegisterBankEvidence, localRegisterBankEvidenceTransactions, localRegisterEndingBalance, localRegisterScope } from './account-register-evidence.js';
import { localGLSourceTarget } from './gl-source-target.js';
import { BANK_ACCOUNTS, LOANS, PROJECTS, PROPERTIES } from './data.js';
import { localAccountRegisterJournalReturnContext, localAccountRegisterReportReturnContext } from './account-register-return.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localReconciliationRegisterEvidence } from './reconciliation-register-return.js';

// Account inquiry is a local posted-entry view, never a connected bank register.
export function AccountRegister({ctx}) {
  const {jes, coa, entity, goto, navContext, ap, ar, bank} = ctx;
  const [code, setCode] = useState('111000');
  const [selectedEntryId, setSelectedEntryId] = useState(null);
  const periods = [...new Set(jes.map(journal => journal.period_code).filter(Boolean))].sort();
  const [fromPeriod, setFromPeriod] = useState(periods[0] || '');
  const [throughPeriod, setThroughPeriod] = useState(periods[periods.length - 1] || '');
  useEffect(() => {
    if (navContext?.route === 'register' && coa.some(account => account.account_code === navContext.accountCode)) setCode(navContext.accountCode);
    if (navContext?.route === 'register' && navContext.throughPeriod) setThroughPeriod(navContext.throughPeriod);
    if (navContext?.route === 'register' && navContext.fromPeriod) setFromPeriod(navContext.fromPeriod);
    if (navContext?.route === 'register' && navContext.entryId) setSelectedEntryId(String(navContext.entryId));
  }, [navContext?.route, navContext?.accountCode, navContext?.fromPeriod, navContext?.throughPeriod, navContext?.entryId, coa]);

  const account = coa.find(row => row.account_code === code) || {};
  const registerAccounts = localRegisterAccountOptions(coa);
  const dimensionLabel = line => [
    line.property_id && `Property: ${PROPERTIES.find(row => row.property_id === line.property_id)?.property_code || line.property_id}`,
    line.project_id && `Project: ${PROJECTS.find(row => row.project_id === line.project_id)?.project_code || line.project_id}`,
    line.loan_id && `Loan: ${LOANS.find(row => row.loan_id === line.loan_id)?.loan_code || line.loan_id}`,
  ].filter(Boolean).join(' · ') || '—';
  const sourceTargetFor = journal => String(journal.source_system || '').startsWith('WBS') ? null : localGLSourceTarget(journal, {
    apBills: ap?.bills || [], arInvoices: ar?.invoices || [], bankAccounts: bank?.accounts || {},
  });
  const openingBalance = entity ? localAccountRegisterOpeningBalance(jes, {entityId:entity, accountCode:code, fromPeriod}) : 0;
  const registerEntries = entity ? localAccountRegisterEntries(jes, {entityId:entity, accountCode:code, fromPeriod, throughPeriod}) : [];
  const rows = registerEntries.map(entry => ({
    ...entry,
    bankEvidence:localRegisterBankEvidence(entry.journal, bank?.accounts || {}, {bankAccountMaster:BANK_ACCOUNTS,entityId:entity || null,cashAccountCode:code}),
    bankEvidenceTransactions:localRegisterBankEvidenceTransactions(entry.journal, bank?.accounts || {}, {bankAccountMaster:BANK_ACCOUNTS,entityId:entity || null,cashAccountCode:code}),
    dimensions:dimensionLabel(entry.line),
    sourceTarget:sourceTargetFor(entry.journal),
  })).map(row => ({...row,reconciliationEvidence:localReconciliationRegisterEvidence(row.bankEvidenceTransactions,navContext?.reconciliationHistoryReturn)}));
  const endingBalance = localRegisterEndingBalance(rows);
  const scope = localRegisterScope(code);
  const cashRegisterScope = localCashRegisterScope({entityId:entity || null,accountCode:code,bankAccountMaster:BANK_ACCOUNTS});
  const selectedEntry = rows.find(row => row.id === selectedEntryId) || null;
  const openScopedGeneralLedger = () => goto('gl',{
    route:'gl', tab:'GL Detail', entityId:entity || '', fromP:fromPeriod, toP:throughPeriod,
    drillAccounts:[code], drillLabel:(account.account_name || code),
    registerReturn:localAccountRegisterReportReturnContext({entityId:entity,accountCode:code,fromPeriod,throughPeriod}),
  });

  if (selectedEntry) return <div className="full-bleed qbo-transaction-report" aria-label="Local account-register entry detail">
    <div className="qbo-report-back"><button type="button" onClick={()=>setSelectedEntryId(null)}>Back to account register</button><span>Retained local entry detail</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Account register 路 local posted evidence</div><h2 className="page-h">{selectedEntry.ref}</h2><div className="gl-drill-account">{code} {account.account_name || ''} · {selectedEntry.date}</div></div><Badge tone="ok">POSTED</Badge></div>
    <div className="qbo-drill-summary"><span><i>Entity / period</i><b>{entity || '—'} / {selectedEntry.period}</b></span><span><i>Transaction type</i><b>{selectedEntry.transactionType}</b></span><span><i>Source</i><b>{selectedEntry.source}</b></span><span><i>Counterparty</i><b>{selectedEntry.counterparty || 'Not retained'}</b></span><span><i>Debit / credit</i><b>{selectedEntry.debit || '—'} / {selectedEntry.credit || '—'}</b></span><span><i>Running balance</i><b><Money v={selectedEntry.runningBalance}/></b></span><span><i>Dimensions</i><b>{selectedEntry.dimensions}</b></span><span><i>Bank evidence</i><b>{selectedEntry.bankEvidence.state}</b></span></div>
    <p className="report-drill-hint">Only the selected entity, account and through-period POSTED line is shown. Bank match, clearing and reconciliation sign-off remain independent; missing/cross-scope source evidence cannot be drilled or changed here.</p>
    <div className="row-acts"><Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:selectedEntry.ref,registerReturn:localAccountRegisterJournalReturnContext({entityId:entity,accountCode:code,fromPeriod,throughPeriod,entryId:selectedEntry.id})})}>Open retained JE</Btn>{selectedEntry.sourceTarget?<Btn size="sm" variant="ghost" onClick={()=>goto(selectedEntry.sourceTarget.route,selectedEntry.sourceTarget.context)}>Open retained source</Btn>:<Btn size="sm" variant="ghost" disabled>No source drill</Btn>}{cashRegisterScope.master?<Btn size="sm" variant="ghost" onClick={()=>goto('bankrec',{route:'bankrec',acctCode:cashRegisterScope.master.bank_account_code,registerReturn:localAccountRegisterJournalReturnContext({entityId:entity,accountCode:code,fromPeriod,throughPeriod,entryId:selectedEntry.id})})}>Open local reconcile</Btn>:<Btn size="sm" variant="ghost" disabled>No reconcile scope</Btn>}</div>
  </div>;

  return <div className="full-bleed">
    {navContext?.reportReturn?.route === 'gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    {navContext?.coaReturn?.route === 'coa' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('coa',navContext.coaReturn)}>Back to Chart of Accounts</button><span>{`Retained COA scope · ${navContext.coaReturn.qboQuery || 'all accounts'}`}</span></div>}
    {navContext?.reconciliationHistoryReturn?.route === 'bankrec' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('bankrec',navContext.reconciliationHistoryReturn)}>Back to reconciliation history</button><span>{`Retained signed scope · ${navContext.reconciliationHistoryReturn.acctCode} · statement ${navContext.reconciliationHistoryReturn.statementDate || 'unavailable'}`}</span></div>}
    <div className="accounting-page-head">
      <div>
        <div className="page-eyebrow">ACCOUNTING REGISTER</div>
        <h2 className="page-h" style={{margin:0}}>Account Register</h2>
        <div className="page-subtitle">Local posted balance-sheet evidence only. It is not a connected bank register or a bank-statement import.</div>
      </div>
      <div className="row-acts">
        <Btn size="sm" variant="ghost" onClick={openScopedGeneralLedger}>Open General Ledger</Btn>
        <Btn size="sm" variant="ghost" disabled={!cashRegisterScope.master} title={cashRegisterScope.master ? 'Open the mapped local cash reconciliation with this register scope' : 'This account has no single mapped local cash reconciliation scope'} onClick={()=>goto('bankrec',{route:'bankrec',acctCode:cashRegisterScope.master?.bank_account_code,registerReturn:localAccountRegisterReportReturnContext({entityId:entity,accountCode:code,fromPeriod,throughPeriod})})}>Open Reconciliation</Btn>
      </div>
    </div>
    <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:14,flexWrap:'wrap'}}>
      <select value={code} onChange={event=>setCode(event.target.value)} style={{padding:'9px 12px',borderRadius:8,border:'1px solid #d4d7dc',fontSize:14}} aria-label="Register account">
        {registerAccounts.map(row=><option key={row.account_code} value={row.account_code}>{row.account_code} {row.account_name}</option>)}
      </select>
      <select value={fromPeriod} onChange={event=>setFromPeriod(event.target.value)} style={{padding:'9px 12px',borderRadius:8,border:'1px solid #d4d7dc',fontSize:14}} aria-label="From period">
        {periods.filter(period=>period<=throughPeriod).map(period=><option key={period} value={period}>From {period}</option>)}
      </select>
      <select value={throughPeriod} onChange={event=>setThroughPeriod(event.target.value)} style={{padding:'9px 12px',borderRadius:8,border:'1px solid #d4d7dc',fontSize:14}} aria-label="Through period">
        {periods.map(period=><option key={period} value={period}>Through {period}</option>)}
      </select>
      <Badge tone="muted">{account.account_type}</Badge>
      <Badge tone={scope === 'Operating' ? 'ok' : 'warn'}>{scope}</Badge>
      <Badge tone={cashRegisterScope.state==='LOCAL_CASH_REGISTER'?'ok':'warn'}>{cashRegisterScope.state}</Badge>
      <span className="muted sm">Opening</span><Money v={openingBalance}/><span className="muted sm">Ending Balance</span><Money v={endingBalance} bold/>
      <span style={{flex:1}}/>
      <Btn size="sm" variant="ghost" onClick={openScopedGeneralLedger}>Run Report</Btn>
      <Btn size="sm" variant="ghost" disabled={!cashRegisterScope.master} title={cashRegisterScope.master?'Open the mapped local cash reconciliation':'This balance-sheet account has no single mapped local cash reconciliation scope'} onClick={()=>goto('bankrec',{route:'bankrec',acctCode:cashRegisterScope.master?.bank_account_code,registerReturn:localAccountRegisterReportReturnContext({entityId:entity,accountCode:code,fromPeriod,throughPeriod})})}>Reconcile</Btn>
    </div>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Scope: entity {entity || 'must select an entity'} · {scope} · through {throughPeriod || 'all retained periods'}{navContext?.reconciliationHistoryReturn?.route === 'bankrec' ? ` · signed statement cutoff ${navContext.statementDate || navContext.reconciliationHistoryReturn.statementDate || 'unavailable'}` : ''}. Running balance uses only POSTED local JEs in deterministic date/reference order. {cashRegisterScope.master ? 'Mapped bank account ' + cashRegisterScope.master.bank_account_code + '; ' : ''}a bank match is not reconciliation sign-off.</p>
    <Table rowKey="id" className="table-journal-entries" features={{exportable:false}} onRow={row=>setSelectedEntryId(row.id)} cols={[
      {h:'Date',k:'date'}, {h:'JE',k:'ref'},
      {h:'Source',render:row=>row.sourceTarget?<button type="button" className="source-drill" onClick={event=>{event.stopPropagation();goto(row.sourceTarget.route,row.sourceTarget.context);}} title="Open retained local source"><Badge tone="muted">{row.source}</Badge></button>:<Badge tone="muted">{row.source}</Badge>,csv:row=>row.source},
      {h:'Counterparty / memo',render:row=><span>{row.counterparty ? `${row.counterparty} · ` : ''}{row.memo}</span>,csv:row=>`${row.counterparty || ''} ${row.memo || ''}`},
      {h:'Dimensions',k:'dimensions'},
      {h:'Debit',num:true,render:row=>row.debit?<Money v={row.debit}/>:'' ,csv:row=>row.debit||''},
      {h:'Credit',num:true,render:row=>row.credit?<Money v={row.credit}/>:'' ,csv:row=>row.credit||''},
      {h:'Running balance',num:true,render:row=><Money v={row.runningBalance} bold/>,csv:row=>row.runningBalance},
      {h:'Bank evidence',render:row=><Badge tone={row.bankEvidence.state === 'LOCAL_MATCHED' ? 'ok' : 'warn'}>{row.bankEvidence.state === 'LOCAL_MATCHED' ? 'LOCAL MATCHED' : row.bankEvidence.state === 'LOCAL_UNMATCHED' ? 'LOCAL UNMATCHED' : 'NO LOCAL MATCH'}</Badge>,csv:row=>row.bankEvidence.state},
      {h:'Reconcile evidence',render:row=><Badge tone={row.reconciliationEvidence.state === 'CLEARED_SIGNED_OFF' ? 'ok' : row.reconciliationEvidence.state === 'NO_SIGNED_SCOPE' ? 'muted' : 'warn'}>{row.reconciliationEvidence.state}</Badge>,csv:row=>row.reconciliationEvidence.state},
    ]} rows={rows} empty={entity ? 'No posted local entries in this entity/account/period scope.' : 'Select an entity before viewing a local cash register.'}/>
  </div>;
}
