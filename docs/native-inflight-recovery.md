# Recovery while a command is still in flight

Refund and credit allocation forms must retain the prepared command as uncertain **before** calling the send function. A remounted form can attempt a retry before the first HTTP call resolves. If its identity check fails, that failure says nothing about the original in-flight request and must not clear recovery or unlock a different command.

The original form may clear recovery on a confirmed response, including after it has unmounted. Successful replay uses the original body, attachment identifiers and idempotency key. A later permission failure must not discard a previously uncertain request. Recovery is page-session transport state, not accounting authority or persistence across browser restart.

Interaction regression scenario, exercised with real components and simulated APIs:

1. Prepare a refund or credit allocation and hold its POST response pending.
2. Unmount the form, then mount and reopen it.
3. Deny the retry's access check while the original POST remains pending.
4. Verify that the same-request retry remains available, the form inputs remain locked, and Close stays disabled.
5. Restore access and let the original request lose its response.
6. Remount again, then retry. Verify identical body/key, no repeated upload or capacity preparation, and a single confirmed result.

Before the fix, step 4 lost the retry and unlocked the form. After the fix, both refund and credit allocation scenarios passed at desktop and narrow widths. This component result does not replace authenticated live business acceptance.
