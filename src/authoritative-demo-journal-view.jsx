import React from 'react';

// Direct presentation extraction from modules-core.jsx JEWorkspace: the
// transaction-register heading and filter/list stage remain visually shared.
// Its caller supplies only authenticated journal facts and event slots.
export function AuthoritativeDemoJournalView({children}) {
  return <section className="full-bleed authoritative-journal-workspace authoritative-workbench-shell demo-journal-presentation" aria-label="Authoritative journal entries">
    <div className="page-top accounting-page-head journal-page-header">
      <div><div className="page-eyebrow">GENERAL LEDGER | JOURNAL REGISTER</div><h2 className="page-h">Journal Entries</h2><div className="page-subtitle">Review source, approval status and posting evidence from one controlled workspace.</div></div>
      <span className="badge badge-muted">Read only</span>
    </div>
    {children}
  </section>;
}
