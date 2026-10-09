// Explicit least-privilege candidate; registering this definition is not a grant.
// Existing frozen role bundles must not be silently expanded.
export const SETTINGS_MAPPING_READ_ROLE=Object.freeze({
  authorityClass:'READ',
  principalKind:'HUMAN',
  permissions:Object.freeze(['ACCOUNTING.SETTINGS.WORKFLOW.VIEW','AI.ACCOUNTING.SETTINGS.VIEW'])
});
