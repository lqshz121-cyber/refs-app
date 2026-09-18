# Q12 — 覆盖率与变异测试高风险点

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 高风险业务路径

| 路径 | 风险级别 | 理由 |
|---|---|---|
| JE 过账（Posting） | 极高 | 创建账务凭证，错误会导致账目不符 |
| 期间关账 | 极高 | 不可逆操作，关错期间影响整个期间报表 |
| RBAC/SoD 检查 | 极高 | 权限漏洞可导致未授权操作 |
| 幂等性保证 | 高 | 重复操作导致重复入账 |
| WBS ingest 映射 | 高 | 错误映射导致 WBS 支出错误归集 |
| 银行对账匹配 | 高 | 错误匹配掩盖账务差异 |
| 迁移 runner 顺序 | 高 | 迁移顺序错误破坏数据库状态 |
| 报表投影（P&L/BS） | 高 | 错误余额影响财务决策 |
| 贷款利息计算 | 高 | 金额错误影响资本化金额 |
| COGS 释放 | 高 | 超额释放导致资产低估 |

## 2. 当前测试覆盖现状

### 2.1 已有覆盖（基于测试文件清单）

| 高风险路径 | 测试文件 | 覆盖深度 |
|---|---|---|
| JE 过账 | `backup-pitr-drill-p14.test.mjs`, `e2e-scenarios-p15.test.mjs` | E2E（5-actor 完整链） |
| 期间关账 | `authoritative-period-close-workspace.test.jsx` | UI 级别 |
| RBAC/SoD | `e2e-scenarios-p15.test.mjs` S03/S07/S14 | 核心 3 场景 |
| 幂等 | `e2e-scenarios-p15.test.mjs` S08 | ON CONFLICT 验证 |
| WBS ingest | `accounting-staging-register.test.mjs` | 需确认深度 |
| 迁移 runner | `backup-pitr-drill-p14.test.mjs` P14-5 | db:down 屏障测试 |
| 贷款利息 | `loan-interest-capitalization-postgres.test.mjs` | PG 集成测试 |
| COGS 释放 | `unit-sale-closeout-postgres.test.mjs` | 多场景 |
| 银行对账 | `reconciliation-*.test.mjs` | 需确认 |
| 报表投影 | `financial-statement-*.test.mjs` | 需确认 |

### 2.2 已知覆盖缺口

| 缺口 | 风险 | 建议测试 |
|---|---|---|
| 并发过账（同一 JE 两个 poster 同时操作） | 高 | 测试 40001 乐观锁 |
| 期间关账后仍尝试过账 | 高 | 已有 55000 测试，需确认边界 |
| COGS 超额释放（开 Draft 超总成本） | 高 | `unit-sale-closeout-postgres.test.mjs` 中已覆盖 |
| 贷款额度超 facility（累计 draw > facility） | 高 | 需确认 |
| 大额 JE 触发 AI 风险标记但仍可过账 | 中 | 需测试 AI 风险不阻断过账流程 |
| 银行对账匹配后撤销匹配 | 高 | 需确认是否有 unmatch 路径 |

## 3. 关键变异测试点（建议）

变异测试的价值在于验证"测试能检测到代码的细微错误"。

### 3.1 Posting 变异点

```javascript
// 原始代码（SQL 中）
sum(debit_amount) = sum(credit_amount)
// 变异：
sum(debit_amount) >= sum(credit_amount)  // 应被测试检测
```

### 3.2 SoD 变异点

```javascript
// 原始代码
count(DISTINCT p.authority_class) > 1 → 拒绝
// 变异：
count(DISTINCT p.authority_class) > 2  // 允许两个 authority class，应被检测
```

### 3.3 幂等变异点

```javascript
// 原始代码
ON CONFLICT(tenant_id, actor_id, entity_id, permission) DO UPDATE SET ...
// 变异：移除 ON CONFLICT，改为 INSERT 或 DO NOTHING
// 测试 S08 应检测到：count 变为 2 而非 1
```

### 3.4 期间边界变异点

```javascript
// 原始代码
journal_date BETWEEN starts_on AND ends_on
// 变异：
journal_date >= starts_on  // 缺少 ends_on 检查
// 测试 S02 应检测到：关闭期间仍允许写入
```

## 4. 覆盖率目标（建议）

| 路径 | 目标 | 测量方式 |
|---|---|---|
| kernel-repository.mjs | ≥ 80% 行覆盖 | `c8` 或 `istanbul` |
| SQL 函数（核心路径） | 100% 关键分支 | PG 集成测试 + `pg_stat_statements` |
| HTTP 路由 | ≥ 90% 状态码覆盖 | HTTP 契约测试 |
| 迁移 down 脚本 | 100% 可执行 | 迁移契约测试（已有） |

**注**: 数字覆盖率不等于业务验收。100% 行覆盖但缺少边界条件测试没有意义。

## 5. 建议工具链

```bash
# Node.js 覆盖率（无需编译）
cd server && node --experimental-vm-modules --test --coverage tests/*.test.mjs
# 生成 lcov 报告
node --test --coverage --coverage-reporter=lcov
```

## 6. 立即可落地

1. **补充 SoD 边界变异测试**:
   ```javascript
   // 测试：同一 actor 被授予 DRAFT + REVIEW（不同 authority class）时 SoD 触发
   // 已有 S14，但需要测试 "DRAFT + SUBMIT" 的 SoD（两个不同非 READ 类）
   ```

2. **补充并发 Posting 测试**:
   ```javascript
   // 两个 postJournal 并发调用同一 JE，期望一个成功一个 40001
   const [r1, r2] = await Promise.allSettled([poster1.postJournal(...), poster2.postJournal(...)]);
   const succeeded = [r1, r2].filter(r => r.status === 'fulfilled').length;
   assert.equal(succeeded, 1, '并发过账只能有一个成功');
   ```

3. **贷款额度超限测试**:
   ```javascript
   // Draw 1: +facility_amount
   // Draw 2: +1.0000 → 期望 422
   ```

## 7. Owner 决策缺口（D-Q12-x）

| ID | 问题 |
|---|---|
| D-Q12-1 | 是否引入变异测试工具（如 StrykerJS）？维护成本如何接受？ |
| D-Q12-2 | 覆盖率报告是否需要发布到 CI dashboard 并设置下降告警阈值？ |
