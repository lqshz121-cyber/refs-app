// Every DROP in a down migration must name something an up migration creates.
//
// WHY THIS EXISTS
// down/371_unit_transfer_paired_reversal.sql shipped a restore-and-drop pair for
// refs_guard_unit_transfer_journal_transition_370(), a shadow copy that no up
// migration has ever created. The down body therefore could never run: it died
// with 42883 "function does not exist" on the first statement that touched it,
// which made migration 371 silently irreversible while reporting a confusing
// missing-object error rather than a stated refusal. The same file also left the
// unit_transfer_paired_reversal_journal_guard trigger and its function behind,
// so a rollback that did somehow reach 371 would have left an active guard on
// journal_entry referencing reversal machinery the same rollback removed.
//
// Neither fault was reachable through `migrate down`, because the unconditional
// barrier in down/401 refuses long before 371 is reached. They only surfaced in
// the kernel tests that apply down bodies directly. That is precisely why this
// check is static: the runtime path that would have caught it is blocked.
//
// down/372_fixed_asset_post_impairment_ai_parity.sql is the shape to copy: it
// checks to_regprocedure(...) IS NULL and raises a stated error before it calls
// pg_get_functiondef, so a missing shadow copy reports what is wrong instead of
// dying on 42883. down/371 omitted that check.
//
// The rule enforced here is symmetry, not reversibility. A migration is free to
// refuse to roll back - down/401 does so unconditionally and forty-three more
// refuse while the evidence they protect exists, all deliberately. What no
// down file may do is reference an object that does not exist.

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';

const upDir = new URL('../db/migrations/', import.meta.url);
const downDir = new URL('../db/migrations/down/', import.meta.url);
const sqlFiles = async dir =>
  (await readdir(dir)).filter(name => /^\d+_.+\.sql$/.test(name)).sort();

const read = async (dir, name) => (await readFile(new URL(name, dir), 'utf8')).replace(/\r\n/g, '\n');

// Names only. Argument lists differ between the CREATE and the DROP often enough
// (DEFAULTs, type aliases) that comparing signatures would produce noise, and a
// wrong-name reference is the failure mode that actually bit us.
const created = async () => {
  const functions = new Set(), tables = new Set(), triggers = new Set();
  for (const name of await sqlFiles(upDir)) {
    const sql = await read(upDir, name);
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_0-9]+)\s*\(/gi)) functions.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_0-9]+)/gi)) tables.add(m[1].toLowerCase());
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([a-z_0-9]+)/gi)) triggers.add(m[1].toLowerCase());
    // Shadow copies are made dynamically: an up body reads pg_get_functiondef of
    // the original and EXECUTEs it with the name rewritten. The new name only
    // ever appears inside a quoted 'public.<name>(' literal, sometimes assigned
    // to a variable several statements before the EXECUTE, so collect every such
    // literal rather than trying to follow the dynamic statement.
    for (const m of sql.matchAll(/'public\.([a-z_0-9]+)\(/gi)) functions.add(m[1].toLowerCase());
  }
  return {functions, tables, triggers};
};

test('no down migration drops or restores a function no up migration creates', async () => {
  const {functions} = await created();
  const offences = [];
  for (const name of await sqlFiles(downDir)) {
    const sql = await read(downDir, name);
    const referenced = new Set();
    for (const m of sql.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_0-9]+)\s*\(/gi)) referenced.add(m[1].toLowerCase());
    // pg_get_functiondef('name(args)'::regprocedure) throws 42883 when absent,
    // which is how 371 failed, so treat a regprocedure literal as a reference.
    for (const m of sql.matchAll(/'([a-z_0-9]+)\([^']*\)'::regprocedure/gi)) referenced.add(m[1].toLowerCase());
    for (const fn of referenced) if (!functions.has(fn)) offences.push(`${name} -> ${fn}()`);
  }
  assert.deepEqual(offences, [], `down migrations reference functions that are never created:\n  ${offences.join('\n  ')}`);
});

test('no down migration drops a table or trigger no up migration creates', async () => {
  const {tables, triggers} = await created();
  const offences = [];
  for (const name of await sqlFiles(downDir)) {
    const sql = await read(downDir, name);
    for (const m of sql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_0-9]+)/gi))
      if (!tables.has(m[1].toLowerCase())) offences.push(`${name} -> table ${m[1]}`);
    for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?([a-z_0-9]+)/gi))
      if (!triggers.has(m[1].toLowerCase())) offences.push(`${name} -> trigger ${m[1]}`);
  }
  assert.deepEqual(offences, [], `down migrations reference objects that are never created:\n  ${offences.join('\n  ')}`);
});

test('every trigger an up migration adds is removed by its own down migration', async () => {
  // The second half of the 371 fault: up/371 added unit_transfer_paired_reversal_journal_guard
  // to journal_entry and its down body never removed it, so rolling the migration
  // back would have left an enforcing trigger pointing at dropped machinery.
  // Only paired files are compared - a trigger legitimately removed by a later
  // migration's down is out of scope here.
  const offences = [];
  for (const name of await sqlFiles(upDir)) {
    const up = await read(upDir, name);
    let down;
    try { down = await read(downDir, name); } catch { continue; }
    // A trigger is gone if the down body drops it by name, drops the table it
    // sits on, or drops its function with CASCADE - down/002 uses the CASCADE
    // idiom for nine guards, so a check that only looked for DROP TRIGGER would
    // report legitimate teardown as a leak. Excusing any file that merely
    // contained a DROP TABLE somewhere, as the first draft did, went too far the
    // other way and let 371 through while it leaked a trigger on journal_entry.
    const addsTrigger = [...up.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+([a-z_0-9]+)([\s\S]{0,600}?);/gi)]
      .map(m => ({
        trigger: m[1],
        table: (m[2].match(/\bON\s+([a-z_0-9.]+)/i) || [,''])[1].replace(/^public\./i, '').toLowerCase(),
        fn: (m[2].match(/EXECUTE\s+(?:PROCEDURE|FUNCTION)\s+([a-z_0-9.]+)/i) || [,''])[1].replace(/^public\./i, '').toLowerCase()
      }));
    const droppedTables = new Set([...down.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_0-9.]+)/gi)]
      .map(m => m[1].replace(/^public\./i, '').toLowerCase()));
    const cascadedFunctions = new Set([...down.matchAll(/DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?([a-z_0-9.]+)[^;]*?CASCADE/gi)]
      .map(m => m[1].replace(/^public\./i, '').toLowerCase()));
    // A down body that refuses to run at all is a deliberate barrier, not a leak.
    if (/RAISE\s+EXCEPTION/i.test(down) && !/DROP\s+TRIGGER/i.test(down)) continue;
    for (const {trigger, table, fn} of addsTrigger) {
      if (new RegExp(`DROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?${trigger}\\b`, 'i').test(down)) continue;
      if (table && droppedTables.has(table)) continue;
      if (fn && cascadedFunctions.has(fn)) continue;
      offences.push(`${name} -> ${trigger}${table ? ` on ${table}` : ''}`);
    }
  }
  assert.deepEqual(offences, [], `up migrations add triggers their own down migration leaves behind:\n  ${offences.join('\n  ')}`);
});
