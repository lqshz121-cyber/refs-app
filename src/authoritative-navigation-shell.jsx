import React from 'react';
import { Icon } from './ui.jsx';

function railLabel(label) {
  return label.split(/\s+/)[0] || label;
}

// These are deliberately a presentation map, copied from the complete REFS
// shell's icon vocabulary.  They do not decide route availability or carry
// any accounting state: `navigation` remains the authoritative API catalog.
const GROUP_ICONS = Object.freeze([
  'gauge', 'gear', 'document', 'cycle', 'document', 'book',
  'layers', 'calendar', 'wallet', 'bars', 'shield',
]);
// Page marks are deliberately semantic rather than alphabetical.  A finance
// reader should be able to scan the navigation by purpose without learning a
// private set of initials such as "WPR" or "IH".
const ITEM_ICON_BY_ROUTE = Object.freeze({
  overview: 'gauge', approvals: 'check', 'ai-audit': 'shield', 'ai-je-workbench': 'document',
  settings: 'gear', rules: 'layers', mapping: 'exchange',
  'wbs-payable-review': 'document', staging: 'layers', 'source-documents': 'inbox',
  'integration-hub': 'exchange', 'mapping-exceptions': 'shield',
  'bank-batch-pipeline': 'bank', 'wbs-autorec-evidence': 'cycle', bank: 'wallet',
  reconciliation: 'check', 'checks-payments': 'document', journals: 'document',
  'general-ledger': 'book', consolidation: 'layers', 'account-inquiry': 'lines',
  'subsidiary-ledger': 'book', 'chart-of-accounts': 'lines',
  'project-cost-cwip': 'bars', 'unit-cost-ledger': 'bars', 'unit-transfer': 'exchange',
  'construction-loan': 'bank', 'loan-register': 'book', 'property-ops-pickup': 'wallet',
  'closing-accounting': 'calendar', intercompany: 'exchange', 'fixed-assets': 'layers',
  amortization: 'calendar', accruals: 'document', 'month-end-close': 'calendar',
  'period-management': 'calendar', payables: 'wallet', receivables: 'wallet',
  reports: 'bars', 'master-data': 'layers', 'bank-accounts': 'bank', 'audit-log': 'shield',
  'users-settings': 'gear',
});

export function AuthoritativeNavigationShell({ navigation, route, expandedGroup, onSelectGroup, onSelectItem, navOpen, navDrawerRef, drawerAttributes, onClose }) {
  const activeGroup = navigation.find(group => group.items.some(item => item.route === route))
    || navigation.find(group => group.label === expandedGroup)
    || navigation[0];
  const activeGroupIndex = navigation.indexOf(activeGroup);

  return <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar authoritative-sidebar ${navOpen ? 'mobile-open' : ''}`} {...drawerAttributes}>
    <div className="nav-rail" aria-label="Accounting workspace groups">
      <div className="rail-logo" aria-hidden="true">R</div>
      {navigation.map((group, index) => {
        const active = group.label === activeGroup.label;
        return <div key={group.label} className={`nav-group nav-tone-${index % 6}`}>
          <button type="button"
            className={`nav-group-h ${active ? 'rail-on' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={group.label}
            onClick={() => onSelectGroup(group)}>
            <span className="rail-glyph" aria-hidden="true"><Icon name={GROUP_ICONS[index] || 'document'} /></span>
            <span className="rail-label" aria-hidden="true">{railLabel(group.label)}</span>
          </button>
        </div>;
      })}
    </div>
    <div className="nav-panel">
      <div className="brand"><span className="logo" aria-hidden="true">R</span> REFS<span className="brand-sub">Authoritative</span></div>
      {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>Close</button>}
      <nav aria-label={`${activeGroup.label} navigation`}>
        <div className={`nav-panel-group nav-tone-${activeGroupIndex % 6}`}>
          <div className="nav-panel-title">{activeGroup.label}</div>
          <div className="nav-group-items" id={`authoritative-navigation-group-${activeGroupIndex}`}>
          {activeGroup.items.map(item => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
            className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} title={item.label} onClick={() => onSelectItem(item.route)}>
            <span className="nav-badge" aria-hidden="true"><Icon name={ITEM_ICON_BY_ROUTE[item.route] || 'document'} size={18}/></span>
            <span className="nav-item-label">{item.label}</span>
            <span className="nav-chev" aria-hidden="true">›</span>
          </button>)}
          </div>
        </div>
      </nav>
    </div>
  </aside>;
}
