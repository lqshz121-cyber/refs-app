import { useId, useMemo, useState } from 'react';
import { money } from './engine.js';

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
const STATUS_TONE = {
  POSTED:'ok', APPROVED:'ok', MATCHED:'ok', DONE:'ok', BALANCED:'ok', SIGNED_OFF:'ok', PAID:'ok', RESOLVED:'ok',
  CLOSED:'muted', WAIVED:'muted', DRAFT:'muted',
  PENDING:'warn', PENDING_REVIEW:'warn', PENDING_APPROVAL:'warn', IN_PROGRESS:'warn', UNMATCHED:'warn', OPEN:'warn', PARTIAL:'warn',
  REJECTED:'bad', REVERSED:'bad', OUT_OF_BALANCE:'bad', FAILED:'bad', HIGH:'bad', MEDIUM:'warn', LOW:'muted', VOID:'bad',
};
export function Badge({children, tone}) {
  const t = tone || STATUS_TONE[children] || 'muted';
  return <span className={`badge badge-${t}`}>{children}</span>;
}
export function Money({v, bold}) {
  // Money is the shared sans face with tabular numerals, not a monospace font.
  const neg = v<0;
  return <span className={`num ${neg?'num-neg':''} ${bold?'num-bold':''}`}>{money(v)}</span>;
}
// One empty / loading / error language for every workspace.
export function StateBlock({tone='empty', title, children}) {
  const cls = tone==='error' ? 'err-box' : 'empty empty-state';
  return <div className={cls} role="status" aria-live="polite" aria-busy={tone==='loading'?'true':undefined}>
    {title && <b>{title}</b>}
    {children}
  </div>;
}

// ================= Enterprise Data Grid =================
// sort / text filter / CSV export / pagination / density / row click
const _loadView = (k)=>{ try{ return JSON.parse(localStorage.getItem('refs_view_'+k))||{}; }catch(e){ return {}; } };
const _saveView = (k,v)=>{ try{ localStorage.setItem('refs_view_'+k, JSON.stringify(v)); }catch(e){} };
export function Table({cols, rows, onRow, empty='No records to display.', rowKey, features={}, pageSize=25, exportName, loading, error}) {
  const V = exportName ? _loadView(exportName) : {};
  const {sortable=true, filterable=rows&&rows.length>8, exportable=!!exportName, paginate=rows&&rows.length>pageSize} = features;
  const [sortK, setSortK] = useState(V.sortK??null);
  const [sortDir, setSortDir] = useState(V.sortDir??1);
  const [q, setQ] = useState(V.q||'');
  const [page, setPage] = useState(0);
  const [dense, setDense] = useState(!!V.dense);
  const [hi, setHi] = useState(-1);
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
  if (loading) return <StateBlock tone="loading">Loading records.</StateBlock>;
  if (!rows || rows.length===0) return <div className="empty empty-state" role="status" aria-live="polite">{empty}</div>;
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
    }}><table className={`tbl ${dense?'tbl-dense':''}`}>
      <thead><tr>{cols.map((c,i)=>
        <th key={i} className={c.num?'ta-r':''} style={c.w?{width:c.w}:null} aria-sort={sortK===i ? (sortDir>0?'ascending':'descending') : 'none'}>
          {sortable ? <button type="button" className="th-sort" onClick={()=>{ if(sortK===i){ setSortDir(d=>{persist({sortK:i,sortDir:-d}); return -d;}); } else {setSortK(i); setSortDir(1); persist({sortK:i,sortDir:1});} }} aria-label={`Sort by ${c.h}${sortK===i ? sortDir>0?', ascending':', descending' : ''}`}>
            {c.h}{sortK===i && <span className="sort-ind" aria-hidden="true">{sortDir>0?' ▲':' ▼'}</span>}
          </button> : c.h}
        </th>)}</tr></thead>
      <tbody>{view.map((r,ri)=>
        <tr key={rowKey?r[rowKey]:ri} className={`${onRow?'tr-click':''} ${hi===ri?'tr-hi':''}`} onClick={onRow?()=>onRow(r):null} onMouseEnter={()=>setHi(ri)}>
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
