export const REFS_BUSINESS_SCOPE = Object.freeze({
  included: Object.freeze([
    'Local expense, bill, vendor, and payment evidence',
    'Local tenant, owner, and related-party receivables and receipts',
    'Bank transactions, reconciliation, general ledger, trial balance, and aging',
    'Property, project, asset, loan, and close controls',
  ]),
  excluded: Object.freeze([
    'External app connections and integration hubs',
    'Marketplace and ecommerce sales channels',
    'Online payment processors, payment links, and payouts',
    'Spreadsheet synchronization, external storage, and bulk sync',
  ]),
});

export function isBusinessCapabilityExcluded(label) {
  const normalized = String(label || '').toLowerCase();
  return [
    'integration', 'external app', 'connect data', 'amazon', 'marketplace',
    'sales channel', 'online payment', 'payment link', 'payout',
    'spreadsheet sync', 'google sheets', 'excel', 'external storage', 'bulk sync',
  ].some(term => normalized.includes(term));
}
