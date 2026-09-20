# Z01 — staging 最小前置条件统一清单

会话 claude-9c9cd162 · 2026-09-20 · 汇总 S35 / S36 / X04 / H11，去重
**只写配置键名，不写任何取值。本文不含、也不得含任何秘密。**

## 0. 用法

每项给出：用途 · 服务 · 配置键名 · 归属 · 验证方式 · 期望成功/失败信号。
**"失败信号"一栏是本清单的重点** —— 它让操作员能把"没配好"和"配错了"区分开。

## 1. 四服务版本读回

| 项 | 内容 |
|---|---|
| 用途 | 确认正式 API / 内测 API / 正式静态站 / 内测静态站四者跑同一候选 SHA |
| 服务 | Render ×4 |
| 键名 | `REFS_RELEASE_SHA`、`REFS_STAGING_API_BASE_URL`、`REFS_STAGING_WEB_ORIGIN` |
| 归属 | **Owner + Render** |
| 验证 | `npm run verify:staging-release`（本轮补上的脚本，此前不存在） |
| 成功 | 输出 `{ok:true, release, api:{live,ready}, web}`，四者 release 全等 |
| 失败 | 无 `REFS_RELEASE_SHA` → 退出码 1，`REFS_RELEASE_SHA must be a 40-character Git SHA`（**已实测**）；SHA 不符 → RELEASE_MISMATCH |

## 2. staging 数据库

| 项 | 内容 |
|---|---|
| 用途 | 内核读写、迁移台账 |
| 键名 | `DATABASE_URL`、`MIGRATION_DATABASE_URL`、`CONTEXT_ISSUER_DATABASE_URL`、`GRANT_SYNC_DATABASE_URL` |
| 归属 | **DB + Render** |
| 验证 | `npm run validate:staging-env`；再读 `SELECT count(*) FROM refs_schema_migration` |
| 成功 | 退出码 0；台账 **441**，链头 `435_ap_ar_write_off_reducer.sql` |
| 失败 | 缺项 → 退出码 1 并逐项列名（**已实测**列出 12 项）；台账落后 → 检查 Pre-Deploy `db:up`（D-O10-1）；**台账超前 → 停**，`MIGRATION_LEDGER_AHEAD` 会拒绝启动 |
| 注意 | 四个 URL **必须指向同一数据库**，否则 `runtimeConfig` 拒绝 |

## 3. OIDC / 身份

| 项 | 内容 |
|---|---|
| 用途 | 认证；REFS 的授权链以它为起点 |
| 键名 | `OIDC_ISSUER`、`OIDC_AUDIENCE`、`OIDC_JWKS_URI` |
| 归属 | **身份 + Owner** |
| 验证 | 进程启动；`GET /health/ready` |
| 成功 | 启动通过 |
| 失败 | 缺任一 → **启动即拒**：`OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required`（**已实测**） |

### 3b. 内测身份与角色

| 项 | 内容 |
|---|---|
| 用途 | 隔离 INTERNAL TEST ONLY tenant 上的四眼验收 |
| 需要 | **六个互异 actor** 的 JE 角色（decider/maker/submitter/reviewer/approver/poster）—— D-O02-2；以及只读 grant |
| 归属 | **Owner** |
| 失败 | 当前用户访问 staging 返回 **403**（缺只读 grant）。**不得自行授予** |
| 分类 | 见 Z02：实体级缺失 = `ROLE_MISSING`；权限级缺失 = `STATEMENT_SCOPE_MISSING`（两者修法不同） |

## 4. S3 / scanner（附件链路）

| 项 | 内容 |
|---|---|
| 用途 | 附件对象存储与病毒扫描 |
| 键名 | `REFS_ATTACHMENT_MODE`、`S3_ENDPOINT`、`S3_BUCKET`、`S3_REGION`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`SCANNER_ENDPOINT`、`SCANNER_BEARER_TOKEN`、`SCANNER_CA_BUNDLE` |
| 归属 | **S3/scanner + Owner** |
| 成功 | `REFS_ATTACHMENT_MODE=REQUIRED` 且进程启动通过 |
| 失败 | 打开但缺配置 → **启动即拒**：`S3_ENDPOINT is required`（**已实测**）。扫描器不可用时链路 **fail closed** 是结构性保证（`003:192` + `001:144`），未扫描附件无法成为 VERIFIED_CLEAN |
| 容器 | MinIO/ClamAV/sidecar 见 `compose.attachments.yaml`；未运行时 `attachment-containers.test.mjs` 报 `Container attachment test environment is required`（S-GATE-03 实测） |

