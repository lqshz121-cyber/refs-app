// Canonical catalog of operational events the REFS kernel emits as structured
// JSON lines, with the alert each one drives. This is the local contract that
// stands in for a SaaS monitor: every `event:'...'` the runtime logs must be
// listed here (tests/observability-contract.test.mjs enforces it), every entry
// names its level, the fields operators may rely on, and the alert rule.
//
// Levels: info (audit trail only), warn (page during business hours), error
// (page immediately). Fields listed are the ones guaranteed safe to log - no
// amounts, no tenant names, no tokens; ids only.

export const EVENT_CATALOG=Object.freeze([
  // ---- process lifecycle ---------------------------------------------------
  {event:'accounting_server_started',level:'info',fields:['release_sha','port'],alert:'none'},
  {event:'accounting_server_stopping',level:'info',fields:['signal'],alert:'more than 3 in 10 minutes -> crash loop, page'},
  {event:'outbox_dispatch_ready',level:'info',fields:['scope_count'],alert:'none'},
  {event:'outbox_dispatch_stopping',level:'info',fields:['signal'],alert:'as server stopping'},
  {event:'attachment_cleanup_stopping',level:'info',fields:['signal'],alert:'as server stopping'},
  // ---- migrations (pre-deploy) --------------------------------------------
  {event:'migration_runner_started',level:'info',fields:['command','statement_timeout_ms'],alert:'none'},
  {event:'migration_started',level:'info',fields:['migration_name','direction'],alert:'none'},
  {event:'migration_runner_completed',level:'info',fields:[],alert:'absence within the deploy window after runner_started -> abort deploy'},
  {event:'migration_failed',level:'error',fields:['migration_name','direction','code','position','where'],alert:'any occurrence -> abort deploy, page release owner'},
  {event:'migration_runner_failed',level:'error',fields:['code'],alert:'any occurrence -> abort deploy'},
  {event:'database_idle_client_error',level:'warn',fields:['code'],alert:'> 10 per hour -> managed Postgres is dropping idle connections faster than the pool recycles them; check idle timeout / keepalive. Any occurrence proves the pool error listener is doing its job (the process must NOT exit).'},
  {event:'migration_ledger_ahead',level:'error',fields:['schema_head','release_head','unknown_migrations'],alert:'any occurrence -> a build older than the database was deployed (rollback past a migration); do not start it, redeploy the newer build or restore the pre-migration backup'},
  {event:'migration_reset_blocked',level:'warn',fields:['schema_head','applied_count','first_irreversible_migration'],alert:'any occurrence outside a test database -> someone ran reset against a real database, investigate'},
  // ---- authentication / authorization --------------------------------------
  {event:'accounting_access_failure',level:'warn',fields:['code','stage','route_class'],alert:'> 20 per minute per tenant, or any 42501 burst from one actor -> possible probing'},
  // ---- database ------------------------------------------------------------
  {event:'accounting_database_timeout',level:'error',fields:['stage','code'],alert:'> 3 per 5 minutes -> page; correlates with lock waits on posting/period tables'},
  {event:'database_dictionary_exported',level:'info',fields:['catalog_sha256','relation_count'],alert:'catalog_sha256 differs from the release manifest value -> schema drift, block release'},
  {event:'database_dictionary_export_failed',level:'error',fields:['code'],alert:'any -> release evidence incomplete'},
  // ---- outbox / integration -------------------------------------------------
  {event:'outbox_dispatch_scope_failed',level:'error',fields:['scope','code'],alert:'any -> dead-letter risk, page integration owner'},
  {event:'outbox_dispatch_start_failed',level:'error',fields:['code'],alert:'any -> consumer down'},
  {event:'outbox_dispatch_stop_failed',level:'warn',fields:['code'],alert:'any -> possible lease leak, check reclaim on next start'},
  {event:'outbox_dispatch_unhealthy',level:'error',fields:['reason'],alert:'2 consecutive -> page'},
  {event:'attachment_cleanup_scope_failed',level:'error',fields:['scope','code'],alert:'any -> orphaned objects accumulate; retention breach risk'}
]);

// Metrics derived from the database, not from logs. Each is a single SQL the
// scraper runs on the runtime login every interval; thresholds are alert rules.
export const DB_METRICS=Object.freeze([
  {metric:'outbox_pending',sql:"SELECT count(*) FROM outbox_event WHERE status='PENDING'",threshold:'> 500 for 10 min -> warn; > 5000 -> page'},
  {metric:'outbox_failed',sql:"SELECT count(*) FROM outbox_event WHERE status='FAILED'",threshold:'> 0 for 15 min -> page (dead letters need a human)'},
  {metric:'idempotency_in_progress_stale',sql:"SELECT count(*) FROM idempotency_receipt WHERE status='IN_PROGRESS' AND created_at<now()-interval '10 minutes'",threshold:'> 0 -> warn; a command died mid-flight'},
  {metric:'live_unbound_contexts',sql:"SELECT count(*) FROM runtime_auth_context WHERE bound_backend_pid IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()",threshold:'> 100 -> warn (retry leak, see T06)'},
  {metric:'approved_unposted_journals',sql:"SELECT count(*) FROM journal_entry WHERE status='APPROVED'",threshold:'> 50 for 24h -> warn (posting backlog blocks period close)'},
  {metric:'posted_into_closed_period',sql:"SELECT count(*) FROM journal_entry j JOIN accounting_period p ON p.period_id=j.period_id WHERE j.status='POSTED' AND p.status<>'OPEN' AND j.posted_at>p.closed_at",threshold:'> 0 -> page; accounting control breach'},
  {metric:'ap_control_out_of_balance',sql:"SELECT count(*) FROM refs_ap_ar_control_reconciliation WHERE NOT in_balance",threshold:'> 0 -> page; subledger != GL'},
  {metric:'attachments_pending_scan_old',sql:"SELECT count(*) FROM attachment WHERE finalization_status='PENDING' AND uploaded_at<now()-interval '1 hour'",threshold:'> 0 -> warn (scanner stalled)'},
  {metric:'migration_ledger_hash',sql:"SELECT encode(sha256(convert_to(string_agg(migration_name||':'||checksum,',' ORDER BY migration_name),'UTF8')),'hex') FROM refs_schema_migration",threshold:'differs from release manifest -> page'}
]);

// Events the kernel should emit but does not yet (gap list, not enforced).
export const MISSING_EVENTS=Object.freeze([
  {event:'serializable_retry_exhausted',where:'runtime/db.mjs withSerializableRetry',why:'7 retries on 40001 then throw is invisible; 60% of 40001 are deterministic CAS conflicts (N39)'},
  {event:'posting_refused',where:'kernel postJournal catch',why:'55000/42501/23514 on post are the accounting control signals; today only HTTP status is visible'},
  {event:'period_closed / period_reopened',where:'kernel closePeriod/reopenPeriod',why:'CRITICAL permission actions should be operator-visible, not only audit rows'},
  {event:'http_request',where:'accounting-server request handler',why:'no access log with request_id, status, latency; correlation with audit_event.request_id is impossible from logs'}
]);
