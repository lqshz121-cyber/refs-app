// R09: accounting-period status contract.
//
// `period_status` is declared as ENUM('OPEN','SOFT_CLOSED','CLOSED') in
// 001_wbs_accounting_core.sql, but the kernel only ever transitions OPEN <-> CLOSED.
// No command writes SOFT_CLOSED, and `refs_reopen_period_v1` only accepts a retained
// CLOSED period, so a SOFT_CLOSED row (which can only arrive by a privileged direct
// write or a data import) is a terminal dead end: every posting path rejects it with
// SQLSTATE 55000 and no command can move it back out.
//
// The approved-settings layer meanwhile does define distinct SOFT_CLOSED semantics
// (soft_lock=true / hard_lock=false), so the two models disagree. This module pins the
// current, observed behaviour so any change to it has to be deliberate.
//
// Everything here is a pure function over migration SQL text: no database required.

export const PERIOD_STATUS_VALUES=Object.freeze(['OPEN','SOFT_CLOSED','CLOSED']);

/** Statuses the kernel is able to persist through a command, keyed by the writing function. */
export const PERIOD_STATUS_WRITERS=Object.freeze({
  refs_close_period:Object.freeze(['CLOSED']),
  refs_close_period_v2:Object.freeze(['CLOSED']),
  refs_reopen_period_v1:Object.freeze(['OPEN'])
});

/** Status values no command can produce. */
export const UNREACHABLE_PERIOD_STATUSES=Object.freeze(['SOFT_CLOSED']);

/**
 * Observed operation matrix (live PG16, migrations 001..425, synthetic tenant).
 * `sqlstate:null` means the call was admitted past the period gate.
 */
export const PERIOD_STATUS_OPERATION_MATRIX=Object.freeze({
  'GL.JE.CREATE/refs_create_manual_journal':Object.freeze({OPEN:null,SOFT_CLOSED:'55000',CLOSED:'55000'}),
  'AP.BILL.CREATE/refs_create_business_document':Object.freeze({OPEN:null,SOFT_CLOSED:'55000',CLOSED:'55000'}),
  'GL.PERIOD.CLOSE/refs_close_period_v2':Object.freeze({OPEN:null,SOFT_CLOSED:'55000',CLOSED:'55000'}),
  'GL.PERIOD.REOPEN/refs_reopen_period_v1':Object.freeze({OPEN:'55000',SOFT_CLOSED:'55000',CLOSED:null})
});

/** What the approved period-close policy snapshot claims each status means. */
export const SETTINGS_POLICY_EXPECTATION=Object.freeze({
  OPEN:Object.freeze({allow_post:true,posting_lock:false,hard_lock:false,soft_lock:false}),
  SOFT_CLOSED:Object.freeze({allow_post:false,posting_lock:true,hard_lock:false,soft_lock:true}),
  CLOSED:Object.freeze({allow_post:false,posting_lock:true,hard_lock:true,soft_lock:false})
});

const WRITE_RE=/UPDATE\s+accounting_period[\s\S]{0,240}?SET[\s\S]{0,240}?status\s*=\s*'([A-Z_]+)'/gi;
const FUNCTION_RE=/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z0-9_]+)\s*\(/gi;

/** Split one migration body into [{name, body}] chunks, one per CREATE FUNCTION. */
export function splitFunctions(sql){
  const marks=[...sql.matchAll(FUNCTION_RE)].map(m=>({name:m[1],index:m.index}));
  return marks.map((mark,i)=>({
    name:mark.name,
    body:sql.slice(mark.index,i+1<marks.length?marks[i+1].index:sql.length)
  }));
}

/**
 * Every place a migration writes accounting_period.status.
 * @returns {{file:string,fn:string|null,status:string}[]}
 */
export function scanPeriodStatusWriters(files){
  const found=[];
  for(const {file,sql} of files){
    const fns=splitFunctions(sql);
    for(const match of sql.matchAll(WRITE_RE)){
      const owner=fns.filter(f=>f.body && sql.indexOf(f.body)<=match.index).pop();
      const inOwner=owner&&match.index<sql.indexOf(owner.body)+owner.body.length;
      found.push({file,fn:inOwner?owner.name:null,status:match[1]});
    }
  }
  return found;
}

/** Count of `status='OPEN'` / `status<>'OPEN'` period guards across the corpus. */
export function countOpenOnlyGuards(files){
  let equals=0,notEquals=0;
  for(const {sql} of files){
    equals+=(sql.match(/status\s*=\s*'OPEN'/g)||[]).length;
    notEquals+=(sql.match(/status\s*<>\s*'OPEN'/g)||[]).length;
  }
  return {equals,notEquals};
}

/**
 * Any guard that would admit SOFT_CLOSED as a *period row* state, e.g.
 * `v_period.status IN ('OPEN','SOFT_CLOSED')`. jsonb settings-policy checks that merely
 * contain the literal are not period-row guards and are excluded.
 */
export function findPeriodRowGuardsAdmittingSoftClosed(files){
  const hits=[];
  const re=/(?:v_period|period_row|p\.|ap\.|accounting_period)\.?status\s+IN\s*\(([^)]*)\)/gi;
  for(const {file,sql} of files){
    for(const match of sql.matchAll(re)){
      if(/'SOFT_CLOSED'/.test(match[1]))hits.push({file,guard:match[0].slice(0,160)});
    }
  }
  return hits;
}
