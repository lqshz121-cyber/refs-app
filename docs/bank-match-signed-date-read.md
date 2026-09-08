# Bank match signed date differences

The posted payment command in migration 061 records bank transaction date minus payment accounting date. A bank transaction up to 31 days before the payment therefore has a negative date difference, and remains a valid exact match. The candidate reader already accepts signed date differences.

The browser bank-list reader incorrectly rejected every negative value, causing a valid matched row to invalidate the entire response. It now retains signed integer differences. Fractional, string and unsafe integer values remain rejected. This does not change candidate eligibility, matching commands or ledger data.

A regression case failed before the fix and passes afterward for -31, -1, 0, 1 and 31. Invalid type and precision cases remain covered. This is read-contract coverage with a mocked HTTP response, not live bank acceptance. Typed cash-sale source readback is a separate outstanding change.
