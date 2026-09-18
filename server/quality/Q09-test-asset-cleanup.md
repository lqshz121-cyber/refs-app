# Q09 — 测试资产清理与稳定门禁

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 测试资产规模

| 目录 | 文件数 | 说明 |
|---|---|---|
| `server/tests/*.test.mjs` | 633 | 服务端测试（kernel, HTTP, contract, migration, postgres） |
| `tests/*.test.jsx` | 52 | 前端 JSX 测试（授权工作台） |

## 2. 测试类型分类

从文件名模式识别：

| 类别 | 模式 | 估计数量 | 说明 |
|---|---|---|---|
| PG 集成测试 | `*-postgres.test.mjs` | ~80 | 需要 embedded PG16 |
| HTTP 契约 | `*-http.test.mjs` | ~100 | 测试路由↔kernel 契约 |
| 迁移契约 | `*-migration-contract.test.mjs` | ~60 | 测试 SQL 关键 token |
| OpenAPI 契约 | `*-openapi.test.mjs` | ~40 | 测试 OpenAPI 路径/schema |
| 单元测试 | `*-contract.test.mjs`, `*.test.mjs` | ~353 | 纯逻辑单元测试 |
| E2E 场景 | `e2e-scenarios-*.test.mjs` | ~3 | 完整业务流程 |

## 3. 现有门禁机制

### P15 中已建立的 CI 门禁（RELEASE-GOVERNANCE-P15.md）

| 门禁 | 命令 | 失败条件 |
|---|---|---|
| 测试 | `npm test` | 任何测试失败 |
| Lint | `npm run lint` | ESLint 错误 |
| 迁移检查 | `node runtime/migrations.mjs` | 迁移未应用 |
| Ledger 摘要 | `ledgerDigest=manifestDigest` | hash 不匹配 |
| OpenAPI lint | `npx @redocly/cli lint` | schema 错误 |
| npm audit | `npm audit --audit-level=high` | 高危漏洞 |

## 4. 已知测试失败分类（基于历史审计）

### 4.1 真实回归（需修复）

- P0 批次修复的 72 项服务端失败，已全部修复（见 P0-B 回执）
- 当前分支: 目标全绿

### 4.2 屏障测试（需要理解不得随意修改）

`DB_DOWN_FORBIDDEN` 标记：测试 db:down 回滚被强制拒绝（migration 402+）。
**规则**: 任何 `MIGRATION_RESET_BLOCKED` 测试失败必须升级为 P0。

### 4.3 环境阻塞（需隔离）

需要 embedded PG16 的测试在无 PG 环境下会 SKIP（非失败）。
```javascript
// 标准模式（已实现）
if(unavailable){t.skip(unavailable);return;}
```

### 4.4 过时契约（需识别）

迁移契约测试检查 SQL 中的关键字符串（如 `'refs_entity_allowed'`）。若函数已重命名，契约测试会失败并明确指向过时代码。

**当前已知**: 无（所有迁移契约随迁移同步更新）。

### 4.5 Flaky 测试（需标记）

并发测试（`withSerializableRetry`）在高负载环境可能偶发失败（40001 超过重试次数）。

```javascript
// 建议: 将 flaky 测试移入专用 suite
// flaky.test.mjs — 在 CI 中重试 3 次
```

## 5. 测试所有者矩阵（建议）

| 测试类别 | Owner | SLA（修复时限） |
|---|---|---|
| PG 集成 | Backend 工程师 | 24h |
| HTTP 契约 | Backend 工程师 | 8h |
| 迁移契约 | DB/Migration owner | 4h |
| E2E 场景 | QA/全栈 | 24h |
| 前端 JSX | 前端工程师 | 24h |
| 屏障/回滚 | Platform 工程师 | 立即升级 |

## 6. 禁止行为（已存在规则，需强化）

| 禁止 | 理由 |
|---|---|
| 用 `test.skip` 掩盖真实失败 | 屏蔽了问题，会积累技术债 |
| 将 "postgres not run" skip 混入 CI 必须通过 suite | 需区分 "no-pg" skip 和 "business logic" skip |
| 修改期望值（expected）适配错误输出 | 应修复实现，而非修改期望 |
| 注释掉失败断言 | 严格禁止 |

## 7. 测试覆盖关键路径确认（当前状态）

| 关键路径 | 测试文件 | 状态 |
|---|---|---|
| JE 完整生命周期 | `backup-pitr-drill-p14.test.mjs`, `e2e-scenarios-p15.test.mjs` | ✅ |
| 期间控制（55000） | `e2e-scenarios-p15.test.mjs` S02 | ✅ |
| RBAC/SoD | `e2e-scenarios-p15.test.mjs` S03/S14 | ✅ |
| 幂等 | `e2e-scenarios-p15.test.mjs` S08 | ✅ |
| 贷款利息计算 | `loan-interest-capitalization-postgres.test.mjs` | ✅ |
| WBS 导入 | `accounting-staging-register.test.mjs` | 需确认 |
| 固定资产折旧 | `fixed-asset*.test.mjs` | 需确认 |
| 银行对账 | `bank-reconciliation*.test.mjs` | 需确认 |

## 8. 立即可落地

1. **CI 必须通过套件列表**: 在 `package.json` 中用 `--test-shard` 或 `--grep` 区分"必须通过"（所有非 pg 测试 + pg 测试在有 PG 时）与"可选"（无 PG 环境时 pg 测试的 skip 不计为失败）。
2. **Flaky 测试标记**: 添加 `TEST_FLAKY=1` 环境变量时重试 3 次；CI 主流程不依赖 flaky 测试通过。
3. **测试所有者文件**: 在 `server/tests/OWNERS.md` 记录每类测试的 owner。

## 9. Owner 决策缺口（D-Q09-x）

| ID | 问题 |
|---|---|
| D-Q09-1 | 是否需要独立的"质量门禁"（quality gate）流水线，区别于"CI 通过"流水线？ |
| D-Q09-2 | 633 个测试的运行时间是否在 CI 接受范围内（建议 < 5 分钟）？ |
