# IAM race fixture cleanup

The IAM seal-race fixture creates a uniquely named database and runs the full migration set. Deleting that database can wait for filesystem synchronization on a local Docker volume. The shared test admin pool's default ten-second statement timeout caused SQLSTATE 57014 during that cleanup, obscuring whether the race assertion itself had failed.

Cleanup now borrows one admin connection and applies a bounded ten-minute statement timeout only to deletion of the generated `refs_iam_race_<16 hex digits>_test` database. It restores the prior timeout before returning the connection, or discards the connection if restoration fails. It does not force other database connections to close, change fsync, change runtime query timeouts, or delete the parent fixture database.

If the fixture and cleanup both fail, an AggregateError retains both errors. Successful cleanup still leaves any original fixture error intact. Unit tests exercise the exact database-name boundary, connection and timeout lifecycle, and combined failures. A real isolated PostgreSQL check must also confirm database removal and restoration of the borrowed connection's timeout. This cleanup change does not make an earlier failed full gate pass retroactively; the full affected fixture still requires verification.
