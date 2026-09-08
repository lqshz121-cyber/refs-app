# Payment candidate query order

The 100,001-payment benchmark exposed a mismatch between the page limit and actual database work. On local PostgreSQL 16, three API pages took 11,916ms against the 5,000ms gate. The same tree passed the remote PostgreSQL 15 gate at 3,421ms, but its owner-role plan visited all 100,001 matching occurrences and roughly two million shared buffers before returning the first 101 candidates. A faster runner did not remove that scaling problem.

Forward migration 325 keeps migration 324 and its response contract intact. It puts per-occurrence business/journal/cash-line/ledger verification behind a correlated lateral query with an OFFSET 0 planning boundary. PostgreSQL can start from the ordered occurrence index without flattening this into a ledger-first join over the full population. An inclusive indexed cursor lower bound plus exact-cursor exclusion retains strict keyset semantics, including a null first-page cursor.

The outer page limit still applies after all evidence checks. No fixed number of unverified occurrences is preselected, so invalid or already-matched occurrences cannot hide later valid candidates. The down migration restores the prior function without deleting data or dropping the existing candidate index.

The benchmark now captures per-page timing and owner-role plans before asserting the combined time limit. For this dense fixture, it also rejects plans visiting more than 1,010 payment/journal/line/ledger rows at any scan node for a 100-row page. This checks actual work even on a fast runner. The threshold is specific to the dense fixture and is not a claim that arbitrary sparse candidate populations require constant work.

Local full root/server tests, build and migration checks passed. On fresh PostgreSQL 16, the complete 061 bank-payment lifecycle and 100,001-record scenario both passed with zero skips. First/second/deep API pages took 1,391ms / 592ms / 297ms (2,280ms combined). The first-page owner-role plan took 6.703ms and visited 101 occurrences, with at most 202 journal-line visits at a scan node and 2,837 shared-buffer hits. The deep plan took 0.264ms. These are local synthetic-fixture measurements, not production latency guarantees.

PostgreSQL 15 validation and full database regression remain in progress. The prior PostgreSQL 15 baseline also failed at 11,494ms for three pages; its first plan took 6,406ms and visited every payment. The prior failures and execution plans remain preserved rather than being superseded by a claim of production completion.
