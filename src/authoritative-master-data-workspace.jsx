import React,{useState} from 'react';
import {AuthoritativeChartOfAccountsWorkspace} from './authoritative-coa-register-workspace.jsx';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {CounterpartyRegisterWorkspace} from './counterparty-register-workspace.jsx';
import {Segmented} from './ui.jsx';

const VIEWS=Object.freeze([
  Object.freeze({value:'VENDORS',label:'Vendors'}),
  Object.freeze({value:'CUSTOMERS',label:'Customers'}),
  Object.freeze({value:'ACCOUNTS',label:'Chart of accounts'}),
]);

export function AuthoritativeMasterDataWorkspace({config,fetcher=globalThis.fetch,initialView='VENDORS'}){
  const [view,setView]=useState(VIEWS.some(item=>item.value===initialView)?initialView:'VENDORS');
  return <AuthoritativeWorkspaceView area="Master Data">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - ADMINISTRATION" title="Master Data" description="Work with the current company's vendor, customer, and account masters through their existing authenticated APIs." status="SERVER AUTHORIZED"/>
    <div className="filter-bar" aria-label="Master Data register selection"><Segmented options={VIEWS} value={view} onChange={setView} label="Master Data register"/></div>
    {view==='VENDORS'?<CounterpartyRegisterWorkspace key={`${config?.entityId}:vendors`} config={config} kind="VENDOR" fetcher={fetcher}/>:null}
    {view==='CUSTOMERS'?<CounterpartyRegisterWorkspace key={`${config?.entityId}:customers`} config={config} kind="CUSTOMER" fetcher={fetcher}/>:null}
    {view==='ACCOUNTS'?<AuthoritativeChartOfAccountsWorkspace key={`${config?.entityId}:accounts`} config={config} fetcher={fetcher}/>:null}
  </AuthoritativeWorkspaceView>;
}
