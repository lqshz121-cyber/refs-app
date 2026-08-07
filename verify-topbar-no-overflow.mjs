// The top bar must never push the document wider than the viewport.
//
// Measured on the deployed build (`9900bfd`) in a real browser at a 1142px
// viewport: `.top-right` demanded 630.9px, `document.scrollWidth` exceeded
// `clientWidth` by 7px, and the page scrolled sideways. Cause: the left cluster
// is `flex:1 1 auto` while the right cluster was `flex:0 0 auto` with
// `white-space:nowrap` — it could not give ground, so it overflowed instead.
// Injecting `flex:0 1 auto` into the live page took the cluster to 501.9px and
// the overflow to 0.
//
// A layout defect this cheap to reintroduce needs a gate, because the sandbox
// that runs these gates has no browser: nothing else here would notice.

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const failures = [];

// Pull a rule body by exact selector at the start of a line.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  return m ? m[1] : null;
}

const SHRINKABLE = [
  {
    selector: '.top-right',
    why: 'the right cluster must yield to the flexible left cluster rather than overflow the bar',
  },
  {
    selector: '.user-chip',
    why: 'the chip must shrink with its cluster so the name ellipsises instead of widening the bar',
  },
];

for (const { selector, why } of SHRINKABLE) {
  const body = ruleBody(selector);
  if (body === null) {
    failures.push(`no base rule found for "${selector}" — did the selector get renamed?`);
    continue;
  }

  const flex = body.match(/(?:^|;)\s*flex\s*:\s*([^;]+)/);
  if (!flex) {
    failures.push(`"${selector}" declares no flex shorthand; it must be shrinkable. ${why}.`);
  } else {
    // shorthand is `grow shrink basis`; shrink 0 is the defect.
    const shrink = flex[1].trim().split(/\s+/)[1];
    if (shrink === '0') {
      failures.push(
        `"${selector}" is "flex:${flex[1].trim()}" — shrink factor 0 means it cannot give ground and ` +
        `will overflow the viewport. ${why}.\n` +
        `    Fix: set the shrink factor to 1 (e.g. "flex:0 1 auto").`
      );
    }
  }

  // Without min-width:0 a flex item refuses to shrink below its content, so the
  // shrink factor above would be inert.
  if (!/(?:^|;)\s*min-width\s*:\s*0/.test(body)) {
    failures.push(
      `"${selector}" does not set "min-width:0", so its flex shrink factor cannot take effect ` +
      `(a flex item will not shrink below its content's intrinsic width without it). ${why}.`
    );
  }
}

// The name is what absorbs the shrink; it has to truncate rather than clip.
const userNm = ruleBody('.user-nm');
if (userNm === null) {
  failures.push('no base rule found for ".user-nm".');
} else {
  for (const [prop, re] of [
    ['overflow:hidden', /overflow\s*:\s*hidden/],
    ['text-overflow:ellipsis', /text-overflow\s*:\s*ellipsis/],
    ['min-width:0', /min-width\s*:\s*0/],
  ]) {
    if (!re.test(userNm)) {
      failures.push(
        `".user-nm" is missing "${prop}". It is the element that absorbs the top bar's shrink, ` +
        `so without it the name clips or the bar widens.`
      );
    }
  }
}

if (failures.length) {
  console.error('topbar-no-overflow FAILED:\n');
  for (const f of failures) console.error('  - ' + f + '\n');
  process.exit(1);
}

console.log(
  'topbar-no-overflow: the right cluster and user chip are shrinkable with min-width:0, ' +
  'and the user name truncates'
);
