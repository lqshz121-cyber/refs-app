import React from 'react';
import {Icon} from './ui.jsx';

// Presentation-only chrome for the authenticated application.  Every visible
// control has a real action; unavailable product areas are represented by
// their route-level API states instead of inert toolbar buttons.
export function AuthoritativeTopbar({
  navOpenerRef,navOpen,onOpenNavigation,entityLabel,periodLabel,
  scopes=[],entityId,periodId,onEntityChange,onPeriodChange,
  theme,onToggleTheme,onRefresh,onSignOut,
}){
  const available=Array.isArray(scopes)?scopes:[];
  const entities=[...new Map(available.map(row=>[row.entity_id,row])).values()].sort((a,b)=>a.entity_name.localeCompare(b.entity_name));
  const periods=available.filter(row=>row.entity_id===entityId).sort((a,b)=>b.period_start.localeCompare(a.period_start));
  const selectable=entities.length>0&&typeof onEntityChange==='function'&&typeof onPeriodChange==='function';
  return <header className="topbar authoritative-topbar">
    <button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={onOpenNavigation}><Icon name="menu" size={24}/></button>
    <label className="sw authoritative-shell-scope"><span className="sr-only">Authoritative company</span>{selectable?<select className="authoritative-shell-select" aria-label="Authoritative company" value={entityId} onChange={event=>onEntityChange(event.target.value)}>{entities.map(row=><option key={row.entity_id} value={row.entity_id}>{row.entity_name} ({row.entity_code})</option>)}</select>:<span className="authoritative-shell-select" title={entityLabel}>{entityLabel}</span>}</label>
    <div className="top-right authoritative-top-actions">
      <span className="period-chip authoritative-period-chip"><span className="period-label">Period</span>{selectable?<select aria-label="Accounting period" value={periodId} onChange={event=>onPeriodChange(event.target.value)}>{periods.map(row=><option key={row.period_id} value={row.period_id}>{row.period_code}</option>)}</select>:<b>{periodLabel}</b>}<span className="badge badge-ok">API read</span></span>
      <button type="button" className="icon-btn" aria-label="Refresh authoritative accounting evidence" title="Refresh authoritative accounting evidence" onClick={onRefresh}><span aria-hidden="true">↻</span></button>
      <button type="button" className="icon-btn" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} title={theme==='dark'?'Switch to light theme':'Switch to dark theme'} aria-pressed={theme==='dark'} onClick={onToggleTheme}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span></button>
      <span className="badge badge-ok authoritative-mode-chip">Authoritative</span>
      <span className="user-chip authoritative-user-chip" aria-label="Authenticated OIDC session"><span className="user-av" aria-hidden="true">A</span><span className="user-nm">Authenticated</span><button type="button" className="link-btn" onClick={onSignOut}>Sign out</button></span>
    </div>
  </header>;
}
