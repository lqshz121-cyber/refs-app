import { useState, useMemo } from 'react';
import { money } from './engine.js';

export function Card({children, className='', onClick, hover}) {
  return <div className={`card ${hover?'card-hover':''} ${className}`} onClick={onClick}>{children}</div>;
}
export function KPI({label, value, sub, tone}) {
  return <div className={`kpi ${tone||''}`}>
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {sub!=null && <div className="kpi-sub">{sub}</div>}
  </div>;
}
export function Btn({children, onClick, variant='default', size, disabled, title}) {
  return <button className={`btn btn-${variant} ${size?'btn-'+size:''}`} onClick={onClick} disabled={disabled} title={title}>{children}</button>;
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
  const neg = v<0;
  return <span className={`num ${neg?'num-neg':''} ${bold?'num-bold':''}`}>{money(v)}</span>;
}

// ================= Enterprise Data Grid =================
// sort / text filter / CSV export / pagination / density / row click
const _loadView = (k)=>{ try{ return JSON.parse(localStorage.getItem('refs_view_'+k))||{}; }catch(e){ return {}; } };
const _saveView = (k,v)=>{ try{ localStorage.setItem('refs_view_'+k, JSON.stringify(v)); }catch(e){} };
export function Table({cols, rows, onRow, empty='暂无数据', rowKey, features={}, pageSize=25, exportName}) {
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
    const blob=new Blob(["﻿"+csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(exportName||'export')+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!rows || rows.length===0) return <div className="empty">{empty}</div>;
  return <div>
    {(filterable||exportable) && <div className="grid-bar">
      {filterable && <input className="grid-search" placeholder="🔍 筛选…(视图自动保存)" value={q} onChange={e=>{setQ(e.target.value); setPage(0); persist({q:e.target.value});}}/>}
      <span className="grid-count muted">{sorted.length} 行</span>
      <span style={{flex:1}}/>
      <button className="grid-tool" onClick={()=>{setDense(d=>{persist({dense:!d}); return !d;});}} title="密度">{dense?'Comfortable':'Compact'}</button>
      {exportable && <button className="grid-tool" onClick={doExport}>导出 CSV</button>}
    </div>}
    <div className="table-wrap" tabIndex={0} onKeyDown={e=>{ if(!view.length) return;
      if(e.key==='ArrowDown'){ e.preventDefault(); setHi(h=>Math.min(view.length-1,h+1)); }
      if(e.key==='ArrowUp'){ e.preventDefault(); setHi(h=>Math.max(0,h-1)); }
      if(e.key==='Enter' && hi>=0 && onRow){ e.preventDefault(); onRow(view[hi]); }
    }}><table className={`tbl ${dense?'tbl-dense':''}`}>
      <thead><tr>{cols.map((c,i)=>
        <th key={i} className={`${c.num?'ta-r':''} ${sortable?'th-sort':''}`} style={c.w?{width:c.w}:null}
          onClick={sortable?()=>{ if(sortK===i){ setSortDir(d=>{persist({sortK:i,sortDir:-d}); return -d;}); } else {setSortK(i); setSortDir(1); persist({sortK:i,sortDir:1});} }:null}>
          {c.h}{sortK===i && <span className="sort-ind">{sortDir>0?' ▲':' ▼'}</span>}
        </th>)}</tr></thead>
      <tbody>{view.map((r,ri)=>
        <tr key={rowKey?r[rowKey]:ri} className={`${onRow?'tr-click':''} ${hi===ri?'tr-hi':''}`} onClick={onRow?()=>onRow(r):null} onMouseEnter={()=>setHi(ri)}>
          {cols.map((c,ci)=><td key={ci} className={c.num?'ta-r':''}>{c.render?c.render(r):r[c.k]}</td>)}
        </tr>)}
      </tbody>
    </table></div>
    {paginate && <div className="grid-pager">
      <button className="grid-tool" disabled={page===0} onClick={()=>setPage(p=>p-1)}>‹ 上一页</button>
      <span className="muted">{page+1} / {pages}</span>
      <button className="grid-tool" disabled={page>=pages-1} onClick={()=>setPage(p=>p+1)}>下一页 ›</button>
    </div>}
  </div>;
}

export function Drawer({open, onClose, title, children, width=480, actions}) {
  if (!open) return null;
  return <div className="drawer-scrim" onClick={onClose}>
    <div className="drawer" style={{width}} onClick={e=>e.stopPropagation()}>
      <div className="drawer-head"><div className="drawer-title">{title}</div><button className="x" onClick={onClose}>×</button></div>
      <div className="drawer-body">{children}</div>
      {actions && <div className="drawer-foot">{actions}</div>}
    </div>
  </div>;
}
export function Tabs({tabs, active, onChange}) {
  return <div className="tabs">{tabs.map(t=>
    <button key={t} className={`tab ${active===t?'tab-on':''}`} onClick={()=>onChange(t)}>{t}</button>)}</div>;
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
  return <div className={`toast toast-${tone||'ok'}`}>{msg}</div>;
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
