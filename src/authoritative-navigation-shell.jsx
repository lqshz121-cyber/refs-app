import React from 'react';

export function AuthoritativeNavigationShell({ navigation, route, expandedGroup, onSelectGroup, onSelectItem, navOpen, navDrawerRef, drawerAttributes, onClose }) {
  return <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar authoritative-sidebar ${navOpen ? 'mobile-open' : ''}`} {...drawerAttributes}>
    <div className="brand"><span className="logo" aria-hidden="true">◇</span> REFS<span className="brand-sub">Authoritative</span></div>
    {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>Close</button>}
    <nav aria-label="Authoritative accounting navigation">
      {navigation.map((group, index) => {
        const multiple = group.items.length > 1;
        const expanded = multiple && expandedGroup === group.label;
        const active = group.items.some(item => route === item.route);
        const panelId = `authoritative-navigation-group-${index}`;
        return <section className={`nav-group authoritative-nav-group nav-tone-${index % 6} ${active ? 'nav-group-active' : ''}`} key={group.label}>
          <button type="button" className="nav-group-h" aria-current={!multiple && active ? 'page' : undefined}
            aria-expanded={multiple ? expanded : undefined} aria-controls={multiple ? panelId : undefined}
            onClick={() => onSelectGroup(group)}><span className="nav-ic" aria-hidden="true">●</span>{group.label}</button>
          {multiple && expanded && <div id={panelId} className="nav-group-items">
            {group.items.map(item => <button type="button" key={item.route} aria-current={route === item.route ? 'page' : undefined}
              className={`nav-item nav-sub ${route === item.route ? 'nav-on' : ''}`} onClick={() => onSelectItem(item.route)}>
              <span>{item.label}</span><span className={`authoritative-nav-status authoritative-nav-status-${item.availability === 'API_READ' ? 'ready' : 'blocked'}`}>{item.availability === 'API_READ' ? 'API' : 'Unavailable'}</span>
            </button>)}
          </div>}
        </section>;
      })}
    </nav>
  </aside>;
}
