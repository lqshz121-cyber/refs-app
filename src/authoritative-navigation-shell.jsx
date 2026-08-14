import React from 'react';
import { Icon } from './ui.jsx';

const RAIL_LABELS = Object.freeze({ Administration: 'Admin' });

function railLabel(label) {
  return RAIL_LABELS[label] || label.split(/\s+/)[0] || label;
}

function compactLabel(label) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

// These are deliberately a presentation map, copied from the complete REFS
// shell's icon vocabulary.  They do not decide route availability or carry
// any accounting state: `navigation` remains the authoritative API catalog.
const GROUP_ICONS = Object.freeze([
  'gauge', 'gear', 'document', 'cycle', 'document', 'book',
  'layers', 'calendar', 'wallet', 'bars', 'shield',
]);

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
      <button type="button" className="new-btn authoritative-new-disabled" disabled aria-disabled="true"
        title="No authorised create action is available in this workspace">+ New</button>
      <nav aria-label={`${activeGroup.label} navigation`}>
        <div className={`nav-panel-group nav-tone-${activeGroupIndex % 6}`}>
          <div className="nav-panel-title">{activeGroup.label}</div>
          <div className="nav-group-items" id={`authoritative-navigation-group-${activeGroupIndex}`}>
          {activeGroup.items.map(item => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
            className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} onClick={() => onSelectItem(item.route)}>
            <span className="nav-badge" aria-hidden="true">{compactLabel(item.label)}</span>
            <span className="nav-item-label">{item.label}</span>
            <span className={`authoritative-nav-status authoritative-nav-status-${item.availability === 'API_READ' ? 'ready' : 'blocked'}`}
              title={item.availability === 'API_READ' ? 'Authoritative API read available' : 'This workspace is unavailable for the current authority'}>
              {item.availability === 'API_READ' ? 'API' : 'Unavailable'}
            </span>
            <span className="nav-chev" aria-hidden="true">›</span>
          </button>)}
          </div>
        </div>
      </nav>
    </div>
  </aside>;
}
