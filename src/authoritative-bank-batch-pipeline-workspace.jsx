import React from 'react';
import { AuthoritativeBankWorkspace, AuthoritativeReconciliationWorkspace } from './authoritative-bank-workspace.jsx';
import { AuthoritativeWorkspaceView, AuthoritativeWorkspaceHeader } from './authoritative-workbench-view.jsx';

// Composition only: this route owns neither rows nor commands. Its children
// retain the existing server-side scope, revision, idempotency, and role gates.
export function AuthoritativeBankBatchPipelineWorkspace({ config, fetcher = globalThis.fetch, environment = globalThis }) {
  return <AuthoritativeWorkspaceView area="Bank Batch Pipeline" className="stack authoritative-bank-batch-pipeline-workspace">
    <AuthoritativeWorkspaceHeader
      eyebrow="AUTO RECONCILIATION | AUTHORITATIVE PIPELINE"
      title="Bank Batch Pipeline"
      description="Read one entity-scoped source queue, then the exact statement worksheet. Match, Unmatch, Clear, Review, Sign-off and Reopen remain separately authorised, revision-bound accounting API commands; this page never creates a browser batch or automatic posting."
    />
    <section className="authoritative-evidence-stage" aria-label="Bank batch pipeline stages">
      <span className="done">1 Scoped bank source evidence</span>
      <span className="current">2 Exact Match review</span>
      <span className="pending">3 Statement reconciliation</span>
      <span className="pending">4 Immutable sign-off history</span>
    </section>
    <AuthoritativeBankWorkspace config={config} fetcher={fetcher} environment={environment}/>
    <AuthoritativeReconciliationWorkspace config={config} fetcher={fetcher} environment={environment}/>
  </AuthoritativeWorkspaceView>;
}
