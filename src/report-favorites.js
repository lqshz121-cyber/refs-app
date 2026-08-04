export function normalizeReportFavorites(candidate, reportNames = []) {
  const allowed = new Set(reportNames);
  return new Set(Array.isArray(candidate) ? candidate.filter(name => allowed.has(name)) : []);
}

export function toggledReportFavorites(current, reportName, reportNames = []) {
  const next = normalizeReportFavorites([...current], reportNames);
  if (next.has(reportName)) next.delete(reportName); else if (reportNames.includes(reportName)) next.add(reportName);
  return next;
}
