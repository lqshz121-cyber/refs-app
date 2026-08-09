// Navigation panel open-state.
//
// CONTRACT CHANGE 2026-08-06, at the product owner's direction.
//
// The previous contract kept several groups expanded at once and forbade collapsing
// one group when another was selected. That rule existed for the old single-column
// dark sidebar, where every group shared one scrolling list and auto-collapsing lost
// the reader's place.
//
// The shell is now a persistent 74px icon rail plus a panel. The rail always shows
// every group, so "don't lose your place" is served by the rail itself. Stacking all
// open groups in the panel just concatenated unrelated page lists — selecting
// Reconcile still showed Source & Staging above it.
//
// The panel now lists exactly one group: the active one. The rail keeps the overview.
// Selecting a rail group starts its first visible workspace page.  A rail entry
// is a fresh entry, not a request to reopen whatever child happened to be
// selected last.
//
// Both functions return the *same object reference* when nothing needs to change,
// because retainActiveNavigationGroup runs inside a route-change effect and a fresh
// object every call would re-render forever.

function isOnlyOpenGroup(openGroups, groupName) {
  if (!openGroups[groupName]) return false;
  return Object.keys(openGroups).every(key => key === groupName || !openGroups[key]);
}

export function retainActiveNavigationGroup(openGroups, groups, route) {
  const activeGroup = groups.find(group =>
    group.items.length > 1 && group.items.some(([key]) => key === route)
  );
  // A singleton route (its own rail entry, no child list) must not disturb the panel.
  if (!activeGroup) return openGroups;
  if (isOnlyOpenGroup(openGroups, activeGroup.group)) return openGroups;
  return { [activeGroup.group]: true };
}

export function firstNavigationRoute(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  const firstRoute = items[0]?.[0];
  return typeof firstRoute === 'string' && firstRoute ? firstRoute : null;
}

export function isDirectNavigationGroup(group) {
  return Array.isArray(group?.items) && group.items.length === 1;
}

export function railNavigationContext(group, route) {
  if (typeof route !== 'string' || !route) return null;
  return {
    route,
    navigationEntry: 'rail',
    navigationGroup: group?.group || '',
    navigationDestination: route,
  };
}
