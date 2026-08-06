import { useId, useMemo, useState } from 'react';
import { money } from './engine.js';

// ---------------------------------------------------------------------------
// Icon set. Self-authored 24px stroke glyphs on a 0 0 24 24 grid, drawn to the
// geometry recorded in docs/QB-SHELL-STRUCTURE.md. No third-party icon asset
// is copied or referenced; every path below is written here.
// ---------------------------------------------------------------------------
const ICON_PATHS = {
  gauge:      ['M12 20.5a8.5 8.5 0 1 1 8.5-8.5', 'M20.5 12a8.46 8.46 0 0 1-2.49 6.01', 'M12 12l4.2-3.1'],
  gear:       ['M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z', 'M12 3.2v2.4M12 18.4v2.4M3.2 12h2.4M18.4 12h2.4', 'M5.8 5.8l1.7 1.7M16.5 16.5l1.7 1.7M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7'],
  inbox:      ['M4 14.5v4a1.5 1.5 0 0 0 1.5 1.5h13a1.5 1.5 0 0 0 1.5-1.5v-4', 'M12 3.8v10.4', 'M8.3 10.5L12 14.2l3.7-3.7'],
  cycle:      ['M4.4 10.2a7.8 7.8 0 0 1 13.2-3.6l2 2', 'M19.6 3.6v5h-5', 'M19.6 13.8a7.8 7.8 0 0 1-13.2 3.6l-2-2', 'M4.4 20.4v-5h5'],
  document:   ['M5.2 4.4h8.6l5 5v10.2a.5.5 0 0 1-.5.5H5.2a.5.5 0 0 1-.5-.5V4.9a.5.5 0 0 1 .5-.5z', 'M13.8 4.4V9.4h5', 'M8.4 13.6h7.2M8.4 16.6h4.6'],
  lines:      ['M4.4 6.2h15.2M4.4 10.6h15.2M4.4 15h9.4M4.4 19.4h9.4'],
  layers:     ['M12 3.6l8 4.2-8 4.2-8-4.2z', 'M4 12.1l8 4.2 8-4.2', 'M4 16.3l8 4.2 8-4.2'],
  calendar:   ['M5.2 5.6h13.6a1 1 0 0 1 1 1v12.2a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V6.6a1 1 0 0 1 1-1z', 'M8.4 3.4v4M15.6 3.4v4M4.2 10.4h15.6', 'M9.2 14.6l2.2 2.2 3.6-3.8'],
  bars:       ['M4 20h16', 'M7.4 20v-6.2M12 20V6.6M16.6 20v-9.4'],
  shield:     ['M12 3.6l7 2.7v5c0 4.1-2.8 7.3-7 9.1-4.2-1.8-7-5-7-9.1v-5z', 'M9.1 12.1l2.2 2.2 3.9-4.2'],
  exchange:   ['M4.4 8.6h13', 'M13.9 5.1l3.5 3.5-3.5 3.5', 'M19.6 15.4h-13', 'M10.1 11.9l-3.5 3.5 3.5 3.5'],
  book:       ['M4.6 5.2A1.6 1.6 0 0 1 6.2 3.6H19v14.2H6.2a1.6 1.6 0 0 0-1.6 1.6z', 'M4.6 19.4a1.6 1.6 0 0 1 1.6-1.6H19v2.6H6.2a1.6 1.6 0 0 1-1.6-1.6z', 'M8.4 7.6h6.8'],
  wallet:     ['M4.4 7.6a1.6 1.6 0 0 1 1.6-1.6h12a1.6 1.6 0 0 1 1.6 1.6v10a1.6 1.6 0 0 1-1.6 1.6H6a1.6 1.6 0 0 1-1.6-1.6z', 'M4.4 10.6h15.2', 'M15.4 14.6h1.8'],
  bank:       ['M3.8 9.6L12 4.6l8.2 5', 'M5.6 9.6v8.2M10 9.6v8.2M14 9.6v8.2M18.4 9.6v8.2', 'M3.8 20.2h16.4'],
  check:      ['M5.6 12.4l4 4 8.8-9'],
};
export function Icon({name, size=24, className}) {
  const paths = ICON_PATHS[name] || ICON_PATHS.document;
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {paths.map((d,i)=><path key={i} d={d}/>)}
  </svg>;
}

