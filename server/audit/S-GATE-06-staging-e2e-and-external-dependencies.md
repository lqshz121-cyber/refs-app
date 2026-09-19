# S-GATE-06 — staging E2E 与外部依赖

会话 claude-9c9cd162 · 2026-09-20 · 候选 `80f9fbfd` · 链头 433

## 0. 裁决：**BLOCKED（未通过，且不可由本会话通过）**

任务书两句话决定了本项的结局：

> 完成 14 场景浏览器 E2E、隔离 tenant 的 JE/AP/AR/Bank/Reconcile/report trace、OIDC/S3/scanner/WBS readonly readiness。
> **外部依赖不可用时必须 fail closed；不以本地 fake 代替 staging 验收。**

本会话**没有 staging 端点、没有凭据、没有部署授权**。按第二句，我**不能**用本地临时实例的结果充当 staging 验收。因此本项裁为 BLOCKED，并如实标注每一面已有证据的**等级**。

## 1. 证据等级定义

| 等级 | 含义 |
|---|---|
| `LIVE_VERIFIED` | 在已部署 staging 上以同一 SHA 读回 |
| `EVIDENCED` | 在本会话临时实例上实跑通过；**不构成 staging 验收** |
| `CONTRACT_ONLY` | 仅静态契约/DTO 断言，未连库 |
| `BLOCKED` | 缺授权或缺端点，未执行 |

## 2. 逐面状态

### 2.1 隔离 tenant 的 JE / AP / AR / Bank / Reconcile / report trace

**等级：`EVIDENCED`（S34，46/46 通过），不是 `LIVE_VERIFIED`。**

| 面 | 文件 | 结果 |
|---|---|---|
| JE 全生命周期 + SoD + 期间 | `e2e-scenarios-p15` | 15/15 |
| 过账 SoD | `posting-sod-contract-postgres` | 7/7 |
| AP 生命周期 | `ap-lifecycle-state-machine-postgres` | 5/5 |
| AR 生命周期 | `ar-lifecycle-state-machine-postgres` | 5/5 |
| Bank / Reconcile 对平 | `bank-to-book-tie-postgres` | 3/3 |
| report trace（报表优先反向） | `report-ledger-reverse-trace-postgres` | 3/3 |
| 证据→报表分阶段 | `evidence-to-report-stage-trace-postgres` | 3/3 |
| 仅 POSTED 投影 | `report-posted-only-projection-postgres` | 2/2 |
| 关闭期间写入矩阵 | `closed-period-write-matrix-postgres` | 3/3 |

全部在**用完即销毁的临时 PG16 实例**上，tenant/entity/actor 均为随机 UUID，**未使用任何真实账**。

**要转为 `LIVE_VERIFIED`，缺的是（同 D-S34-1）**：staging 的隔离测试 tenant、六个互异 actor 的 JE 角色授予（D-O02-2），以及确认这些写入不会污染 staging 已导入的真实数据。**本会话不自授权限、不写 staging。**

### 2.2 14 场景浏览器 E2E

**等级：`BLOCKED`。**

本会话未执行任何浏览器 E2E。理由：需要已部署的 staging 站点与可登录身份；且按 S35，当前用户访问 REFS US Staging 返回 403（缺只读 grant），**不得自行授予**。

**不以任何本地渲染或 mock 充当该项证据。**

### 2.3 外部依赖 readiness

| 依赖 | 等级 | 说明 |
|---|---|---|
| OIDC | `EVIDENCED` | 配置探针实证：缺 issuer/audience/jwks 时**启动即拒**（`OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required`）。`oidc-authenticator` 测试通过 |
| S3 | `EVIDENCED` | `REFS_ATTACHMENT_MODE=REQUIRED` 而无 `S3_ENDPOINT` → 启动即拒 |
| scanner | `EVIDENCED` + **结构性** | fail-closed 由 `003:192` + `001:144` 联合保证，不依赖配置；L20-6 实测：未扫描/已判毒附件被 23514 拒绝，零写入 |
| WBS readonly | `BLOCKED` | 无授权（S35）。已实证：`REFS_WBS_LIVE_PILOT_MODE=ENABLED` 而无网关凭据 → 启动即拒（`WBS_CF_ACCESS_CLIENT_ID is required`） |
| 附件容器（MinIO/ClamAV/sidecar） | `BLOCKED` | S-GATE-03 实跑中 `attachment-containers.test.mjs` 因容器未运行而失败 |

### 2.4 "外部依赖不可用时必须 fail closed" —— 这一条**已实证通过**

七组配置探针（S35 §1 / S36 §2）证明：**任何被打开却缺凭据的外部依赖都在启动时拒绝**，不会降级成"开着但不工作"；模式是严格枚举，拼写错误不被静默当作 DISABLED；依赖关系被强制（测试导入不能脱离 live pilot）。全关时进程可启动但明确上报三个 `DISABLED` —— **不谎报能力**。

**这是 S-GATE-06 六项要求中唯一可以在离线环境下真正验证、且已验证通过的一项。**

## 3. 与 readiness 语义的重要澄清

`runtime/accounting-server.mjs:74` 的 readiness 是一条纯 SQL 布尔：断言 6 张表存在、18 个函数存在、以及 18 个 `has_function_privilege('refs_app', ..., 'EXECUTE')`。

- ✅ 对数据库面**不误绿**——检查的是对象存在**且授权到位**，迁移跑一半或授权丢失都会变红
- ⚠️ **完全不覆盖 S3 / scanner / provider / WBS 网关**

**readiness = true 只意味着"数据库 schema 与授权就位"，不意味着"系统就绪"。** 按标准约束，**不得以健康检查通过替代业务验收**。已登记 D-S36-1。

## 4. 解除 BLOCKED 所需的最小输入

| # | 输入 | 用于 |
|---|---|---|
| 1 | staging 部署到与候选同一 SHA | 一切 `LIVE_VERIFIED` 的前提（当前 staging 是 `320bcbad`，候选是 `80f9fbfd`） |
| 2 | staging 隔离测试 tenant | §2.1 转 LIVE_VERIFIED |
| 3 | 六个互异 actor 的 JE 角色授予（D-O02-2） | 真实四眼验收 |
| 4 | 只读 grant（当前 403） | §2.2 浏览器 E2E |
| 5 | WBS 只读身份 + 范围授权（D-S35-1 的五项） | §2.3 WBS readiness |
| 6 | 附件容器可运行的环境 | §2.3 容器链路 |

**以上全部为 Owner 动作。本会话不请求、不构造、不推断任何一项。**

## 5. 本文件不构成什么

- **不构成 staging 验收**。§2.1 的 46/46 是临时实例证据，等级为 `EVIDENCED`
- 不以本地 fake 代替 staging 验收（任务书明令）
- 不以 readiness 或页面可打开替代业务验收

## 6. Owner 决策

- **D-SG06-1** 是否先把 staging 部署到候选 SHA（前置：S37 §5 的最小条件集）。在此之前 S-GATE-06 的任何一面都无法转 `LIVE_VERIFIED`。
- **D-SG06-2** 是否授予只读 grant 以解除 §2.2 的 403（须按 F8 的最小权限方案：只读隔离测试实体与报表，不含 post/reopen/WBS write/admin）。
- **D-SG06-3** §2.1 的 46/46 在 staging 重跑是否作为发布前门禁（同 D-S34-1）；若是，须先确认写入不污染 staging 已导入的真实数据。
- **D-SG06-4** 附件容器是否纳入 CI 与 staging 验收范围（同 D-SG03-4）。
