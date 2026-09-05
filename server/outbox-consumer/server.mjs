import http from 'node:http';
import { authorized, failure, validateEvent } from './contract.mjs';

export function createConsumerServer({ repository, config }) {
  const respond = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && ['/health/live','/health/ready'].includes(req.url)) {
        if (req.url.endsWith('/ready')) await repository.ready();
        respond(res, 200, { status: 'ok', release: config.release }); return;
      }
      if (req.url !== '/outbox/events' || req.method !== 'POST') throw failure('NOT_FOUND', 404);
      if (!authorized(req.headers.authorization, config.token)) throw failure('AUTHENTICATION_REQUIRED', 401);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '') || req.headers['content-encoding']) throw failure('UNSUPPORTED_MEDIA_TYPE', 415);
      if (Number(req.headers['content-length'] || 0) > 1000000) throw failure('OUTBOX_EVENT_TOO_LARGE', 413);
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1000000) throw failure('OUTBOX_EVENT_TOO_LARGE', 413);
        chunks.push(chunk);
      }
      let event; try { event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw failure('INVALID_JSON'); }
      validateEvent(event, config, req.headers);
      const result = await repository.accept(event);
      respond(res, 200, result);
    } catch (error) {
      if (!req.complete) req.resume();
      respond(res, Number.isInteger(error.status) ? error.status : 503, { code: error.status ? error.code : 'OUTBOX_CONSUMER_UNAVAILABLE' });
      // Rejects never reflect the request, credential, database error or payload.
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.timeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}
