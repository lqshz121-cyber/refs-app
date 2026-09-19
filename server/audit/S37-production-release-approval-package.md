# S37 — 生产发布审批包（GO / NO-GO 建议）

会话 claude-9c9cd162 · 2026-09-19 · 候选 `e4c72c23` · 分支 `claude/2026-09-16-n-batch-9c9cd162` · 迁移链头 `433_outbox_health_read.sql`

> 本文件**只产生建议**，不执行部署，不请求部署授权。按任务书 S37："仅产生 GO/NO-GO 建议"。

---

## 建议：**NO-GO**（当前状态不建议发布到生产）

**这不是因为质量不达标——技术门禁基本是绿的。而是因为发布的前置条件里有若干项只有 Owner 能给，且其中至少三项尚未给出。在这些给出之前，"发布"这个动作没有可审查的依据。**

下面把依据分成三类：已绿的、需 Owner 决策才能判定的、以及确定性阻断项。

---

## 1. 已绿的门禁（可实证）

### 1.1 迁移链完整性
| 项 | 值 | 证据 |
|---|---|---|
| 迁移链头 | `433_outbox_health_read.sql` | 目录末项 |
| up 迁移数 | **439** | `ls db/migrations/*.sql` |
| down 迁移数 | **439** | `ls db/migrations/down/*.sql` |
| MIGRATION_MANIFEST 条目数 | **439** | 实跑 `MIGRATION_MANIFEST.length` |
| 上下对称 | 双向 `comm` 均为空 | 无缺口 |
| 清单校验和 | 每条 `{name, up, down}` 双向 SHA-256 | `postgres-runtime-contract.test.mjs:110-124` 遍历全部 |
| **新增**：文件↔清单双向一致 | 本会话新增门禁 | `tests/table-census-drift.test.mjs` N34-2 |
| 不可逆屏障 | **恰 1 个**（401），43 个条件性屏障 | `migration-barrier-contract-postgres.test.mjs:70-75` |
| 回滚台账守卫 | `MIGRATION_LEDGER_AHEAD` 拒绝旧版本对新库启动 | `runtime/migrations.mjs:150` |
| 破坏性操作守卫 | `DB_DOWN_FORBIDDEN`（非 `_test` 库拒绝 down/reset） | `runtime/migrations.mjs:107` |

### 1.2 业务 E2E（S34 实跑，隔离临时 PG16 实例，链头 433）
**46 / 46 通过，0 失败，0 跳过**，覆盖 JE 全生命周期、过账 SoD、AP、AR、银行—账面对平、报表反向追溯、证据→报表分阶段追溯、仅 POSTED 投影、关闭期间写入矩阵。详见 `S34-staging-accounting-e2e.md`。

### 1.3 外部依赖 fail-closed（S36 实跑）
**48 / 48 通过**。七组配置探针证明：任何被打开却缺凭据的外部依赖**启动即拒**；模式是严格枚举，拼写错误不被静默降级；全关时明确上报 DISABLED，不谎报能力。详见 `S36-staging-external-dependencies.md`。

### 1.4 备份 / 恢复 / 回滚
`BACKUP-PITR-RUNBOOK-P14.md`、`BACKUP-RESTORE-DRILL.md`、`PRODUCTION-RECOVERY-RUNBOOK.md`、`MIGRATION-RUNNER-RUNBOOK.md` 均在位；P14 备份/PITR/告警/演练 5/5 通过（commit `ee1aa14d`）。

### 1.5 发布治理与拓扑
`RELEASE-GOVERNANCE-P15.md`（233 行：main 保护、CI 门禁、迁移校验门禁、四服务版本一致、金丝雀、回滚、Owner 签核模板）、`PRODUCTION-RENDER-TOPOLOGY.md`、`OBSERVABILITY.md`、`OUTBOX-DISPATCH-RELEASE-RUNBOOK.md`。

### 1.6 安全扫描
P13 `tools/secret-scan.mjs`（11 条窄规则，含 Render deploy hook / JWT / cookie / 带密码的非本地 DB URL），`npm run security:secret-scan`，6/6；候选 diff 11,703 新增行扫描干净（commit `9badbad8`）。

---

## 2. 需 Owner 决策才能判定的项（不是技术问题）

| 决策 | 为何阻断发布 |
|---|---|
| **D-0-1 / D-0-2**（O 包）推送候选并授权四面部署、部署顺序 | 没有部署授权，发布动作本身无依据 |
| **D-O10-1** 内测 API Render 设置补 Pre-Deploy `npm run db:up` | 不补则部署顺序被强制为 正式 API → 内测 API，顺序错会导致 schema 落后 |
| **D-O11-1** 237 个不可审计的真实公司名称：追认还是回滚占位 | 这是**真实数据治理问题**。带着它上线，等于把一批无审批链的名称固化进生产 |
| **D-O02-2** staging 六个互异 actor 的 JE 角色授予 | 没有它就无法在 staging 做真实四眼验收（S34 只在临时实例上证明了内核行为） |

---

## 3. 确定性阻断项（技术侧，需在发布前解决或明确接受）

按严重度排序。每一项都在本批 N 审计中有完整取证。

### 3.1 【中，已降级】附件证据的实体作用域 — N21 §10（经 L20 实测更正）

**更正**：本包初稿据读码判定为【高】，称未扫描/已判毒附件可充当手工分录证据。**L20 红队实测（8/8 通过）推翻了该结论**——`require_finalized_source_link_attachment`（`001:725-738`，触发器 `001:757`）在写 `source_link` 时以 23514 拒绝任何非 VERIFIED_CLEAN 附件，整条命令回滚。**系统在这一维上 fail closed。**

