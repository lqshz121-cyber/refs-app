// Fixed receipt-signature input shared by the offline release gate and the
// read-only WBS live-acceptance verifier.  The provider signs this exact
// fixed-order UTF-8 representation, rather than a self-described hash alone.
//
// Keep this module free of I/O so validation cannot read provider data, create
// accounting records, or accidentally introduce a transport dependency.
export const WBS_LIVE_RECEIPT_SIGNING_FIELDS = Object.freeze([
  'issuer',
  'kid',
  'algorithm',
  'request_sha256',
  'response_sha256',
  'package_hash',
  'nonce',
  'signed_at',
  'expires_at',
  'tenant_id',
  'entity_id',
  'company_code',
  'immutable_version',
  'nonempty',
]);

export const canonicalWbsLiveReceiptSigningPayload = receipt => JSON.stringify(
  Object.fromEntries(WBS_LIVE_RECEIPT_SIGNING_FIELDS.map(field => [field, receipt?.[field]])),
);

// Receipt timestamps are signed claims, but they still need a local validity
// check before a release gate can accept the evidence.  Keeping this pure and
// shared prevents the offline release gate and the read-only acceptance tool
// from disagreeing about an expired (or implausibly future-dated) receipt.
const RECEIPT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const UTC_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;
const parseUtcInstant = value => {
  if (typeof value !== 'string') return null;
  const match = UTC_INSTANT.exec(value);
  if (match === null) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== `${match[1]}.${match[2] || '000'}Z`) return null;
  return milliseconds;
};

export const isWbsLiveReceiptTimeWindowValid = (receipt, now = Date.now()) => {
  if (!Number.isFinite(now)) return false;
  const signedAt = parseUtcInstant(receipt?.signed_at);
  const expiresAt = parseUtcInstant(receipt?.expires_at);
  return signedAt !== null
    && expiresAt !== null
    && signedAt < expiresAt
    && signedAt <= now + RECEIPT_CLOCK_SKEW_MS
    && expiresAt > now;
};
