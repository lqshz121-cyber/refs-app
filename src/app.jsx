import React, { Component } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AuthoritativeApp,
  authoritativeRuntimeConfigured,
} from './authoritative-app.jsx';
import {
  AuthoritativeAdjustmentSummary,
  AuthoritativeCreditApplicationForm,
  AuthoritativeDocumentTable,
  AuthoritativeDraftForm,
  AuthoritativeRefundForm,
  AuthoritativeWorkflowAdjustmentTable,
  AuthoritativeWorkflowTable,
  validateAuthoritativeDocumentDraft,
} from './authoritative-workspace.jsx';
import { RuntimeErrorPage } from './runtime-error-page.jsx';
import { SURFACE_AUTHORITATIVE, SURFACE_ERROR, resolveRuntimeBoundary } from './runtime-mode.mjs';

class AuthoritativeRootBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return <RuntimeErrorPage code="ACCOUNTING_API_PROTOCOL"/>;
    }
    return this.props.children;
  }
}

export function App() {
  const boundary = resolveRuntimeBoundary(globalThis);
  if (boundary.surface === SURFACE_ERROR) return <RuntimeErrorPage code={boundary.code}/>;
  if (boundary.surface !== SURFACE_AUTHORITATIVE) {
    return <RuntimeErrorPage code="CONFIGURATION_REQUIRED"/>;
  }
  return <AuthoritativeRootBoundary>
    <AuthoritativeApp environment={globalThis}/>
  </AuthoritativeRootBoundary>;
}

export {
  AuthoritativeApp,
  authoritativeRuntimeConfigured,
  AuthoritativeAdjustmentSummary,
  AuthoritativeCreditApplicationForm,
  AuthoritativeDocumentTable,
  AuthoritativeDraftForm,
  AuthoritativeRefundForm,
  AuthoritativeWorkflowAdjustmentTable,
  AuthoritativeWorkflowTable,
  validateAuthoritativeDocumentDraft,
};

if (typeof document !== 'undefined' && document.getElementById('root')) {
  createRoot(document.getElementById('root')).render(<App/>);
}
