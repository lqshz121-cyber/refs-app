# PostgreSQL JSON evidence readers

Seven analysis readers returned PostgreSQL driver rows around a `SETOF jsonb` value instead of the evidence object expected by their callers: prepaid balance reconciliation, fixed asset depreciation gaps, posted asset reconciliation, disposal gaps, post-disposal depreciation, impairment assessments and posted impairment reconciliation. Each now gives the selected JSON column the alias `data` and returns its value. The schedule reader received the same correction with migration 353.

This changes only the repository result shape. SQL source selection, scope checks, permissions, evidence hashes, accounting amounts and analysis rules remain unchanged. Bank/GL and security deposit readers already unpack their named JSON columns and are unchanged.

Eight repository tests exercise driver-shaped JSON results, preserving decimal strings, nested evidence, ordering and empty lists. Fresh PostgreSQL verification checks populated posted-asset and impairment results through a real runtime session, alongside the schedule-to-detector test. This does not certify all analysis findings end to end; full controller and release regression remain required after integration.
