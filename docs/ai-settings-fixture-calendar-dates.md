# AI settings fixture calendar dates

The approved entity-period settings fixture read PostgreSQL DATE columns as JavaScript Date objects, then used toISOString to build its parent and child snapshot dates. In Asia/Shanghai, the driver's local-midnight value for 2026-07-01 becomes 2026-06-30 in UTC. The database correctly rejects that snapshot as inconsistent with its accounting period. The UTC CI runner did not expose the fixture error.

The fixture now selects explicit YYYY-MM-DD strings from PostgreSQL and uses those strings in period-close, tax coverage and parent settings. It asserts the seeded July boundaries before creating snapshots. Production date handling and snapshot validation are unchanged. The affected real PostgreSQL scenario must pass with TZ=Asia/Shanghai; this does not retroactively make an earlier failed full suite pass.