export function Card({children, className='', onClick, hover}) {
  const interactive = typeof onClick === 'function';
  return <div className={`card ${hover?'card-hover':''} ${className}`} onClick={onClick}
    role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined}
    onKeyDown={interactive ? event=>{ if(event.key==='Enter'||event.key===' '){ event.preventDefault(); onClick(event); } } : undefined}>{children}</div>;
}
export function KPI({label, value, sub, tone}) {
  return <div className={`kpi ${tone||''}`}>
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {sub!=null && <div className="kpi-sub">{sub}</div>}
  </div>;
}
export function Btn({children, onClick, variant='default', size, disabled, title, ariaLabel}) {
  // A disabled action also reports aria-disabled so an unavailable reference
  // action is announced as unavailable, not merely painted as unavailable.
  return <button type="button" className={`btn btn-${variant} ${size?'btn-'+size:''}`} onClick={onClick}
    disabled={disabled} aria-disabled={disabled?'true':undefined} title={title} aria-label={ariaLabel}>{children}</button>;
}
// Segmented control for queue / view switching: a white item on a gray track.
// Counts render inside the label, e.g. "Pending (12)".
export function Segmented({options, value, onChange, label}) {
  return <div className="seg" role="tablist" aria-label={label}>{options.map(option => {
    const key = typeof option === 'string' ? option : option.value;
    const text = typeof option === 'string' ? option : option.label;
    const count = typeof option === 'string' ? null : option.count;
    const on = value === key;
    return <button type="button" key={key} role="tab" aria-selected={on} className={on?'on':''}
      onClick={()=>onChange(key)}>{count==null ? text : `${text} (${count})`}</button>;
  })}</div>;
}
// ---------------------------------------------------------------------------
// Workflow marks. Tone is a three-way colour split; the workflow has five
// stages, and a reader with a colour vision deficiency cannot separate
// "Approved" from "Posted" by hue at all. Each recognised stage therefore also
// gets a mark GEOMETRY (see index.html section 7): ring / half ring / filled
// circle / square / bar. Unrecognised badge content - source system codes,
// severities, "READ ONLY" - keeps the plain dot and is unaffected.
// ---------------------------------------------------------------------------
const STATUS_SHAPE = {
  DRAFT:'draft',
  PENDING:'progress', PENDING_REVIEW:'progress', PENDING_APPROVAL:'progress',
  IN_PROGRESS:'progress', OPEN:'progress', PARTIAL:'progress', UNMATCHED:'progress',
  APPROVED:'approved', MATCHED:'approved', DONE:'approved', BALANCED:'approved',
  SIGNED_OFF:'approved', PAID:'approved', RESOLVED:'approved', CLOSED:'approved',
  POSTED:'posted',
  REVERSED:'reversed', VOID:'reversed', REJECTED:'reversed', FAILED:'reversed',
  OUT_OF_BALANCE:'reversed',
};
const STATUS_TONE = {
  POSTED:'ok', APPROVED:'ok', MATCHED:'ok', DONE:'ok', BALANCED:'ok', SIGNED_OFF:'ok', PAID:'ok', RESOLVED:'ok',
  CLOSED:'muted', WAIVED:'muted', DRAFT:'muted',
  PENDING:'warn', PENDING_REVIEW:'warn', PENDING_APPROVAL:'warn', IN_PROGRESS:'warn', UNMATCHED:'warn', OPEN:'warn', PARTIAL:'warn',
  REJECTED:'bad', REVERSED:'bad', OUT_OF_BALANCE:'bad', FAILED:'bad', HIGH:'bad', MEDIUM:'warn', LOW:'muted', VOID:'bad',
};
export function Badge({children, tone}) {
  const t = tone || STATUS_TONE[children] || 'muted';
  const shape = typeof children === 'string' ? STATUS_SHAPE[children] : null;
  return <span className={`badge badge-${t}${shape ? ' badge-s-' + shape : ''}`}>{children}</span>;
}
export function Money({v, bold, nil}) {
  // Money is the shared sans face with tabular numerals, not a monospace font.
  // Three readings, never collapsed into one (round 3):
  //   a figure        $1,204.00 / ($1,204.00)
  //   a real zero     $0.00, quieter, but unmistakably a figure
  //   no figure       an en dash, announced as "no amount", which can never be
  //                   read as a balance of zero.
  // `nil` marks a column that does not apply to this row (the credit side of a
  // debit line), which is a different fact from a recorded zero.
  if (nil || v == null) {
    return <span className="num num-nil" title="No amount" aria-label="No amount">{'–'}</span>;
  }
  const neg = v < 0;
  const zero = v === 0;
  return <span className={`num ${neg?'num-neg':''} ${zero?'num-zero':''} ${bold?'num-bold':''}`}>{money(v)}</span>;
}
// ---------------------------------------------------------------------------
// One state language for every workspace. There are exactly four states and
// each one has a single rendering: nothing else may invent its own.
//   loading    - a read is in flight; announced politely, aria-busy set
//   error      - a read failed; announced assertively as an alert
//   empty      - the read succeeded and returned nothing in scope
//   permission - the reader is not entitled to this scope, or a required
//                scope (e.g. an entity) has not been selected
//   cleared    - the read succeeded and a FINITE WORK QUEUE returned nothing,
//                which is an outcome rather than an absence. It is only valid
//                where the queue really is work that gets finished; it says
//                nothing about whether a period is closed, reconciled or
//                posted, and like every other state it carries no control.
// `title` is the headline, `children` the explanation, `actions` an optional
// row of real navigation. A StateBlock never carries a disabled control.
// ---------------------------------------------------------------------------
export const STATE_CLASS = {
  loading: 'empty empty-state state-block state-loading',
  error: 'err-box state-block state-error',
  empty: 'empty empty-state state-block state-empty',
  permission: 'empty empty-state report-entity-required state-block state-permission',
  cleared: 'empty empty-state state-block state-empty state-cleared',
};
export function StateBlock({tone='empty', title, children, actions, label, className=''}) {
  const cls = `${STATE_CLASS[tone] || STATE_CLASS.empty}${className ? ' ' + className : ''}`;
  return <div className={cls} role={tone==='error' ? 'alert' : 'status'}
    aria-label={label} aria-live={tone==='error' ? 'assertive' : 'polite'}
    aria-busy={tone==='loading' ? 'true' : undefined}>
    {title && <b>{title}</b>}
    {children}
    {actions ? <div className="row-acts state-block-acts">{actions}</div> : null}
  </div>;
}

