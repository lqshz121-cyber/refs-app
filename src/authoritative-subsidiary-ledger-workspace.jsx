import React,{useState} from 'react';
import {AuthoritativeAgingWorkspace} from './authoritative-aging-workspace.jsx';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {Segmented} from './ui.jsx';

const LEDGERS=Object.freeze([
  Object.freeze({value:'ap',label:'Accounts payable'}),
  Object.freeze({value:'ar',label:'Accounts receivable'}),
]);

export function AuthoritativeSubsidiaryLedgerWorkspace({config,fetcher=globalThis.fetch}){
  const [side,setSide]=useState('ap');
  return <AuthoritativeWorkspaceView area="Subsidiary ledger" className="authoritative-subsidiary-ledger-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="General Ledger" title="Subsidiary Ledger" description="Reconcile retained AP and AR document balances to their Posted general-ledger control accounts." status="Read-only reconciliation"/>
    <Segmented options={LEDGERS} value={side} onChange={setSide} label="Subsidiary ledger type"/>
    <AuthoritativeAgingWorkspace key={side} config={config} side={side} fetcher={fetcher}/>
  </AuthoritativeWorkspaceView>;
}
