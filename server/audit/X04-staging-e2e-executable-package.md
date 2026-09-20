# X04 — staging E2E 可执行包与四服务版本读回

会话 claude-9c9cd162 · 2026-09-20 · 候选 `2adae56d` · 链头 435
**准备，不执行。** 未部署、未切 Render 分支、未改生产、未自授权限。

## 0. 本轮修掉的一个可执行性缺口

codex012 §P0-F9 指示先跑 `npm run verify:staging-release -- --expect <sha>` 作为只读预检。
**该 npm 脚本此前不存在** —— 验证器模块 `runtime/verify-render-staging-release.mjs` 和它的测试
`tests/render-staging-release.test.mjs`（2/2 通过）都在，只是没有 CLI 入口，所以那条指令跑不起来。

已补 `"verify:staging-release": "node runtime/verify-render-staging-release.mjs"`。

**基线已实测**：无 staging 环境变量时退出码 **1**，报 `REFS_RELEASE_SHA must be a 40-character Git SHA`。
即它**fail closed，不会静默通过** —— 这正是预检该有的行为。

`npm run validate:staging-env` 同样实测：退出码 **1**，列出 12 个缺失变量
（DATABASE_URL、MIGRATION_DATABASE_URL、CONTEXT_ISSUER_DATABASE_URL、GRANT_SYNC_DATABASE_URL、
OIDC_ISSUER、OIDC_AUDIENCE、OIDC_JWKS_URI、REFS_HTTP_ALLOWED_ORIGINS、REFS_ATTACHMENT_MODE、
REFS_WBS_INGEST_MODE、REFS_STAGING_API_BASE_URL、REFS_STAGING_WEB_ORIGIN）。

## 1. 前置条件归类（每项归到 Render / DB / 身份 / WBS / S3-scanner / Owner）

| # | 前置 | 归属 | 现状 |
|---|---|---|---|
| 1 | staging 部署到与候选同一 SHA | **Owner + Render** | 未满足（staging 为 `320bcbad`，候选已推进） |
| 2 | 四服务环境变量齐备（上列 12 项） | **Render** | 未满足（本地基线 12 项缺失） |
| 3 | staging 数据库可达且迁移到链头 | **DB** | 未知（无凭据） |
| 4 | 隔离 INTERNAL TEST ONLY tenant/entity | **Owner + DB** | 未满足 |
| 5 | 六个互异 actor 的 JE 角色授予（D-O02-2） | **身份 + Owner** | 未满足；**不得自行授予** |
| 6 | 只读 grant（当前用户访问 staging 返回 403） | **身份 + Owner** | 未满足 |
| 7 | WBS 只读身份 + 范围授权 | **WBS + Owner** | 未满足（S35 五项最小输入） |
| 8 | S3 / scanner 端点与凭据 | **S3-scanner + Owner** | 未满足 |
| 9 | 附件容器（MinIO/ClamAV/sidecar） | **Render/基础设施** | 未满足 |

## 2. 逐步执行脚本

> 全程使用**可撤销的 INTERNAL TEST ONLY 数据**；不触碰真实公司账；任一"停止条件"命中即停并按
> `RELEASE-GOVERNANCE-P15.md` 回滚。

### 步骤 1 — 环境预检（只读，不触网）
```
cd server
npm run validate:staging-env          # 期望 exit 0；exit 1 会逐项列出缺失变量
```
**停止条件**：任何变量缺失。

### 步骤 2 — 四服务 SHA 一致性（只读）
```
export REFS_RELEASE_SHA=<候选完整 40 位 SHA>
export REFS_STAGING_API_BASE_URL=https://<正式 API>
export REFS_STAGING_WEB_ORIGIN=https://<正式静态站>
npm run verify:staging-release
```
它读回 API 的 live/ready release 与静态站 build sha 并与期望值比对，输出
`{ok,release,api:{live,ready},web,anonymousStatus}`。
对**内测 API / 内测静态站**重复一次（换两个 URL）。

**通过判据**：四者 release 全等于期望 SHA。
**停止条件**：任一不符（RELEASE_MISMATCH）→ 停，不要继续做业务验收。

### 步骤 3 — 健康与迁移台账（只读）
```
curl -fsS "$REFS_STAGING_API_BASE_URL/health/live"   | jq .
curl -fsS "$REFS_STAGING_API_BASE_URL/health/ready"  | jq .
```
**通过判据**：均 200；ready 为 true。
**语义边界（重要）**：readiness 只断言**数据库 schema 与 `refs_app` 授权就位**（`accounting-server.mjs:74`
逐项检查 6 张表、18 个函数、18 个 `has_function_privilege`）。它**不覆盖 S3/scanner/provider/WBS 网关**。
**不得以 readiness=true 替代业务验收。**