// A capability that can never execute on this page is a statement of fact, not
// a control. It renders as a non-focusable chip that carries its own reason,
// never as a <button>, so no reader can queue a click that will never run.
// This is the pattern already used by the bank workspace action lists.
export function Unavailable({children, reason}) {
  return <span className="unavailable-chip" aria-disabled="true">
    <span className="unavailable-name">{children}</span>
    {reason ? <span className="unavailable-why">{reason}</span> : null}
  </span>;
}

// ---------------------------------------------------------------------------
// A queue tile states two facts, not one: how much work is LEFT, and how much
// is already DONE. "3 remaining" reads as a chore; "3 remaining of 41" reads as
// progress. Both figures must be derivable from records already in scope - the
// tile refuses to draw a meter when `total` is not a positive number, rather
// than inventing a denominator. When the queue is empty the tile reads as an
// accomplishment (check mark, positive tone) instead of a bare zero.
// It states a count. It claims nothing about approval, posting or closing.
// ---------------------------------------------------------------------------
export function QueueTile({label, remaining, done, total, onOpen}) {
  const hasMeter = Number.isFinite(total) && total > 0 && Number.isFinite(done);
  const clear = remaining === 0;
  const pct = hasMeter ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : 0;
  const spoken = hasMeter
    ? `${label}: ${remaining} remaining, ${done} of ${total} done`
    : `${label}: ${remaining} remaining`;
  const open = typeof onOpen === 'function' ? onOpen : undefined;
  return <div className={`todo-item${clear ? ' is-clear' : ''}`} onClick={open}
    role={open ? 'button' : undefined} tabIndex={open ? 0 : undefined} aria-label={spoken}
    onKeyDown={open ? e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); open(e); } } : undefined}>
    <span className={`todo-n ${clear ? 'ok' : 'warn'}`} aria-hidden="true">{clear ? '✓' : remaining}</span>
    <span className="todo-l" aria-hidden="true">{label}</span>
    {hasMeter && <span className="todo-meter" aria-hidden="true"><span style={{width:pct+'%'}}/></span>}
    {hasMeter && <span className="todo-done" aria-hidden="true">
      {clear ? `All ${total} done` : `${done} of ${total} done`}
    </span>}
  </div>;
}

// A loading table is drawn at the geometry of the table it will become - same
// 40px header, same 44px rows, same wrapper border - so the page does not jump
// when the read resolves. The sweep is a background-position animation and is
// switched off entirely by prefers-reduced-motion (index.html section 9).
export function TableSkeleton({cols = 5, rows = 6, label = 'Loading records'}) {
  const spec = Array.isArray(cols) ? cols : Array.from({length:cols}, ()=>({}));
  const cell = (c, i) => <span key={i}
    className={`skel-cell${c && c.num ? ' skel-num' : ''}${i === 0 ? ' skel-wide' : ''}`}/>;
  return <div className="table-wrap" role="status" aria-live="polite" aria-busy="true" aria-label={label}>
    <div className="skel-table" aria-hidden="true">
      <div className="skel-head">{spec.map(cell)}</div>
      {Array.from({length:rows}, (_, r)=><div className="skel-row" key={r}>{spec.map(cell)}</div>)}
    </div>
  </div>;
}

