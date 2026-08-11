import React from 'react';

function compactLabel(label) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function railLabel(label) {
  return label.split(/\s+/)[0] || label;
}

export function AuthoritativeNavigationShell({ navigation, route, expandedGroup, onSelectGroup, onSelectItem, navOpen, navDrawerRef, drawerAttributes, onClose }) {
  const activeGroup = navigation.find(group => group.label === expandedGroup)
    || navigation.find(group => group.items.some(item => item.route === route))
    || navigation[0];
  const activeGroupIndex = navigation.indexOf(activeGroup);

  return <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar authoritative-sidebar ${navOpen ? 'mobile-open' : ''}`} {...drawerAttributes}>
    <div className="nav-rail" aria-label="Accounting workspace groups">
      <div className="rail-logo" aria-hidden="true">R</div>
      {navigation.map((group, index) => {
        const active = group.label === activeGroup.label;
        return <button type="button" key={group.label}
          className={`nav-group-h nav-tone-${index % 6} ${active ? 'rail-on' : ''}`}
          aria-current={active ? 'page' : undefined}
          aria-label={group.label}
          onClick={() => onSelectGroup(group)}>
          <span className="rail-glyph" aria-hidden="true">{compactLabel(group.label)}</span>
          <span className="rail-label" aria-hidden="true">{railLabel(group.label)}</span>
        </button>;
      })}
    </div>
    <div className="nav-panel">
      <div className="brand"><span className="logo" aria-hidden="true">R</span> REFS<span className="brand-sub">Authoritative</span></div>
      {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>Close</button>}
      <div className="authoritative-nav-heading">
        <span className={`authoritative-nav-heading-mark nav-tone-${activeGroupIndex % 6}`} aria-hidden="true">{compactLabel(activeGroup.label)}</span>
        <div><span className="authoritative-nav-eyebrow">Workspace</span><strong>{activeGroup.label}</strong></div>
      </div>
      <nav aria-label={`${activeGroup.label} navigation`}>
        <div className="nav-group-items" id={`authoritative-navigation-group-${activeGroupIndex}`}>
          {activeGroup.items.map((item, index) => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
            className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} onClick={() => onSelectItem(item.route)}>
            <span className="nav-badge" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="nav-item-label">{item.label}</span>
            <span className={`authoritative-nav-status authoritative-nav-status-${item.availability === 'API_READ' ? 'ready' : 'blocked'}`}>{item.availability === 'API_READ' ? 'API' : 'Unavailable'}</span>
            <span className="nav-chev" aria-hidden="true">&gt;</span>
          </button>)}
        </div>
      </nav>
    </div>
  </aside>;
}
