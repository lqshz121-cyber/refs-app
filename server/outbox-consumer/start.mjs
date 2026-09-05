import pg from 'pg';
import { readConfig } from './contract.mjs';
import { ConsumerRepository } from './repository.mjs';
import { createConsumerServer } from './server.mjs';

let pool;
try {
  const config = readConfig(process.env);
  pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 5000, query_timeout: 7000, application_name: 'refs-outbox-consumer' });
  pool.on('error', () => console.error(JSON.stringify({ event: 'outbox_consumer_database_error' })));
  const repository = new ConsumerRepository(pool, config);
  await repository.ready();
  const server = createConsumerServer({ repository, config });
  server.listen(config.port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'outbox_consumer_started', release: config.release })));
  let stopping = false;
  const shutdown = () => {
    if (stopping) return; stopping = true;
    const deadline = setTimeout(() => process.exit(1), 20000); deadline.unref();
    server.close(async () => { await pool.end(); clearTimeout(deadline); });
    server.closeIdleConnections();
  };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
} catch {
  console.error(JSON.stringify({ event: 'outbox_consumer_start_failed', code: 'OUTBOX_CONSUMER_CONFIG_OR_DATABASE_INVALID' }));
  await pool?.end(); process.exitCode = 1;
}
