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

const ITEM_ICONS = Object.freeze({
  overview:'gauge', approvals:'check', 'ai-audit':'shield', 'ai-je-workbench':'lines',
  settings:'gear', rules:'check', mapping:'layers', 'wbs-payable-review':'document',
  staging:'layers', 'source-documents':'document', 'integration-hub':'exchange',
  'mapping-exceptions':'shield', 'bank-batch-pipeline':'inbox', 'wbs-autorec-evidence':'cycle',
  bank:'bank', reconciliation:'check', 'checks-payments':'wallet', journals:'document',
  'general-ledger':'book', consolidation:'layers', 'account-inquiry':'lines', 'subsidiary-ledger':'book',
  'chart-of-accounts':'book', 'project-cost-cwip':'bars', 'unit-cost-ledger':'lines',
  'unit-transfer':'exchange', 'construction-loan':'bank', 'loan-register':'book',
  'property-ops-pickup':'wallet', 'closing-accounting':'calendar', intercompany:'exchange',
  'fixed-assets':'layers', amortization:'cycle', accruals:'document', 'month-end-close':'calendar',
  'period-management':'calendar', payables:'wallet', receivables:'inbox', reports:'bars',
  'master-data':'layers', 'bank-accounts':'bank', 'audit-log':'shield', 'users-settings':'gear',
});

export function AuthoritativeNavigationShell({ navigation, route, expandedGroups, onSelectGroup, onSelectItem, navOpen, navDrawerRef, drawerAttributes, onClose }) {
  const activeGroup = navigation.find(group => group.items.some(item => item.route === route))
    || navigation[0];
  const expanded = new Set(expandedGroups || []);

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
      <div className="brand"><span className="logo" aria-hidden="true">R</span> REFS<span className="brand-sub">Finance workspace</span></div>
      {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>Close</button>}
      <nav aria-label="Accounting workspace navigation">
        {navigation.map((group, index) => {
          const isExpanded = expanded.has(group.label);
          const isActive = group.label === activeGroup.label;
          const panelId = `authoritative-navigation-group-${index}`;
          return <section className={`nav-panel-group nav-tone-${index % 6} ${isActive ? 'nav-panel-group-active' : ''}`} key={group.label}>
            <button type="button" className="nav-panel-title" aria-expanded={isExpanded} aria-controls={panelId} onClick={() => onSelectGroup(group)}>
              <span>{group.label}</span><Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={16}/>
            </button>
            {isExpanded && <div className="nav-group-items" id={panelId}>
              {group.items.map(item => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
                className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} onClick={() => onSelectItem(item.route)}>
                <span className="nav-badge" aria-hidden="true"><Icon name={ITEM_ICONS[item.route] || 'document'} size={18}/></span>
                <span className="nav-item-label">{item.label}</span><Icon name="chevronRight" size={15} aria-hidden="true"/>
              </button>)}
            </div>}
          </section>;
        })}
      </nav>
    </div>
  </aside>;
}