残留的是**跨实体**一维：`002:1042` 与 `001:731` 两道守卫都只按 `tenant_id` 匹配，因此同租户内**另一实体**的 VERIFIED_CLEAN 附件可作为本实体分录的证据。多实体租户下这让证据链跨越实体边界。

→ 不再构成发布阻断。**D-N21-1 已降级为中**，可在发布后按计划处理。

### 3.2 【高】五个 HTTP 列表端点无界 — N38 §2
`source-documents`、`account-register`、`match-candidates`、`worksheet`、`chart-of-accounts` 的 SQL 无 `LIMIT`，且 HTTP 的 `requireExactQuery` 白名单不含任何分页键——**调用方无法自愿限界**。其中 `account-register` 直读 `ledger_line`。

10 秒 `statement_timeout` 限制时长而非响应体积；这五个函数中**没有** `54000` 有界总体守卫。

→ 在真实数据量下这是可用性与内存风险。**D-N38-1 须在发布前定调**（至少对 `account-register` 与 `source-documents`）。

### 3.3 【中】减值 Draft 缺 Post 守卫 — N18 §5.1
全库 7 个 `WHEN(NEW.status='POSTED')` 守卫触发器（337/341/343/345/349/355/360）中**432 缺席**。折旧与处置在 Post 时会重新绑定证据，减值不会。

### 3.4 【中】outbox 死信终态，无重投 — N20 §5.3
`FAILED` 后无任何函数可将其移回 `PENDING`。且迁移 433 表头自陈：staging worker 自 **2026-09-02** 起 Suspended，积压无人观测。发布前应确认生产 worker 的运行与观测安排。

### 3.5 【中】webhook 无签名 — N20 §5.4
仅静态 bearer，无 HMAC、无时间戳防重放。`webhook_subscription` 控制面**从不被调度器读取**；`webhook_delivery_history` **零写入方**（逐次投递审计链永久为空）。

### 3.6 【中】合并与抵销无真库测试 — N23 §10
633 个测试文件中仅 18 个连真库，**无一涉及 consolidation / elimination**。全部覆盖是静态 SQL 文本断言 + 进程内 HTTP 夹具。若生产会使用合并功能，这是保证缺口。

### 3.7 【低—但影响判断】两项文档/认知风险
- **N34**：仓库**无已签入表字典**（248 张表，0 张有文档）。本会话已新增 `db/TABLE-CENSUS.json` + 漂移门禁堵住"继续漂移"，但存量文档仍缺
- **N26 §3**：生产导航「Closing Accounting」实际指向**会计期间关闭**工作台，不是成交结算单。任何按导航判断能力的人都会误判。纯前端文案，**建议发布前先改**（零风险）

---

## 4. 未实现能力清单（非缺陷，但发布前须与 Owner 对齐预期）

| 能力 | 状态 | 出处 |
|---|---|---|
| 转固（CWIP → 固定资产） | **完全不存在**，且被 `197:19` + `237:32` + `341:65` 结构性堵死 | N25 §6 |
| 单元成本分摊（AREA / EQUAL） | 明确拒绝（`430:224-226`） | N25 §4 |
| 房地产 Closing 作为业务对象 | 无表、无命令、无路由；仅 AI 只读 | N26 §2 |
| 物业管理接管 / 物业主数据 | 全库零命中；无 `property_master` | N26 §4.1 |
| 预算摄入 | 表与读在，**0 处 `INSERT INTO budget_snapshot`** | N19 §2 |
| 报表调度 / 投递 / 订阅 | 零命中 | N19 §6 |
| 持股比例 / 权益法 / 少数股东权益 | 内核零命中；仅冻结演示壳 | N23 §6 |
| 外币折算 / CTA | 合并强制单币种 | N23 §9 |
| AP write-off；AR void / cancel | 无对象（AR 退款为终态） | S34 §2.3/2.4 |
| 实体以下行级授权 | 授权键为 `(tenant, actor, entity, permission)` | N32 §6 |
| 已定稿附件的保留 / 过期 / 清除 | 清理只覆盖 PENDING | N21 §7 |

**这些不应被当作"发布阻断"，但必须在发布沟通中如实说明**，否则用户会按导航与 AI 分类法（其覆盖面比过账内核更宽，见 N26 §7）推断出系统并不具备的能力。

---

## 5. 若要转为 GO，最小条件集

1. Owner 给出 **D-0-1 / D-0-2**（部署授权与顺序）与 **D-O10-1**
2. Owner 就 **D-O11-1**（237 个名称）表态
3. ~~Owner 就 D-N21-1（附件门禁）表态~~ —— **已撤销**：L20 实测证明该路径 fail closed，残留的跨实体作用域降级为中，不再是发布前置
4. Owner 就 **D-N38-1**（无界读）表态：至少 `account-register` 与 `source-documents`
5. 确认生产 outbox worker 的运行与观测安排（呼应 433 表头记录的 staging 积压）
6. 与 Owner 对齐 §4 的未实现能力清单，确认发布沟通口径
7. 建议顺带改掉「Closing Accounting」标签（零风险）

**满足 1–6 后，本文件可改判为 GO（带条件）。技术门禁本身不是当前的瓶颈。**

---

## 6. 本文件不构成什么

- 不构成部署授权，不请求部署授权
- 不构成对任何已部署环境的验收——S34 的 46/46 是在**临时 PG 实例**上，不是 staging，更不是生产
- 不以"页面能打开"或"健康检查通过"替代业务验收
- readiness=true 的语义是"数据库就绪"，非"系统就绪"（S36 §5）
