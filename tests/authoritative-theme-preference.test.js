import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTHORITATIVE_THEME_STORAGE_KEY,
  readStoredTheme,
  resolveInitialTheme,
  watchOsTheme,
  writeStoredTheme,
} from '../src/authoritative-theme-preference.js';

const store = () => {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
  };
};

const listeners = new Set();
const sessionStorage = store();
const environment = {
  sessionStorage,
  localStorage: {
    getItem: () => { throw new Error('authoritative theme must not read localStorage'); },
    setItem: () => { throw new Error('authoritative theme must not write localStorage'); },
  },
  matchMedia: () => ({
    matches: true,
    addEventListener: (name, listener) => { if (name === 'change') listeners.add(listener); },
    removeEventListener: (name, listener) => { if (name === 'change') listeners.delete(listener); },
  }),
};

assert.equal(resolveInitialTheme(environment), 'dark', 'the OS preference is used when this tab has no choice');
writeStoredTheme('light', environment);
assert.equal(sessionStorage.getItem(AUTHORITATIVE_THEME_STORAGE_KEY), 'light');
assert.equal(readStoredTheme(environment), 'light');
assert.equal(resolveInitialTheme(environment), 'light', 'the tab choice wins over the OS preference');

let changes = 0;
const stop = watchOsTheme(environment, () => { changes += 1; });
for (const listener of listeners) listener({ matches: false });
assert.equal(changes, 0, 'an explicit tab choice prevents OS changes from overriding it');
stop();

const source = readFileSync('src/authoritative-theme-preference.js', 'utf8');
assert.doesNotMatch(source, /localStorage\s*\./, 'the authoritative theme helper must not call browser-persisted storage');

console.log('authoritative theme preference: session-only presentation state verified');
