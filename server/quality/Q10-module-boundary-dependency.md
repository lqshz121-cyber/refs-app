# Q10 — 模块边界与依赖治理

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 当前架构分层

### 1.1 服务端层次结构

```
server/
├── api/                    # HTTP 路由层（accounting-http.mjs 主路由）
│   └── openapi-accounting.json  # OpenAPI 规范
├── runtime/                # 业务内核层
│   ├── kernel-repository.mjs    # PostgresAccountingKernel — 所有命令/查询
│   ├── context-issuer.mjs       # PostgresContextIssuer — 认证/SoD 上下文
│   ├── migrations.mjs           # 迁移运行器
│   ├── migration-manifest.mjs   # 迁移清单（摘要）
│   ├── db.mjs                   # 连接池（withTransaction, withSerializableRetry）
│   └── config.mjs               # 配置读取
├── ai-*.mjs               # AI 服务层（分析、决策、风险评估）
├── je-*.mjs               # JE 业务逻辑（je-contract, je-policy, je-service）
├── fixed-asset-*.mjs      # 固定资产业务逻辑
├── outbox-consumer/       # 出站事件消费者（独立服务）
├── scanner-sidecar/       # 附件扫描边车（独立服务）
└── tests/                 # 633 个测试
```

### 1.2 客户端层次结构

```
tests/                    # 52 个 JSX 授权测试
```
（未发现 client/src 目录——前端可能在独立仓库或 tests/ 中内嵌组件）

## 2. 层间边界分析

### 2.1 HTTP 层 → 内核层（已分离）

`accounting-http.mjs` 通过依赖注入接收 `kernelFactory`：
```javascript
createAccountingApi({
  authenticate: async(req) => {...},
  kernelFactory: async(session) => new PostgresAccountingKernel(pool, {sessionProvider})
})
```

内核(`PostgresAccountingKernel`)通过`runtime/`模块封装所有 SQL，HTTP 层无直接 SQL。

**结论**: HTTP↔内核 边界清晰，符合最小特权原则。

### 2.2 AI 服务层边界（混合）

`ai-*.mjs` 文件直接导入 `runtime/kernel-repository.mjs` 的 kernel 实例，部分也使用连接池。

**潜在问题**:
- AI 服务（分析/决策）与持久化内核耦合，测试需要 PG
- `ai-accounting-skill-registry.mjs` 可能包含 LLM 调用，若与内核混用导致测试复杂

### 2.3 JE 业务逻辑层（轻微违规）

`je-service.mjs`, `je-contract.mjs`, `je-policy.mjs` 存在业务规则在应用层（而非 SQL 函数层）的情况：

**核查点**: JE 状态机是否全部在 `refs_transition_journal_v2` SQL 函数中，还是部分逻辑在 `je-service.mjs`？

```bash
# 检查 je-policy.mjs 是否调用 DB
grep -l "query\|pool" /tmp/gw2/server/je-*.mjs
```

### 2.4 特权 SQL 审查

所有写函数使用 `SECURITY DEFINER`，以 `refs_service` 角色执行：
- `refs_create_manual_journal` — DEFINER
- `refs_post_journal` — DEFINER
- `refs_guard_runtime_context_sod` — DEFINER（触发器）

RLS 策略确保 runtime 用户只能看到自己 tenant 的数据。

**合规性结论**: 特权 SQL 设计符合原则，DEFINER 函数是有意设计（非意外）。

## 3. 循环依赖审查

```bash
# 快速检查（无完整循环检测工具时的手工方法）
grep -l "import.*from.*kernel-repository" /tmp/gw2/server/runtime/*.mjs
grep -l "import.*from.*ai-" /tmp/gw2/server/runtime/*.mjs
```

已知无循环：`kernel-repository.mjs` 不导入 AI 模块（AI 单向依赖 kernel）。

## 4. 配置读取审查

`config.mjs` 从环境变量读取：
- `DATABASE_URL` — 主 DB
- `MIGRATION_DATABASE_URL` — 迁移 DB
- `CONTEXT_ISSUER_DATABASE_URL` — 上下文 DB

**问题**: 三个连接池指向同一 PostgreSQL 实例但不同 roles。若这些 URL 在同一进程中混用，连接数会乘以 3。

**建议**: 在配置文档中明确最大连接数预算（api_pool_max + issuer_pool_max + migration_pool_max <= 实例连接上限）。

## 5. 重复业务规则

通过 grep 识别以下规则分布：

| 规则 | SQL 函数 | 应用层 | 状态 |
|---|---|---|---|
| 借贷平衡 | `refs_create_manual_journal` | `je-contract.mjs`(可能) | 需确认是否重复 |
| 期间开放检查 | `refs_create_manual_journal` | HTTP 层? | 需确认 |
| SoD 权限检查 | `refs_guard_runtime_context_sod` 触发器 | N/A | 只在 DB 层 ✅ |
| 金额精度 | DB CHECK 约束 | API OpenAPI schema | 两层均有（合理） |

## 6. ADR — 模块边界原则（建议）

```markdown
# ADR-Q10: 会计内核模块边界

## 决定
1. PostgresAccountingKernel 是唯一允许调用 `refs_*` 函数的层。
2. HTTP 路由层不得直接查询数据库；通过 kernelFactory 获取 kernel 实例。
3. AI 服务层通过 kernel 公共 API 读取数据，不得绕过 kernel 直接访问 DB。
4. JE 业务规则（余额、SoD、期间）必须在 SQL 函数层实现，不得在应用层重复。
5. 配置通过 config.mjs 集中读取，不得在模块内硬编码 DB URL。
```

## 7. 渐进重构计划

| 阶段 | 任务 | 风险 |
|---|---|---|
| Phase 1 | AI 服务层统一通过 kernel API 访问数据（替换直接 DB 查询） | 低 |
| Phase 2 | je-service.mjs 业务规则去重（确认 SQL 函数为唯一权威） | 中 |
| Phase 3 | 引入 TypeScript 类型（runtime → ts，逐步迁移） | 高（需打包变更） |

## 8. Owner 决策缺口（D-Q10-x）

| ID | 问题 |
|---|---|
| D-Q10-1 | AI 分析结果是否应存储在审计表中（当前部分在内存）？ |
| D-Q10-2 | 是否计划引入 TypeScript？如是，迁移策略是什么？ |
