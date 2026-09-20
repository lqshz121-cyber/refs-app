// X06: stop undefined task ids from re-appearing as false gaps in an exhaustive scan.
//
// codex011 section D dispatched "Staging/环境线：L01–L13、L22、L27". L27 is not defined anywhere:
// the L task book (codex010) defines L01..L24 only, and the five lines of section D already cover
// all 24 without it, so it adds no coverage. An exhaustive receipt scan therefore reported a
// permanent phantom gap that no amount of work could close.
//
// This file declares the authoritative id ranges once, and asserts that governance documents
// tracked in this repository never reference an id outside them. It cannot police untracked
// dispatch files, so the ranges below are the durable record: a future scanner should read them
// rather than infer the ranges from whatever documents happen to be present.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

// Authoritative series, from the task books that define them.
const SERIES={
  T:{max:18, book:'TASK-TO-CLAUDE-2026-09-16-BATCH-P0-P1-codex003.md'},
  N:{max:40, book:'CODEX-TO-CLAUDE-2026-09-16-ALL-T01-T18-REVIEW-AND-NEXT-codex005.md (N01-N10) + TASK-TO-CLAUDE-2026-09-16-MASSIVE-N11-N40-codex006.md'},
  S:{max:45, book:'TASK-TO-CLAUDE-2026-09-16-THREE-DAY-LAUNCH-SPRINT-codex007.md'},
  R:{max:30, book:'TASK-TO-CLAUDE-2026-09-17-NEXT-R01-R30-codex009.md'},
  L:{max:24, book:'TASK-TO-CLAUDE-2026-09-17-STAGING-L01-L24-codex010.md'},
  H:{max:11, book:'TASK-TO-CLAUDE-2026-09-17-TEN-HOUR-STAGING-AND-DATA-SPRINT-codex-root.md'},
  O:{max:12, book:'TASK-TO-CLAUDE-2026-09-17-SYSTEM-OPTIMIZATION-AND-REAL-DATA-CLOSURE-codex-root.md'},
  P:{max:15, book:'TASK-TO-CLAUDE-2026-09-17-SECOND-SYSTEM-CLOSURE-BATCH-codex-root.md'},
  Q:{max:16, book:'TASK-TO-CLAUDE-2026-09-17-THIRD-QUALITY-OPERATIONS-BATCH-codex-root.md'},
  X:{max:6,  book:'TASK-TO-CLAUDE-2026-09-20-P0-EXECUTION-CLOSURE-codex-root.md'}
};
// R31..R54 are round numbers from the 2026-09 handoff series, not task ids; they are excluded
// from the R series deliberately so a scan does not treat them as undelivered tasks.
const NON_TASK_R_ROUNDS={min:31,max:54};

const docs=['../../ACCEPTANCE-TRACEABILITY-MATRIX.md','../../CURRENT-SHA-ACCEPTANCE-HANDOFF.md']
  .map(rel=>new URL(rel,import.meta.url))
  .filter(u=>existsSync(u));

test('X06-1: the authoritative series ranges are declared, so an exhaustive scan has a source of truth',()=>{
  for(const [letter,{max,book}] of Object.entries(SERIES)){
    assert.ok(Number.isInteger(max)&&max>0,`${letter} must declare a positive max`);
    assert.ok(typeof book==='string'&&book.length>0,`${letter} must name the book that defines it`);
  }
  // The specific defect this file exists for.
  assert.equal(SERIES.L.max,24,'the L series ends at L24; codex011 referencing L27 was a typo, not a missing task');
});

test('X06-2: tracked governance documents never reference a task id outside its declared range',()=>{
  // Guard against the check passing because it found no documents to check.
  assert.ok(docs.length>0,'no governance document was found to scan; the paths are wrong and this test would pass vacuously');
  const offenders=[];
  for(const url of docs){
    const text=readFileSync(url,'utf8');
    const name=url.pathname.split('/').pop();
    for(const m of text.matchAll(/\b([THNSRLOPQX])(\d{2})\b/g)){
      const letter=m[1], n=Number(m[2]);
      const series=SERIES[letter];
      if(!series)continue;
      if(letter==='R'&&n>=NON_TASK_R_ROUNDS.min&&n<=NON_TASK_R_ROUNDS.max)continue;  // round number
      if(n<1||n>series.max)offenders.push(`${name}: ${m[0]} is outside ${letter}01..${letter}${String(series.max).padStart(2,'0')}`);
    }
  }
  assert.deepEqual([...new Set(offenders)],[],
    `governance documents must not reference undefined task ids:\n${[...new Set(offenders)].join('\n')}`);
});

test('X06-3: the L27 phantom is recorded so it is not re-raised',()=>{
  // A scan that finds "L27 referenced, no receipt" should land here and stop, rather than
  // re-opening the question or inventing an L27 deliverable.
  const record=new URL('../../CHANGE-RECORD-L27.md',import.meta.url);
  assert.ok(existsSync(record),'the L27 change record must exist');
  const text=readFileSync(record,'utf8');
  assert.match(text,/L27/,'the record must name the id it resolves');
  assert.match(text,/typo|笔误/i,'the record must state the disposition');
  assert.match(text,/L01[^\n]*L24/,'the record must state the real range');
});
