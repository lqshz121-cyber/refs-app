export function retainActiveNavigationGroup(openGroups, groups, route) {
  const activeGroup = groups.find(group =>
    group.items.length > 1 && group.items.some(([key]) => key === route)
  );
  if (!activeGroup || openGroups[activeGroup.group]) return openGroups;
  return {...openGroups, [activeGroup.group]: true};
}

export function toggleNavigationGroup(openGroups, groupName) {
  return {...openGroups, [groupName]: !openGroups[groupName]};
}
