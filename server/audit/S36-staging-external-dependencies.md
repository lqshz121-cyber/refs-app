# S36 — staging 外部依赖（fail-closed / readiness 不误绿）

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · commit e4c72c23

## 0. 边界

任务书："验证 S3/scanner/OIDC health、fail-closed、超时和恢复；**无真实端点只验证 readiness 报告未误绿**。"

本会话**无任何真实外部端点**（无 S3、无 scanner、无 OIDC issuer、无 WBS 网关），因此执行"readiness 未误绿"分支，并对 fail-closed 与超时做代码级取证 + 可执行的配置探针。

## 1. 依赖清单（`EXTERNAL-DEPENDENCY-CONTRACTS.md` §1，已核对现行代码）

| # | 依赖 | 开关 | 关闭态行为 |
|---|---|---|---|
| D1 | 对象存储（S3 兼容，开版本） | `REFS_ATTACHMENT_MODE=REQUIRED` 或 `REFS_WBS_INGEST_MODE=REQUIRED` | 不构造存储客户端；附件与签名证据路由无能力 |
| D2 | 病毒扫描桥（ClamAV + HTTPS 侧车） | `REFS_ATTACHMENT_MODE=REQUIRED` | 无扫描客户端；附件无法准入 |
| D3 | OIDC issuer（RS256 + JWKS） | 始终，除非 `REFS_INTERNAL_TEST_MODE` | **启动失败** |
| D4 | 签名 WBS 收据 provider（Ed25519 keyring + trust pin） | `REFS_WBS_INGEST_MODE=REQUIRED` | 签名准入不可用；不加载 keyring |
| D5 | WBS live-read pilot 网关（Cloudflare Access + `X-REFS-Auth`） | `REFS_WBS_LIVE_PILOT_MODE=ENABLED` | 无 pilot 客户端；provider 读不可用 |

## 2. Fail-closed 实跑证据

对 `accountingServerConfig()` 施加七组环境组合（完整表见 S35 §1）。要点：

- **打开但无凭据 = 启动即拒**，而非"开着不工作"：D5 缺凭据 → `WBS_CF_ACCESS_CLIENT_ID is required`；D1/D2/D4 缺凭据 → `S3_ENDPOINT is required`；D3 缺失 → `OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required`
- **模式是严格枚举**：`REFS_WBS_LIVE_PILOT_MODE=enabled-ish` 被拒，不会静默降级为 DISABLED
- **依赖关系被强制**：`REFS_WBS_TEST_IMPORT_MODE` 不能脱离 live pilot
- **全关时不误报能力**：进程可启动，但明确上报 `attachmentMode/wbsIngestMode/wbsLivePilotMode` 三个 `DISABLED`

## 3. 扫描器 fail-closed（D2）— 结构性保证，非仅配置

链路（`runtime/attachment-storage.mjs` + `scanner-sidecar/`）：
1. 客户端 `HttpVirusScanner`（`:186-190`）在**构造时**即要求 HTTPS + bearer + 私有 CA pinning（`:187`）；有界重试，仅 5xx/429/超时可重试（`:189`）
2. 扫描器不可用 → bridge 返 503 `SCAN_FAILED` → `scan()` 重试耗尽后抛 → `AttachmentEvidenceService.finalize`（`:219`）**在到达 `kernel.finalizeAttachment` 之前抛出**
3. 附件行停留在 `finalization_status='PENDING'`，15 分钟后过期，由清理扫掠

**关键点：这不只是"配置正确"，而是数据库层的结构性不变式。** `003:192` 要求 `p_scan_clean=true` 且 `p_scan_ref` 非空才可接受；`001:144` 要求 `VERIFIED_CLEAN ⇒ scan_status='CLEAN'`。**不存在任何代码路径能让未扫描的附件变成 VERIFIED_CLEAN。**

**诚实限定**：不存在以"扫描器 fail-closed"命名的专用测试。该性质由约束结构保证，不由某个测试断言（详见 N21 §12）。本文据此表述，**不得写成"已有测试覆盖 fail-closed"**。

## 4. 超时与恢复

