import React from 'react';
import { Icon } from './ui.jsx';

const GROUP_SHORT_LABELS = Object.freeze({
  'Control Center':'Control',
  'Accounting Settings':'Settings',
  'Source & Staging':'Source',
  'Auto Reconciliation':'Auto',
  'Journal Entry':'Journal',
  'General Ledger':'General',
  'Accounting Operations':'Operations',
  'Close':'Close',
  'Payables & Receivables':'Payables',
  'Reports & Analytics':'Reports',
  'Administration':'Admin',
});

function railLabel(label) {
  return GROUP_SHORT_LABELS[label] || label;
}

// These are deliberately a presentation map using the complete REFS shell's
// icon vocabulary. They do not decide route availability or carry
// any accounting state: `navigation` remains the authoritative API catalog.
const GROUP_ICONS = Object.freeze({
  'Control Center':'gauge',
  'Accounting Settings':'gear',
  'Source & Staging':'document',
  'Auto Reconciliation':'cycle',
  'Journal Entry':'document',
  'General Ledger':'book',
  'Accounting Operations':'layers',
  Close:'calendar',
  'Payables & Receivables':'wallet',
  Reports:'bars',
  Administration:'shield',
});
const ITEM_ICONS = Object.freeze({
  overview:'gauge', approvals:'check', 'ai-audit':'shield', 'ai-je-workbench':'document', 'accounting-analysis-report':'bars',
  settings:'gear', rules:'check', mapping:'layers',
  'wbs-payable-review':'document', staging:'layers', 'source-documents':'document', receipts:'inbox', 'integration-hub':'cycle', 'mapping-exceptions':'shield',
  'bank-batch-pipeline':'bank', 'wbs-autorec-evidence':'cycle', bank:'bank', reconciliation:'check', 'checks-payments':'wallet',
  journals:'document', 'general-ledger':'book', consolidation:'layers', 'account-inquiry':'lines', 'subsidiary-ledger':'book', 'chart-of-accounts':'lines',
  'project-cost-cwip':'bars', 'unit-cost-ledger':'bars', 'unit-transfer':'exchange', 'construction-loan':'bank', 'loan-register':'book',
  'property-ops-pickup':'wallet', 'closing-accounting':'calendar', intercompany:'exchange', 'recurring-transactions':'cycle', 'revenue-recognition':'calendar', 'fixed-assets':'layers', amortization:'cycle', accruals:'document',
  'month-end-close':'calendar', 'period-management':'calendar', payables:'wallet', vendors:'users', 'bill-payments':'wallet', contractors:'users', '1099s':'document', receivables:'inbox', reports:'bars',
  'master-data':'layers', 'bank-accounts':'bank', 'my-accountant':'users', 'audit-log':'shield', 'users-settings':'gear',
});

export function AuthoritativeNavigationShell({ navigation, route, expandedGroups, expandedGroup, onSelectGroup, onSelectItem, navOpen, navDrawerRef, drawerAttributes, onClose, panelCollapsed = false, onTogglePanel }) {
  const activeGroup = navigation.find(group => group.items.some(item => item.route === route))
    || navigation.find(group => group.label === (Array.isArray(expandedGroups) ? expandedGroups[0] : expandedGroup))
    || navigation[0];
  const opensDirectly = activeGroup?.items.length === 1;
  const desktopPanelCollapsed = !opensDirectly && panelCollapsed;
  const canTogglePanel = !opensDirectly && typeof onTogglePanel === 'function';
  return <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar authoritative-sidebar ${opensDirectly ? 'authoritative-sidebar-direct' : ''} ${desktopPanelCollapsed ? 'authoritative-sidebar-panel-collapsed' : ''} ${navOpen ? 'mobile-open' : ''}`} {...drawerAttributes}>
    <div className="nav-rail" aria-label="Accounting workspace groups">
      <div className="rail-logo" aria-hidden="true">R</div>
      {navigation.map((group, index) => {
        const active = group.label === activeGroup.label;
        const direct = group.items.length === 1;
        return <div key={group.label} className={`nav-group nav-tone-${index % 6}`}>
          <button type="button"
            className={`nav-group-h ${active ? 'rail-on' : ''}`}
            aria-current={direct && active ? 'page' : undefined}
            aria-expanded={!direct ? active && !desktopPanelCollapsed : undefined}
            aria-controls={!direct && active ? 'authoritative-navigation-active-group' : undefined}
            aria-label={group.label}
            onClick={() => onSelectGroup(group)}>
            <span className="rail-glyph" aria-hidden="true"><Icon name={GROUP_ICONS[group.label] || 'document'} /></span>
            <span className="rail-label" aria-hidden="true">{railLabel(group.label)}</span>
          </button>
        </div>;
      })}
    </div>
    <div className="nav-panel">
      <div className="brand"><span className="logo" aria-hidden="true">R</span><span className="brand-name">REFS</span><span className="brand-sub">Authoritative</span>
        {canTogglePanel && <button type="button" className="desktop-nav-panel-toggle"
          aria-label={`${desktopPanelCollapsed ? 'Expand' : 'Collapse'} navigation panel`}
          aria-expanded={!desktopPanelCollapsed} aria-controls="authoritative-navigation-active-group"
          onClick={onTogglePanel}>
          <Icon name={desktopPanelCollapsed ? 'chevron-right' : 'chevron-left'} size={18}/>
        </button>}
      </div>
      {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>Close</button>}
      {!opensDirectly && <nav aria-label="Accounting workspace navigation">
        {activeGroup && <section className={`nav-panel-group nav-tone-${Math.max(0,navigation.indexOf(activeGroup)) % 6}`}>
          <div className="nav-panel-title"><span>{activeGroup.label}</span></div>
          <div className="nav-group-items" id="authoritative-navigation-active-group">
          {activeGroup.items.map(item => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
            className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} onClick={() => onSelectItem(item.route)} title={item.label}>
            <span className="nav-badge" aria-hidden="true"><Icon name={ITEM_ICONS[item.route] || 'document'} size={18}/></span>
            <span className="nav-item-label">{item.label}</span>
            <span className="nav-chev" aria-hidden="true">›</span>
          </button>)}
          </div>
        </section>}
      </nav>}
    </div>
  </aside>;
}
