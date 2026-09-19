# S35 — staging WBS 只读取证（无授权路径）

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · commit e4c72c23

## 0. 授权状态：不可用 → 按任务书走"验证拒绝与配置探针"分支

任务书原文："若授权可用，执行只读抓取的小样本与 control total；**无授权则验证拒绝和配置探针**。"

本会话环境中：
- WBS 相关环境变量数量 = **0**（`env | grep -cE '^WBS|^REFS_WBS'` → 0）
- 无 Cloudflare Access 凭据、无 `X-REFS-Auth`、无公司代码授权、无 provider 签名 keyring

按标准约束"遇到真实账号、费用、实账或权限扩张，一律停在可审查方案和证据，等待 Owner 决策"，**本会话不请求、不构造、不推断任何 WBS 凭据**，执行拒绝分支。

## 1. 配置探针实跑结果（真实执行，非静态推断）

对 `accountingServerConfig()`（`runtime/start-accounting-server.mjs:83`）直接施加七组环境组合，观察其接受/拒绝：

| # | 环境组合 | 结果 | 拒绝理由 |
|---|---|---|---|
| A | 无任何外部依赖配置 | **ALLOWED** | 上报 `{attachmentMode:"DISABLED", wbsIngestMode:"DISABLED", wbsLivePilotMode:"DISABLED"}` |
| B | `REFS_WBS_LIVE_PILOT_MODE=ENABLED`，无网关凭据 | **REFUSED** | `WBS_CF_ACCESS_CLIENT_ID is required` |
| C | `REFS_WBS_INGEST_MODE=REQUIRED`，无 keyring / trust pin | **REFUSED** | `S3_ENDPOINT is required` |
| D | `REFS_ATTACHMENT_MODE=REQUIRED`，无 S3 / 无扫描器 | **REFUSED** | `S3_ENDPOINT is required` |
| E | OIDC 完全缺失 | **REFUSED** | `OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required` |
| F | `REFS_WBS_LIVE_PILOT_MODE=enabled-ish`（拼写错误） | **REFUSED** | `REFS_WBS_LIVE_PILOT_MODE must be ENABLED or DISABLED` |
| G | `REFS_WBS_TEST_IMPORT_MODE=ENABLED` 但无 live pilot | **REFUSED** | `REFS_WBS_TEST_IMPORT_MODE may be enabled only in staging` |

**结论：拒绝路径成立且严格。**
- 任何被打开却缺凭据的外部依赖都会**在启动时拒绝**，不会降级成"开着但不工作"
- 模式是严格枚举，拼写错误不会被静默当作 DISABLED（F）
- 依赖关系被强制：测试导入不能脱离 live pilot 单独开启（G）
- **A 是关键的诚实性证据**：全部关闭时进程可启动，但明确上报三个 `DISABLED`——**不谎报能力**

## 2. 合约测试（实跑）

| 面 | 文件 | 结果 |
|---|---|---|
| WBS live pilot 客户端 / 只读 MCP / pull 合约 | `wbs-live-pilot-client` + `wbs-readonly-mcp` + `wbs-pull-contract` | **18 / 18 通过** |
| staging 环境变量校验 + 冒烟 | `validate-staging-env` + `staging-smoke` | **8 / 8 通过** |

## 3. 本项没有做、也不会做的事

1. **没有抓取任何 WBS 数据**——一行都没有。因此本回执不含 control total、不含公司身份、不含内容哈希
2. **没有构造或推断任何凭据**
3. **没有用演示数据替代**。按任务书"不能用演示数据替代"，宁可交空集加拒绝证据，也不产出看似完成的假样本
4. **未触碰 WBS 的任何写接口**

## 4. 恢复执行 S35 完整分支所缺的最小输入

若 Owner 决定推进只读 pilot，所需最小集为：

| 输入 | 用途 | 现状 |
|---|---|---|
| 已确认公司代码 | 界定 pilot 范围 | 缺 |
| WBS 只读身份（Cloudflare Access client id + secret） | `WBS_CF_ACCESS_CLIENT_ID` / `..._SECRET` | 缺 |
| `X-REFS-Auth` 网关令牌 | 网关准入 | 缺 |
| 范围授权（哪家公司、哪个月） | 防止越范围读取 | 缺 |
| `REFS_WBS_LIVE_PILOT_MODE=ENABLED` | 打开 pilot | 未设 |

**凭据绝不写入仓库或回执**——由 Owner 直接配置到运行环境。

## 5. Owner 决策

- **D-S35-1** 是否授权只读 WBS pilot，并提供上表五项最小输入。在此之前 S35 只能停在本文件的拒绝证据分支。
- **D-S35-2** 若授权，pilot 的范围（公司 + 月份）由谁指定、由谁复核。按约束，本会话不自选范围。
