export const RECEIVABLES_BUSINESS_SCOPE = Object.freeze({
  included: Object.freeze([
    'Tenant, owner, and related-party receivable invoices',
    'Local receipt posting against an open invoice',
    'AR aging and source-journal evidence',
  ]),
  excluded: Object.freeze([
    'Online card, ACH, wallet, and payment-processor enrollment',
    'Payment links, recurring payments, sales orders, and sales channels',
    'Marketplace or external payout connections',
  ]),
});

export function isReceivablesCapabilityExcluded(label) {
  const value = String(label || '').toLowerCase();
  return ['payment link', 'recurring payment', 'sales order', 'sales channel', 'online card', 'paypal', 'venmo', 'apple pay', 'marketplace', 'payout'].some(term => value.includes(term));
}
