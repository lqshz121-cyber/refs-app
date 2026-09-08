# Exact asset posting audit selection

Migration 340 replaces only the asset movement reader. The posting-audit lookup requires the same tenant, company, journal identity, JOURNAL_POSTED event, JOURNAL_ENTRY object, POST action, GL.JE.POST permission, posting actor, and USER actor type used by the standard PostgreSQL posting workflow. Same-named events with a different object, action, permission or actor cannot supply or inflate the posting audit count.

The down migration restores the 339 reader and leaves all retained accounting and audit rows untouched. New PostgreSQL tests add unrelated audit events to an owned formal posting fixture, compare every returned ledger movement to the real Journal API wire response using the browser journal contract, and verify the reader down/up definition and execution privilege. This is real database/API contract evidence; it is not live browser or full asset module acceptance.
