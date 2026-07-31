import { useState } from 'react';
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
  POSTED:'ok', APPROVED:'ok', MATCHED:'ok', DONE:'ok', BALANCED:'ok', SIGNED_OFF:'ok', CLOSED:'muted', RESOLVED:'ok', WAIVED:'muted',
  PENDING:'warn', PENDING_REVIEW:'warn', PENDING_APPROVAL:'warn', IN_PROGRESS:'warn', UNMATCHED:'warn', OPEN:'warn', DRAFT:'muted',
  REJECTED:'bad', REVERSED:'bad', OUT_OF_BALANCE:'bad', FAILED:'bad', HIGH:'bad', MEDIUM:'warn', LOW:'muted',
};
export function Badge({children, tone}) {
  const t = tone || STATUS_TONE[children] || 'muted';
  return <span className={`badge badge-${t}`}>{children}</span>;
}
export function Money({v, bold}) {
  const neg = v<0;
  return <span className={`num ${neg?'num-neg':''} ${bold?'num-bold':''}`}>{money(v)}</span>;
}
export function Table({cols, rows, onRow, empty='暂无数据', rowKey}) {
  if (!rows || rows.length===0) return <div className="empty">{empty}</div>;
  return <div className="table-wrap"><table className="tbl">
    <thead><tr>{cols.map((c,i)=><th key={i} className={c.num?'ta-r':''} style={c.w?{width:c.w}:null}>{c.h}</th>)}</tr></thead>
    <tbody>{rows.map((r,ri)=>
      <tr key={rowKey?r[rowKey]:ri} className={onRow?'tr-click':''} onClick={onRow?()=>onRow(r):null}>
        {cols.map((c,ci)=><td key={ci} className={c.num?'ta-r':''}>{c.render?c.render(r):r[c.k]}</td>)}
      </tr>)}
    </tbody>
  </table></div>;
}
export function Drawer({open, onClose, title, children, width=460, actions}) {
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
export function Toast({msg, tone, onDone}) {
  if (!msg) return null;
  return <div className={`toast toast-${tone||'ok'}`}>{msg}</div>;
}
export function SectionTitle({children, right}) {
  return <div className="sec-title"><h3>{children}</h3>{right}</div>;
}
export function useToast() {
  const [t, setT] = useState(null);
  const show = (msg, tone='ok') => { setT({msg,tone}); setTimeout(()=>setT(null), 2600); };
  return [t, show];
}
