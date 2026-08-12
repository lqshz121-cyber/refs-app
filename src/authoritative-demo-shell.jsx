import React from 'react';

// The complete REFS demo uses this exact topbar hierarchy.  It accepts only
// presentation slots, so authoritative data and commands remain owned by the
// caller and no demonstration state can cross this boundary.
export function AuthoritativeDemoTopbar({
  navOpenerRef, navOpen, onOpenNavigation, entityLabel, periodLabel,
  theme, onToggleTheme, onRefresh, onSignOut,
}) {
  return <header className="topbar authoritative-topbar authoritative-demo-topbar">
    <button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={onOpenNavigation}>☰</button>
    <label className="sw authoritative-shell-scope"><span className="sr-only">Authoritative entity</span><span className="authoritative-shell-select" title={entityLabel}>{entityLabel}</span></label>
    <button type="button" className="cmdk" disabled aria-disabled="true"
      title="Search is unavailable until an authorised server-backed discovery contract exists">⌕ Search or jump</button>
    <div className="top-right authoritative-top-actions">
      <span className="period-chip authoritative-period-chip"><span className="period-label">Period</span><b>{periodLabel}</b><span className="badge badge-ok">API read</span></span>
      <button type="button" className="icon-btn" disabled aria-disabled="true" title="Help is unavailable">?</button>
      <button type="button" className="icon-btn" disabled aria-disabled="true" title="Notifications are unavailable">●</button>
      <button type="button" className="icon-btn" aria-label="Refresh authoritative accounting evidence" title="Refresh authoritative accounting evidence" onClick={onRefresh}>↻</button>
      <button type="button" className="icon-btn" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={theme === 'dark'} onClick={onToggleTheme}>{theme === 'dark' ? '☀' : '◐'}</button>
      <span className="badge badge-ok authoritative-mode-chip"><span aria-hidden="true">●</span> Authoritative</span>
      <span className="user-chip authoritative-user-chip" aria-label="Authenticated OIDC session"><span className="user-av" aria-hidden="true">A</span><span className="user-nm">Authenticated</span><button type="button" className="link-btn" onClick={onSignOut}>Sign out</button></span>
    </div>
  </header>;
}
