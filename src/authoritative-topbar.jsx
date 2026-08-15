import React from 'react';

// Presentation-only chrome for the authenticated application.  Every visible
// control has a real action; unavailable product areas are represented by
// their route-level API states instead of inert toolbar buttons.
export function AuthoritativeTopbar({
  navOpenerRef,navOpen,onOpenNavigation,entityLabel,periodLabel,
  theme,onToggleTheme,onRefresh,onSignOut,
}){
  return <header className="topbar authoritative-topbar">
    <button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={onOpenNavigation}>Menu</button>
    <label className="sw authoritative-shell-scope"><span className="sr-only">Authoritative entity</span><span className="authoritative-shell-select" title={entityLabel}>{entityLabel}</span></label>
    <div className="top-right authoritative-top-actions">
      <span className="period-chip authoritative-period-chip"><span className="period-label">Period</span><b>{periodLabel}</b><span className="badge badge-ok">Live records</span></span>
      <button type="button" className="icon-btn" aria-label="Refresh authoritative accounting evidence" title="Refresh authoritative accounting evidence" onClick={onRefresh}><span aria-hidden="true">↻</span></button>
      <button type="button" className="icon-btn" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} title={theme==='dark'?'Switch to light theme':'Switch to dark theme'} aria-pressed={theme==='dark'} onClick={onToggleTheme}><span aria-hidden="true">{theme==='dark'?'☀':'☾'}</span></button>
      <span className="badge badge-ok authoritative-mode-chip">Authoritative</span>
      <span className="user-chip authoritative-user-chip" aria-label="Authenticated OIDC session"><span className="user-av" aria-hidden="true">A</span><span className="user-nm">Authenticated</span><button type="button" className="link-btn" onClick={onSignOut}>Sign out</button></span>
    </div>
  </header>;
}
