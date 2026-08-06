// Role visibility for the QuickBooks-equivalent bank queue verbs.
//
// This module *surfaces* the caller's existing permissions. It does not define,
// widen, or narrow authorization: it calls the application's own can(permission)
// and reports the result. A role without the permission never sees the action
// name at all, so no read-only user is shown an executable-looking affordance.
//
// Separately, REFS retains bank evidence read-only. Even a Controller who holds
// every permission gets a *non-executable* availability statement here, because
// categorize / match / exclude / undo run only inside the controlled
// Draft -> Review -> Approve -> Post journal workflow, never from this
// evidence surface. Availability is therefore reported, not offered.

export const BANK_WORKFLOW_ACTIONS = Object.freeze([
  Object.freeze({
    id: 'MATCH',
    label: 'Match',
    permission: 'CASH.BANKTX.MATCH',
    intent: 'Link this bank item to one exact retained POSTED journal entry.',
  }),
  Object.freeze({
    id: 'CATEGORIZE',
    label: 'Categorize',
    permission: 'CASH.BANKTX.CATEGORIZE',
    intent: 'Assign this bank item to a GL account through a controlled Draft journal entry.',
  }),
  Object.freeze({
    id: 'EXCLUDE',
    label: 'Exclude',
    permission: 'CASH.BANKTX.EXCLUDE',
    intent: 'Move this bank item out of the review queue with a retained audit rationale.',
  }),
  Object.freeze({
    id: 'UNDO',
    label: 'Undo',
    permission: 'CASH.BANKTX.UNDO',
    intent: 'Return a categorized or excluded bank item to the pending queue.',
  }),
]);

export const BANK_ACTION_UNAVAILABLE_REASON =
  'Not executable here: this workspace retains read-only bank evidence. Categorize, Match, Exclude and Undo run only in the controlled Draft to Review to Approve to Post journal workflow.';

export const BANK_ACTION_READ_ONLY_STATEMENT =
  'Your role has no bank queue workflow permission, so no Match, Categorize, Exclude or Undo control is shown.';

export function bankActionVisibility({ can, roleCode = '' } = {}) {
  const test = typeof can === 'function' ? can : () => false;
  const permitted = [];
  const withheld = [];
  for (const action of BANK_WORKFLOW_ACTIONS) {
    const allowed = test(action.permission) === true;
    (allowed ? permitted : withheld).push({
      id: action.id,
      label: action.label,
      permission: action.permission,
      intent: action.intent,
      permitted: allowed,
      // Read-only evidence boundary: never true on this surface.
      executable: false,
      availability: allowed ? 'PERMITTED_NOT_EXECUTABLE_HERE' : 'HIDDEN_NO_PERMISSION',
      reason: allowed ? BANK_ACTION_UNAVAILABLE_REASON : BANK_ACTION_READ_ONLY_STATEMENT,
    });
  }
  return {
    roleCode: String(roleCode || ''),
    visible: permitted,
    hidden: withheld,
    readOnly: permitted.length === 0,
    // Guard used by the view: no rendered element may be executable.
    anyExecutable: false,
    statement: permitted.length ? BANK_ACTION_UNAVAILABLE_REASON : BANK_ACTION_READ_ONLY_STATEMENT,
  };
}
