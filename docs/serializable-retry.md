# Bounded retries for transient PostgreSQL conflicts

Concurrent context issuance can exhaust a short, synchronized retry schedule
even when the authorization request is valid. The shared transaction helper
now allows seven retries after the initial attempt and uses randomized delays
bounded by 500 ms. Only PostgreSQL serialization failures (`40001`) and
deadlocks (`40P01`) are eligible.

Every attempt starts a new serializable transaction. Failed attempts roll back
and release the client before the delay. Authorization denials, validation
errors and other database errors propagate immediately. The final failure
remains the original database error; no synthetic success is returned.

Deterministic tests exercise transaction cleanup, the maximum attempt count,
delay bounds and non-transient rejection. The PostgreSQL regression issues 128
authorized reads in eight batches of sixteen through a formal role and real
context issuer, then verifies all contexts are bound to the expected tenant
and transaction. This is a concurrency regression, not evidence that all
production traffic or application performance requirements have been met.