// ================= Enterprise Data Grid =================
// sort / text filter / CSV export / pagination / density / row click
const _loadView = (k)=>{ try{ return JSON.parse(localStorage.getItem('refs_view_'+k))||{}; }catch(e){ return {}; } };
const _saveView = (k,v)=>{ try{ localStorage.setItem('refs_view_'+k, JSON.stringify(v)); }catch(e){} };
export function Table({cols, rows, onRow, empty='No records to display.', emptyTone='empty', rowKey, features={}, pageSize=25, exportName, loading, error}) {
  const V = exportName ? _loadView(exportName) : {};
  const {sortable=true, filterable=rows&&rows.length>8, exportable=!!exportName, paginate=rows&&rows.length>pageSize} = features;
  const [sortK, setSortK] = useState(V.sortK??null);
  const [sortDir, setSortDir] = useState(V.sortDir??1);
  const [q, setQ] = useState(V.q||'');
  const [page, setPage] = useState(0);
  const [dense, setDense] = useState(!!V.dense);
  const [hi, setHi] = useState(-1);
  // Pointer position and keyboard position are different facts. `kb` records
  // which one last moved, so the accent keyboard row is only painted when the
  // keyboard actually put it there and never follows the mouse pointer.
  const [kb, setKb] = useState(false);
  const persist = (patch)=>{ if(exportName) _saveView(exportName, {sortK,sortDir,q,dense,...patch}); };

  const cellVal = (r,c) => { if (c.sortVal) return c.sortVal(r); if (c.k!=null) return r[c.k]; if (c.render){ const v=c.render(r); return typeof v==='string'||typeof v==='number'? v : ''; } return ''; };
  const filtered = useMemo(()=>{
    if (!q) return rows||[];
    const s = q.toLowerCase();
    return (rows||[]).filter(r => cols.some(c => String(cellVal(r,c)??'').toLowerCase().includes(s)) || JSON.stringify(r).toLowerCase().includes(s));
  },[rows,q,cols]);
  const sorted = useMemo(()=>{
    if (sortK==null) return filtered;
    const c = cols[sortK];
    return [...filtered].sort((a,b)=>{ const x=cellVal(a,c), y=cellVal(b,c);
      if (typeof x==='number'&&typeof y==='number') return (x-y)*sortDir;
      return String(x??'').localeCompare(String(y??''))*sortDir; });
  },[filtered,sortK,sortDir,cols]);
  const pages = Math.max(1, Math.ceil(sorted.length/pageSize));
  const view = paginate ? sorted.slice(page*pageSize,(page+1)*pageSize) : sorted;

  const doExport = () => {
    const head = cols.map(c=>c.h);
    const data = sorted.map(r=>cols.map(c=>{ const v=c.csv?c.csv(r):cellVal(r,c); return v==null?'':v; }));
    const csv=[head,...data].map(row=>row.map(c=>{const s=String(c);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n');
    const blob=new Blob(["\uFEFF"+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(exportName||'export')+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  if (error) return <StateBlock tone="error" title="This view could not load">{error}</StateBlock>;
  if (loading) return <TableSkeleton cols={cols} rows={Math.min(pageSize, 6)}
    label={exportName ? `Loading ${exportName} records` : 'Loading records'}/>;
  if (!rows || rows.length===0) return <StateBlock tone={emptyTone}>{empty}</StateBlock>;
  return <div>
    {(filterable||exportable) && <div className="grid-bar">
      {filterable && <input className="grid-search" aria-label="Search table records" placeholder="Search this view" value={q} onChange={e=>{setQ(e.target.value); setPage(0); persist({q:e.target.value});}}/>}
      <span className="grid-count muted">{sorted.length} records</span>
      <span style={{flex:1}}/>
      <button type="button" className="grid-tool" onClick={()=>{setDense(d=>{persist({dense:!d}); return !d;});}} title="Change row density" aria-label={`Use ${dense?'comfortable':'compact'} table density`}>{dense?'Comfortable':'Compact'}</button>
      {exportable && <button type="button" className="grid-tool" onClick={doExport} aria-label="Export table as CSV">Export CSV</button>}
    </div>}
    <div className={`table-wrap ${exportName?'table-'+exportName.replace(/[^a-z0-9_-]/gi,'-').toLowerCase():''}`} role="region" aria-label={exportName ? `${exportName} table` : 'Records table'} tabIndex={0} onKeyDown={e=>{ if(!view.length) return;
      if(e.key==='ArrowDown'){ e.preventDefault(); setHi(h=>Math.min(view.length-1,h+1)); }
      if(e.key==='ArrowUp'){ e.preventDefault(); setHi(h=>Math.max(0,h-1)); }
      if(e.key==='Enter' && hi>=0 && onRow){ e.preventDefault(); onRow(view[hi]); }
    }} onKeyDownCapture={e=>{ if(e.key==='ArrowDown'||e.key==='ArrowUp') setKb(true); }}
      onMouseMove={()=>{ if(kb) setKb(false); }}><table className={`tbl ${dense?'tbl-dense':''}`}>
      <thead><tr>{cols.map((c,i)=>
        <th key={i} className={c.num?'ta-r':''} style={c.w?{width:c.w}:null} aria-sort={sortK===i ? (sortDir>0?'ascending':'descending') : 'none'}>
          {sortable ? <button type="button" className="th-sort" onClick={()=>{ if(sortK===i){ setSortDir(d=>{persist({sortK:i,sortDir:-d}); return -d;}); } else {setSortK(i); setSortDir(1); persist({sortK:i,sortDir:1});} }} aria-label={`Sort by ${c.h}${sortK===i ? sortDir>0?', ascending':', descending' : ''}`}>
            {c.h}{sortK===i && <span className="sort-ind" aria-hidden="true">{sortDir>0?' ▲':' ▼'}</span>}
          </button> : c.h}
        </th>)}</tr></thead>
      <tbody>{view.map((r,ri)=>
        <tr key={rowKey?r[rowKey]:ri} className={`${onRow?'tr-click':''} ${hi===ri?(kb?'tr-kb':'tr-hi'):''}`}
          onClick={onRow?()=>onRow(r):null} onMouseEnter={()=>setHi(ri)}>
          {cols.map((c,ci)=>{ const v = c.render?c.render(r):r[c.k];
            // Truncated columns keep their full text reachable via a tooltip;
            // the untruncated string always stays in the accessibility tree.
            const t = (typeof v==='string'||typeof v==='number') ? String(v) : undefined;
            return <td key={ci} className={c.num?'ta-r':''} title={t}>{v}</td>; })}
        </tr>)}
      </tbody>
    </table></div>
    {paginate && <div className="grid-pager">
      <button type="button" className="grid-tool" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button>
      <span className="muted" aria-live="polite">Page {page+1} of {pages}</span>
      <button type="button" className="grid-tool" disabled={page>=pages-1} onClick={()=>setPage(p=>p+1)}>Next</button>
    </div>}
  </div>;
}

export function Drawer({open, onClose, title, children, width=480, actions}) {
  const titleId = useId();
  if (!open) return null;
  return <div className="drawer-scrim" onClick={onClose}>
    <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{width}} onClick={e=>e.stopPropagation()}>
      <div className="drawer-head"><div id={titleId} className="drawer-title">{title}</div><button type="button" className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="drawer-body">{children}</div>
      {actions && <div className="drawer-foot">{actions}</div>}
    </div>
  </div>;
}
export function Tabs({tabs, active, onChange}) {
  return <div className="tabs" role="tablist">{tabs.map(t=>
    <button type="button" key={t} role="tab" aria-selected={active===t} className={`tab ${active===t?'tab-on':''}`} onClick={()=>onChange(t)}>{t}</button>)}</div>;
}
export function Field({label, children, hint, error, required}) {
  return <div className={`field ${error?'field-err':''}`}>
    <label>{label}{required && <span className="req">*</span>}</label>
    {children}
    {error ? <div className="field-msg err">{error}</div> : hint ? <div className="field-msg">{hint}</div> : null}
  </div>;
}
export function Toast({msg, tone}) {
  if (!msg) return null;
  return <div className={`toast toast-${tone||'ok'}`} role="status" aria-live="polite">{msg}</div>;
}
export function SectionTitle({children, right}) {
  return <div className="sec-title"><h3>{children}</h3>{right}</div>;
}
export function ApprovalTimeline({steps}) {
  return <div className="appr-tl">{steps.map((s,i)=>
    <div key={i} className={`appr-step ${s.done?'appr-done':''}`}>
      <span className="appr-dot"/>{s.label}<span className="muted sm">{s.who?` · ${s.who}`:''}{s.at?` · ${s.at}`:''}</span>
    </div>)}</div>;
}
