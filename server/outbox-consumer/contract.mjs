import { createHash, timingSafeEqual } from 'node:crypto';
import { safeOutboxPayload } from '../runtime/outbox-wire-contract.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const KEYS = ['aggregate_id','aggregate_type','attempt_count','created_at','entity_id','event_type','outbox_event_id','payload','payload_hash','schema_version','tenant_id'];
export const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys);
export function validateEvent(event, { tenantId, entityId }, headers) {
  if (!exact(event, KEYS) || event.schema_version !== 'REFS_OUTBOX_EVENT_V1') throw failure('OUTBOX_EVENT_INVALID');
  for (const key of ['tenant_id','entity_id','aggregate_id','outbox_event_id']) if (!UUID.test(event[key])) throw failure('OUTBOX_EVENT_INVALID');
  if (event.tenant_id !== tenantId || event.entity_id !== entityId) throw failure('OUTBOX_SCOPE_DENIED', 403);
  for (const key of ['aggregate_type','event_type']) if (typeof event[key] !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(event[key])) throw failure('OUTBOX_EVENT_INVALID');
  if (!SHA.test(event.payload_hash) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload) || !Number.isSafeInteger(event.attempt_count) || event.attempt_count < 1) throw failure('OUTBOX_EVENT_INVALID');
  if (typeof event.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.created_at) || !Number.isFinite(Date.parse(event.created_at)) || new Date(event.created_at).toISOString() !== event.created_at) throw failure('OUTBOX_EVENT_INVALID');
  if (headers['idempotency-key'] !== event.outbox_event_id || headers['x-refs-payload-hash'] !== event.payload_hash) throw failure('OUTBOX_HEADER_MISMATCH');
  if (!safeOutboxPayload(event.payload)) throw failure('OUTBOX_SECRET_DENIED');
  return event;
}
export function readConfig(env) {
  // A consumer must never be launched with accounting authority accidentally attached.
  for (const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL','OUTBOX_CONSUMER_ADMIN_DATABASE_URL']) if (env[key]) throw failure('OUTBOX_CONSUMER_AUTHORITY_INVALID');
  const { OUTBOX_CONSUMER_DATABASE_URL: databaseUrl, OUTBOX_CONSUMER_TOKEN: token, OUTBOX_CONSUMER_TENANT_ID: tenantId, OUTBOX_CONSUMER_ENTITY_ID: entityId, OUTBOX_CONSUMER_DATABASE_NAME: databaseName } = env;
  let url; try { url = new URL(databaseUrl); } catch { throw failure('OUTBOX_CONSUMER_CONFIG_INVALID'); }
  if (!['postgres:','postgresql:'].includes(url.protocol) || !/^refs_outbox_consumer_[a-z0-9_]+$/.test(databaseName || '') || decodeURIComponent(url.pathname.slice(1)) !== databaseName || !UUID.test(tenantId || '') || !UUID.test(entityId || '') || !/^[A-Za-z0-9._~+/=-]{32,4096}$/.test(token || '')) throw failure('OUTBOX_CONSUMER_CONFIG_INVALID');
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw failure('OUTBOX_CONSUMER_CONFIG_INVALID');
  return { databaseUrl, databaseName, token, tenantId, entityId, port, release: /^[0-9a-f]{40}$/.test(env.RENDER_GIT_COMMIT || '') ? env.RENDER_GIT_COMMIT : null };
}
export function authorized(header, token) {
  if (typeof header !== 'string' || header.length > 4103) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header), digest(`Bearer ${token}`));
}
export const receipt = event => ({ schema_version: 'REFS_OUTBOX_PUBLISH_RECEIPT_V1', accepted: true, outbox_event_id: event.outbox_event_id, payload_hash: event.payload_hash });
