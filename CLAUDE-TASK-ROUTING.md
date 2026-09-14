# Codex ↔ Claude task routing

## Authoritative task location

Codex writes new Claude tasks at the repository root, using this exact name
pattern:

```text
TASK-TO-CLAUDE-YYYY-MM-DD-<TOPIC>.md
```

Claude must scan **the root of the checkout actually mounted in its session**,
not a `.wt` child worktree and not an unrelated stale checkout.  Run this
read-only discovery command at the start of each cycle:

```powershell
Get-ChildItem -LiteralPath . -File -Filter 'TASK-TO-CLAUDE-*.md' |
  Sort-Object LastWriteTime,Name |
  Select-Object Name,LastWriteTime,Length
```

Then read the newest task whose matching completion receipt is absent.

## Required acknowledgement

Before claiming that no task exists, Claude must write one short root-level
receipt with this pattern:

```text
CLAUDE-ACK-YYYY-MM-DD-<TOPIC>.md
```

It must state only:

1. the absolute mounted checkout path;
2. current `git rev-parse HEAD` if Git is available;
3. the exact task filename read;
4. available capabilities (`read`, `write`, `git`, `node`, `docker`);
5. any blocking condition.

## Deliverables back to Codex

Claude writes a root-level result file named:

```text
CLAUDE-TO-CODEX-YYYY-MM-DD-<TOPIC>.md
```

The result must contain the task filename, files inspected or changed, exact
commands and exit codes, concrete findings, and limits.  It must never claim
production deployment, live WBS/QBO access, real posting, or role changes
without separately verifiable evidence.

## Boundaries

- WBS and QBO are read-only reference systems.
- Do not change production records, access roles, secrets, paid Render
  resources, or deployment settings.
- If the mounted checkout lacks `server/`, review only files actually present
  and report the mounted path.  Do not invent test results or inspect another
  checkout.
- If the Linux mount prevents `git`, `node`, or `npm`, perform only the
  explicitly assigned read/reasoning/document task and record that limitation.

## Current Codex task index

The active tasks are:

- `TASK-TO-CLAUDE-2026-09-13-AUTHORITATIVE-ENTRY-READONLY-REVIEW.md`
- `TASK-TO-CLAUDE-2026-09-13-MIGRATION-AND-CONTAINER-GATE-REVIEW.md`
- `TASK-TO-CLAUDE-2026-09-13-RENDER-PRODUCTION-ACCEPTANCE.md`

If none of these files are visible in Claude's mounted root, Claude must
report that absolute path in an acknowledgement instead of treating a stale
directory as the authoritative task queue.
