# Disposal date changes

Changing the disposal date invalidates the previously loaded balance and source options immediately. The user must load the selected date before saving. Responses to requests started before that edit are ignored, including when the date is cleared. The save handler also requires the loaded snapshot date to equal the selected date.

The form retains journal number and explanation while the user selects another date. Source and account choices are checked against the newly loaded options using the existing selection rules. Pending saves keep the date control disabled.

Run `node scripts/test-asset-disposal-date-browser.mjs`, or the complete `npm run test:asset-acquisition-browser` chain. The regression exercises changing a loaded date and saving its new source, out-of-order responses, clearing the date during a pending read, and focus return on close. It mounts the real component in Chromium with injected option and command handlers; it does not prove PostgreSQL posting, authenticated production operation, or deployment acceptance.
