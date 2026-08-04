import assert from 'node:assert/strict';
import { normalizeReportFavorites, toggledReportFavorites } from './src/report-favorites.js';

const names = ['Balance Sheet', 'Income Statement', 'Profit and Loss', 'Trial Balance'];
assert.deepEqual([...normalizeReportFavorites(['Balance Sheet', 'Unknown'], names)], ['Balance Sheet'], 'only available local reports restore as favorites');
assert.deepEqual([...toggledReportFavorites(new Set(['Balance Sheet']), 'Income Statement', names)].sort(), ['Balance Sheet', 'Income Statement'], 'available report can be favorited');
assert.deepEqual([...toggledReportFavorites(new Set(['Balance Sheet']), 'Unknown', names)], ['Balance Sheet'], 'unknown report cannot be persisted as a favorite');
assert.deepEqual([...toggledReportFavorites(new Set(), 'Profit and Loss', names)], ['Profit and Loss'], 'observed local P&L alias can be favorited');
console.log('report favorites: restore and toggle gates verified');