迁移台账：在 staging DB 上读回
```
SELECT count(*) FROM refs_schema_migration;                                   -- 期望 441
SELECT migration_name FROM refs_schema_migration ORDER BY 1 DESC LIMIT 1;     -- 期望 435_ap_ar_write_off_reducer.sql
```
**停止条件**：计数落后 → 检查 Pre-Deploy `db:up`（D-O10-1）；**超前 → 停**，说明部署了旧版本，
`MIGRATION_LEDGER_AHEAD` 会拒绝启动。

### 步骤 4 — 首页与 CSP（只读）
```
curl -fsS -D- -o /dev/null "$REFS_STAGING_WEB_ORIGIN/"
```
**通过判据**：200；渲染非空（非白屏）；响应头含预期 CSP，无 `unsafe-inline`/`unsafe-eval` 回退，
无未声明的外部脚本源。
**注意**：CSP/SRI 由 Render 静态站配置承载，**本仓库测试无法覆盖**（D-P13-4），只能在此核对。

### 步骤 5 — 内测角色与 401/403/422 分类（只读 + 受控）
用**只读 actor** 依次请求：
- 无令牌 → 期望 **401**
- 有令牌、无该实体 grant → 期望 **403**（响应体应为通用 `Forbidden`，不泄漏作用域）
- 有 grant、参数非法（如 `limit=201`）→ 期望 **400**（HTTP 守卫）或 **422**（落到 SQL 的 22023）
  —— 二者当前并存，见 D-N32-3

### 步骤 6 — 关键业务场景（隔离 tenant，可撤销）
在**隔离 INTERNAL TEST ONLY tenant** 上，按六个互异 actor 走：
JE 全生命周期 → AP 账单 → AR 发票 → 银行匹配/对账 → 报表反向追溯 → 审计读回。

对应的本地等价物已在 S34 以 **46/46** 通过（临时实例，等级 `EVIDENCED`）。
staging 重跑后方可升为 `LIVE_VERIFIED`。

**新增覆盖**：本轮 X02 的 AP/AR 核销链路应纳入本步骤 ——
部分核销 → 核销至零 → 控制对账仍在平（`refs_ap_ar_control_reconciliation.ap_in_balance/ar_in_balance` 均为 true）。

### 步骤 7 — WBS 只读（若授权）
按 S35 的五项最小输入配置后，执行小样本只读抓取 + control totals。
**无授权则跳过并记为 BLOCKED，不得以本地 fake 代替。**

### 步骤 8 — worker 与积压
```
GET /entities/{id}/ops/outbox-health?staleMinutes=15
```
**通过判据**：`backlog_state` 为 `DRAINED` 或 `PENDING_WITHIN_WINDOW`。
**停止条件**：`FAILED_EVENTS_PRESENT` 或 `STALE_BACKLOG`。
**背景**：迁移 433 表头记载 staging worker 自 **2026-09-02** 起 Suspended、积压无人观测；
上线前必须确认生产 worker 已运行（D-N10-3 建议列为必备）。

### 步骤 9 — 日志
部署后 15 分钟内不得出现 `database_idle_client_error` 或 `Instance failed: exited with status 1`
（后者正是 `runtime/db.mjs:20-25` 注释记录的 staging 真实事故形态）。

## 3. 错误路径的明确验收

| 症状 | 判定 | 动作 |
|---|---|---|
| API / 静态站 release mismatch | **失败** | 停在步骤 2，不做业务验收 |
| 首页白屏 | **失败** | 停；检查静态站构建与 CSP |
| worker 停摆（`FAILED_EVENTS_PRESENT`/`STALE_BACKLOG`） | **失败** | 停；outbox 死信无重投（D-N20-2），需人工介入 |
| 401 | 正常（无令牌） | 继续 |
| 403 | 正常（无 grant），但若**预期有 grant 却 403** → 失败 | 检查授权，**不得自行授予** |
| 422 | 参数非法为正常；业务拒绝需逐条判读 | 对照 SQLSTATE 映射表 |
| readiness=true 但外部依赖不可用 | **不算通过** | readiness 不覆盖 S3/scanner/WBS（§步骤3） |

## 4. 本包不构成什么

- **不构成部署授权**，也不请求部署授权
- **不以本地 fake 代替 staging 验收**（任务书明令）
- S34 的 46/46 等级为 `EVIDENCED`，**非** `LIVE_VERIFIED`
- 未执行上述任何一步

## 5. Owner 决策

- **D-X04-1** 是否授权把 staging 部署到候选 SHA（前置：S37 §5 最小条件集）。这是 §1 表中 1–9 项的总开关。
- **D-X04-2** 是否授予只读 grant 以解除 403（按 F8 最小权限：只读隔离测试实体与报表，不含 post/reopen/WBS write/admin）。
- **D-X04-3** 隔离 INTERNAL TEST ONLY tenant 的创建与六互异 actor 授予（D-O02-2）由谁执行、由谁复核。按 SoD，执行者与复核者应互异。
- **D-X04-4** 步骤 6 是否纳入 X02 的核销链路作为发布前必验场景（建议纳入：它是本轮新增的账务写入路径）。