| 面 | 值 | 出处 |
|---|---|---|
| 运行时 PG 语句超时 | **10000 ms**（范围 100–600000） | `runtime/config.mjs:58` |
| 运行时 PG 锁超时 | **5000 ms** | `runtime/config.mjs:58` |
| 施加点 | 每个 `pg.Pool` | `runtime/db.mjs:17-18` |
| 扫描器流超时 | 30 s；50 MiB 上限 | `scanner-sidecar/bridge.mjs:6-7` |
| 扫描器重试 | `maxAttempts` 默认 3，指数退避 `retryBaseMs*2^(n-1)` | `attachment-storage.mjs:189` |
| 附件上传窗口 | **15 分钟** | `003:140` |
| 清理租约回收 | 5 分钟 | `003:90` |
| outbox 投递退避 | 指数底 2，指数封顶 14，延迟封顶 **86400 s** | `279:85` |
| outbox 死信阈值 | `attempt_count >= 8`（默认） | `279:86-88` |

池卫生：`runtime/db.mjs:26-29` 注册池 `'error'` 监听发 `database_idle_client_error`，其注释（`:20-25`）记录了真实事故——`refs-accounting-api-staging` 反复 "Instance failed: exited with status 1"，S32 读回 2026-09-17。

**恢复缺口（转引 N20 §5.3）**：outbox `FAILED` 是**终态**，全库无任何函数把它移回 `PENDING`，无重投路由。这是恢复链上的实质缺口。

## 5. Readiness 是否会误绿

`runtime/accounting-server.mjs:74` 的 `RECENT_ACCOUNTING_WORKFLOW_READINESS` 是一条纯 SQL 布尔：它逐一断言 6 张表 `to_regclass IS NOT NULL`、18 个函数 `to_regprocedure IS NOT NULL`，以及 18 个 `has_function_privilege('refs_app', ..., 'EXECUTE')`。

**评估：**
- ✅ **对数据库面不误绿**——它检查的是对象存在**且 `refs_app` 确有 EXECUTE 权限**，而不是只 ping 一下连接。迁移跑了一半或授权丢失都会让它变红
- ⚠️ **它完全不覆盖 D1/D2/D4/D5**。readiness 为 true 只意味着"数据库 schema 与授权就位"，**不意味着 S3、扫描器、provider、WBS 网关可用**
- ✅ 但这不构成误绿，因为这些依赖的 fail-closed 发生在**启动时**（§2）：若它们被打开却不可用，进程根本起不来，readiness 无从返回 true

**综合判定：readiness 未误绿，但其语义是"数据库就绪"而非"系统就绪"。** 建议在运维文档中明确这一点，避免把 readiness=true 读成全系统健康（D-S36-1）。

## 6. 实跑的合约测试

| 面 | 文件 | 结果 |
|---|---|---|
| 附件存储 + OIDC 认证器 | `attachment-storage` + `oidc-authenticator` | **22 / 22 通过** |
| WBS pilot / 只读 MCP / pull | `wbs-live-pilot-client` + `wbs-readonly-mcp` + `wbs-pull-contract` | **18 / 18 通过** |
| staging 环境校验 + 冒烟 | `validate-staging-env` + `staging-smoke` | **8 / 8 通过** |
| **合计** | | **48 / 48，0 失败，0 跳过** |

## 7. 本项不能证明什么

1. **未联系任何真实 S3、扫描器、OIDC issuer、provider 或 WBS 网关**。全部证据来自配置探针、代码结构与测试替身
2. **未验证真实端点的超时与恢复行为**——只验证了配置的超时值与重试策略的代码路径
3. **按约束"不将健康检查通过标为生产验收完成"**：本文件不构成任何生产或 staging 的验收

## 8. Owner 决策

- **D-S36-1** 是否在运维文档与监控面板中明确标注 readiness 的语义边界（"数据库就绪"≠"系统就绪"），并为 D1/D2/D4/D5 各增加独立的依赖健康探针。
- **D-S36-2** outbox 死信无重投（同 D-N20-2）——这是恢复链上唯一的硬缺口。
- **D-S36-3** 是否需要在真实 staging 端点上重跑 S36（需要 S3/scanner/OIDC 的可用端点与凭据；本会话不持有也不请求）。
