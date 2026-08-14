import React from 'react';

// Shared presentation hierarchy only. Authoritative data and commands remain
// owned by the caller; no demonstration state crosses this boundary.
export function AuthoritativeDemoTopbar({
  navOpenerRef,navOpen,onOpenNavigation,entityLabel,periodLabel,
  theme,onToggleTheme,onRefresh,onSignOut,
}){
  return <header className="topbar authoritative-topbar authoritative-demo-topbar">
    <button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={onOpenNavigation}>Menu</button>
    <label className="sw authoritative-shell-scope"><span className="sr-only">Current company</span><span className="authoritative-shell-select" title={entityLabel}>{entityLabel}</span></label>
    <button type="button" className="cmdk" disabled aria-disabled="true" title="Search will be available when company records can be searched">Search or jump</button>
    <div className="top-right authoritative-top-actions">
      <span className="period-chip authoritative-period-chip"><span className="period-label">Period</span><b>{periodLabel}</b><span className="badge badge-ok">Connected</span></span>
      <button type="button" className="icon-btn" disabled aria-disabled="true" title="Help is unavailable">?</button>
      <button type="button" className="icon-btn" disabled aria-disabled="true" title="Notifications are unavailable">N</button>
      <button type="button" className="icon-btn" aria-label="Refresh financial information" title="Refresh financial information" onClick={onRefresh}>Refresh</button>
      <button type="button" className="icon-btn" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} aria-pressed={theme==='dark'} onClick={onToggleTheme}>{theme==='dark'?'Light':'Dark'}</button>
      <span className="badge badge-ok authoritative-mode-chip">Secure data</span>
      <span className="user-chip authoritative-user-chip" aria-label="Signed-in user"><span className="user-av" aria-hidden="true">A</span><span className="user-nm">Signed in</span><button type="button" className="link-btn" onClick={onSignOut}>Sign out</button></span>
    </div>
  </header>;
}