## 5. WBS 只读

| 项 | 内容 |
|---|---|
| 用途 | 只读 pilot 抓取与 control totals |
| 键名 | `REFS_WBS_LIVE_PILOT_MODE`、`WBS_CF_ACCESS_CLIENT_ID`、`WBS_CF_ACCESS_CLIENT_SECRET`、`X-REFS-Auth` 网关令牌键、`REFS_WBS_INGEST_MODE` |
| 归属 | **WBS + Owner** |
| 成功 | `ENABLED` 且凭据齐 |
| 失败 | `ENABLED` 但缺凭据 → **启动即拒**：`WBS_CF_ACCESS_CLIENT_ID is required`（**已实测**）；拼写错误（如 `enabled-ish`）→ 拒绝，**不会静默降级为 DISABLED**（已实测）；`REFS_WBS_TEST_IMPORT_MODE` 不能脱离 live pilot（已实测） |
| 分类 | `DISABLED` 是**范围声明不是故障** → Z02 的 `WBS_DISABLED`，记 BLOCKED 并继续，**不得用本地 fake 替代** |
| 另需 | 已确认公司代码、范围授权（哪家公司/哪个月）—— D-S35-1 五项 |

## 6. Outbox worker

| 项 | 内容 |
|---|---|
| 用途 | 事件投递；积压是上线前必查项 |
| 键名 | `OUTBOX_PUBLISH_TOKEN`、消费端 endpoint 键 |
| 归属 | **Render + Owner** |
| 验证 | `GET /entities/{id}/ops/outbox-health?staleMinutes=15` |
| 成功 | `backlog_state` 为 `DRAINED` 或 `PENDING_WITHIN_WINDOW` |
| 失败 | `FAILED_EVENTS_PRESENT` / `STALE_BACKLOG`。**注意 `FAILED` 是终态，无重投路径**（D-N20-2） |
| 背景 | 迁移 433 表头记载 staging worker 自 **2026-09-02** 起 Suspended、积压无人观测。建议列为上线必备（D-N10-3） |

## 7. 网络入口与日志/告警

| 项 | 内容 |
|---|---|
| 键名 | `REFS_HTTP_ALLOWED_ORIGINS` |
| 归属 | **Render** |
| 成功 | 首页 200 且非白屏；响应头含预期 CSP，无 `unsafe-inline`/`unsafe-eval`，无未声明外部脚本源 |
| 失败 | CSP/SRI 由**静态站配置**承载，**本仓库测试无法覆盖**（D-P13-4），只能在部署侧核对 |
| 日志 | 部署后 15 分钟内不得出现 `database_idle_client_error` 或 `Instance failed: exited with status 1`（后者是 `runtime/db.mjs:20-25` 记录的真实事故形态） |
| 告警 | outbox 健康读存在但**无任何东西在轮询它**（D-P10-2）——读有了不等于告警有了 |

## 8. 一句话总结哪些是"总开关"

按依赖顺序，**前面不满足时后面的验证没有意义**：

1. §2 数据库 → 2. §3 OIDC → 3. §1 四服务同 SHA → 4. §3b 角色与 grant → 5. §4/§5 可选依赖 → 6. §6 worker → 7. §7 入口与日志

Z02 的分类器按同样的优先级排序：配置 → 可达性 → 版本 → 授权 → 可选依赖 → 空数据。

## 9. 安全声明

本文**只列键名**。未读取、未输出、未写入任何取值、令牌、Cookie 或凭据。
所有标"已实测"的失败信号均为本会话在无凭据环境下实际触发所得，非推断。
