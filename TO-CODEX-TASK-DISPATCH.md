# Codex to Claude Task Dispatch

This file defines how Codex assigns bounded REFS work to Claude. Claude's scheduled job discovers `TASK-TO-CLAUDE-*.md` files from the repository.

## Ownership

Claude may work on:

- frontend interaction and visual consistency;
- accounting-rule analysis and regression tests;
- read-only WBS finance/MCP contracts and data mapping;
- AI Audit review workflows;
- build, deployment, and evidence automation.

Codex remains the integration and release owner. Claude must work on an isolated branch and return a commit SHA, changed files, test commands with exit codes, risks, and the next action. Claude must not push directly to `main`, force-push, or mix unrelated changes.

## Required accounting boundaries

- WBS is an existing upstream system. Do not recreate WBS business modules or write to WBS.
- WBS integration is read-only: signed/enveloped data may enter receipt, Raw, Normalized, Staging/Exception, mapping review, and evidence flows.
- WBS, MCP, AI, and Auto Reconciliation may never create, approve, dispatch, or post a journal entry directly.
- Journal entries follow Draft -> Review -> Approve -> Post with segregation of duties, idempotency, immutable posted evidence, audit history, and reversal-only correction.
- Missing source, ambiguous mapping, cross-entity scope, unsupported currency, changed replay, or incomplete evidence must fail closed as Review/Exception.
- User-visible text must be English-only and free of mojibake.
- Details replace the workspace and provide an explicit Back action that restores entity, dates, filters, dimensions, selection, and pagination.
- Do not add export, external connection, payment rail, auto-match, auto-categorize, auto-post, or destructive actions unless a task explicitly supplies an approved authoritative contract.

## Task file format

Create `TASK-TO-CLAUDE-YYYY-MM-DD-NNN.md` with:

- priority and owner category;
- frozen base SHA and isolated branch name;
- exact scope and excluded files/actions;
- acceptance criteria;
- required commands and exit-code expectations;
- completion block: SHA/base, files, tests+exit, risks, status, next.

## Workflow

1. Codex commits and pushes task files.
2. Claude fetches and selects an unclaimed task.
3. Claude records `CLAIMED` with its branch and base SHA before implementation.
4. Claude implements only the stated scope, runs focused and repository gates, and commits to its branch.
5. Claude records a completion handoff. It does not merge or publish.
6. Codex independently reviews, integrates, reruns release gates, and decides whether to deploy.

## Release rules

- Never claim production equivalence from mock, local simulation, screenshots, or static contracts.
- Never commit credentials, tokens, provider rows, cookies, or secrets.
- A failing or unavailable required gate is reported accurately; it is not converted into a pass.
- Existing dirty files belong to their owner and must not be staged accidentally.
