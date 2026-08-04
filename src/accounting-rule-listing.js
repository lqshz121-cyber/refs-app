export function filterAccountingRuleEvidence(rules, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rules;
  return rules.filter((rule) =>
    [rule.id, rule.trigger, rule.logic, rule.priority, rule.appliedTo, rule.conditions, rule.settings, rule.autoPost, rule.status]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle))
  );
}
