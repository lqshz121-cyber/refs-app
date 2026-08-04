import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
const required = [
  'Page failed to load', 'Core settings', 'Subsidiary ledger',
  'Sign-in account (demo environment', 'Sign in', 'All entities',
  'Search or jump', 'Reset demo data', 'Light / dark', 'General Ledger',
  'Journal entry', 'Month-end close', 'Expenses', 'Real Estate',
  'No audit records yet', 'No journal entries awaiting approval.',
  'No bills awaiting approval.'
];
for (const label of required) assert.ok(source.includes(label), `missing English shell label: ${label}`);

const retiredVisibleLabels = [
  '此页面加载出错', '四大 Setting', '辅助核算 Subsidiary', '登录账号',
  '登录 Sign in', '全部实体 All Entities', '全局搜索 / 跳转', '帮助中心',
  '退出', 'Journal Entry 手工分录', 'Report 报表', '没有待审批'
];
for (const label of retiredVisibleLabels) assert.ok(!source.includes(label), `retired localized label remains: ${label}`);

console.log('app visible-shell English labels verification passed');
