import { failure, receipt } from './contract.mjs';

export class ConsumerRepository {
  constructor(pool, config) { this.pool = pool; this.config = config; }
  async ready() {
    const result = await this.pool.query('SELECT refs_outbox_consumer.ready($1,$2,$3) AS ready', [this.config.databaseName, this.config.tenantId, this.config.entityId]);
    if (result.rows.length !== 1 || result.rows[0].ready !== true) throw failure('OUTBOX_CONSUMER_NOT_READY', 503);
    return true;
  }
  async accept(event) {
    // SQL recomputes SHA256 over PostgreSQL canonical jsonb text, identical to
    // accounting refs_jsonb_hash. Never substitute JavaScript sorted JSON here.
    let result;
    try { result = await this.pool.query('SELECT refs_outbox_consumer.accept($1::jsonb) AS receipt', [JSON.stringify(event)]); }
    catch (error) {
      if (error.code === 'P0409') throw failure('OUTBOX_EVENT_CONFLICT', 409);
      if (error.code === 'P0400') throw failure('OUTBOX_PAYLOAD_HASH_INVALID');
      throw failure('OUTBOX_CONSUMER_UNAVAILABLE', 503);
    }
    const expected = receipt(event), actual = result.rows?.[0]?.receipt;
    if (!actual || Object.keys(actual).length !== 4 || Object.keys(expected).some(key => actual[key] !== expected[key])) throw failure('OUTBOX_DURABLE_RECEIPT_INVALID', 503);
    return expected;
  }
}
