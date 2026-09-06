# Native payment and receipt entry

Open an AP bill or AR invoice and choose Record payment or Receive payment. The form reads the selected company's current open balance, pending draft reservations and available amount. Select an active bank ledger account and bank member, enter the reference/date/amount/description, choose support, then Save draft. Support uploads and scanning run as part of Save; there is no separate verification action.

Saving creates the native payment/receipt, pending allocation, MANUAL journal and attachment links in the authoritative API. It does not post the journal or reduce the posted open balance before approval/Post. Open saved draft locates the confirmed journal in the exact company and period register and continues the existing workflow. Close and refresh returns to current persisted records.

The browser preserves decimal strings. It refreshes actor, context and chart of accounts before preparing the command. Unknown network outcomes freeze the prepared request and retry the same body/key without rechecking capacity that may have been reserved by that request. Identity changes cannot replay under another actor. A prepared unknown request remains in memory; refresh recovery still requires checking the saved journal register. The browser does not persist authoritative accounting state.

Access uses the existing current-actor permissions; role templates and company data must already be configured on the server. This UI grants no permissions and provisions no companies. The payment-period selector lists this company’s open periods. Old-period source documents may be settled in a later open period; the form reads that period’s accounts, and opening the saved journal verifies and switches to its payment period while reloading the associated document registers.

Validation includes exact-decimal and scope/contract tests, lost-response replay and changed-actor tests, document UI rendering and root regression/build. Live browser/OIDC, all-company access and production business acceptance are still required; local rendering and test fixtures do not establish those outcomes.
