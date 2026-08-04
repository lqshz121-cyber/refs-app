const NON_ENGLISH_VISIBLE = /[^\x20-\x7e\n\r\t]/g;

export function englishOnlyVisibleText(value, fallback = 'Local evidence') {
  const normalized = String(value ?? '')
    .replace(NON_ENGLISH_VISIBLE, ' ')
    .replace(/[\t\r\n ]+/g, ' ')
    .replace(/\s+([,.;:!?)\]])/g, '$1')
    .trim();
  return normalized && /[A-Za-z0-9]/.test(normalized) ? normalized : fallback;
}

export function sanitizeVisibleEnglishText(root) {
  if (!root || typeof document === 'undefined') return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let changed = 0;
  for (const node of nodes) {
    const before = node.nodeValue || '';
    if (!NON_ENGLISH_VISIBLE.test(before)) continue;
    NON_ENGLISH_VISIBLE.lastIndex = 0;
    const after = englishOnlyVisibleText(before);
    if (after !== before) { node.nodeValue = after; changed += 1; }
  }
  return changed;
}
