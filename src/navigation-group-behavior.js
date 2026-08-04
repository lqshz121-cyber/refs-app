// A single-child navigation group is redundant. It is rendered as one direct
// destination rather than an expandable parent plus duplicate child. Count
// destinations rather than labels: a legacy repeated route is still one
// effective child to a user.
export function localVisibleNavigationItems(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter(item => {
    const route = item?.[0];
    if (!route || seen.has(route)) return false;
    seen.add(route);
    return true;
  });
}

export function localNavigationGroupBehavior(items = []) {
  const normalized = localVisibleNavigationItems(items);
  if (normalized.length === 1) return {kind:'DIRECT',route:normalized[0][0],label:normalized[0][1]};
  return {kind:'EXPANDABLE',route:null,label:null};
}
