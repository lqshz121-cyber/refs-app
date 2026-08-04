// Business-fit gate for QBO shell items that would otherwise imply an
// external card, receipt/OCR, phone, or notification integration.
export function localExpenseFeatureState(name) {
  const label = String(name || '').toLowerCase();
  if (['purchase notifications', 'receipt reminders', 'card connection', 'ocr'].some(term => label.includes(term))) {
    return { state:'REFERENCE_ONLY', reason:'External card, phone, receipt/OCR and notification connections are not adopted for the local close.' };
  }
  return { state:'LOCAL_EVIDENCE_ALLOWED', reason:'Retained local expense evidence only.' };
}
