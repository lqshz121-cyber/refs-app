# Reopen an existing Sales Receipt draft

Sales Receipt detail now exposes **Open draft workflow** when its linked journal is still Draft, the caller has GL.JE.VIEW and the application's existing Draft callback is available. This makes the workflow reachable after the original entry form has been closed.

The action rereads the exact receipt and validates its period, receipt state/revision, journal identity and journal state/revision before handing that persisted record to the existing workflow callback. A change leaves the user in detail with an instruction to refresh. The callback independently rereads the current journal register and confirms Draft status; workflow permissions, separation of duties, optimistic revisions and posting authority remain enforced by the existing API/database path.

Client tests cover unchanged state and changed receipt revision, journal revision/identity/state or period. The actual Receivables component with simulated APIs passes 17 checks at 1280px and 390px, adding saved-workflow callback and stale-action rejection to the existing list/detail/journal/focus checks. This is not deployed acceptance.

The existing application callback still reads the complete period journal register in 200-row pages before navigation. This change does not solve that separate large-register performance issue; a direct journal workflow route remains needed. No real workflow mutation, permission change or deployment is performed by these tests.
