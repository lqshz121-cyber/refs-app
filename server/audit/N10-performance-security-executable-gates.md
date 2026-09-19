# N10 — 性能与安全可执行门禁

会话 claude-9c9cd162 · 2026-09-19 · 链头 433

## 0. 交付

任务书要求"**实现**本地可重复门禁"，不是写报告。本项的交付是 **5 个新 npm 脚本**，把原先散落且**全部未接线**的性能/并发/安全/屏障测试变成可重复执行的门禁，外加一份"离线无法验证"的清单（§4）。

| 脚本 | 覆盖 | 需要 PG |
|---|---|---|
| `npm run gate:performance` | 10 万行分页与查询计划、热读索引契约 | 是（索引契约腿不需要） |
| `npm run gate:concurrency` | 乐观锁、上下文重试与撤销、AP 跨期并发 | 是 |
| `npm run gate:security` | L20 红队 fail-closed 八向量、过账 SoD、关闭期间写入矩阵、密钥扫描 | 是（密钥扫描不需要） |
| `npm run gate:barriers` | 401/414 屏障契约、historical-head 原语、R14 helper | 是 |
| `npm run gate:all` | 以上四者串联 | 是 |

已核验：五个脚本引用的测试文件**全部存在，无悬空引用**。

## 1. 为什么需要这一项（问题陈述）

N38 §8 与 §9 已证明：`large-population-performance-postgres.test.mjs` 与 `high-volume-read-indexes-contract.test.mjs` 在 `package.json` 中命中数为 **0** —— 两个性能相关测试**未接入任何脚本**，只能手工直接调用。同样地，L20 之前不存在，屏障测试只在一个孤立脚本 `test:postgres:barriers` 里。

后果：任何人说"我们有 10 万行性能门禁"都属夸大，因为没有任何入口会运行它。本项把这件事变成真的。

## 2. 各门禁的实际断言内容（引用须准确）

### 2.1 `gate:performance`

**`large-population-performance-postgres.test.mjs`** —— 表头 `:1-7` 自陈：墙钟时长被测量并打印作为证据，**但不被断言**，因为共享 CI 沙箱给不出有意义的时延阈值。

**因此这是"容量下的正确性契约"，不是延迟基准。不得称其为性能 SLO 门禁。** 它实际断言：
- 总体确为 100 000 行（`:88`）
- `limit:201` / `limit:0` / `offset:-1` 均以 **22023** 拒绝（`:94-96`）
- 5 页 ×200 无跨页重复（`:102-109`）；重读同一 offset 返回完全相同的 ID 与顺序（`:111-114`）；深页与前五页零交集（`:116-120`）
- 全总体聚合借贷相等，试算平衡收敛到 ≤6 行（`:123-128`）
- 一条**限定科目的** `ledger_line` 分页查询走索引（`:134-140`，`EXPLAIN` 断言 `Index (Scan|Only Scan)`）
- 单页 200 行的语句数 ≤6（`:144-151`）
- 十个并发读者返回 500 个互异 ID（`:158-162`）

**准确性限定（承 N38 §8）**：`:134-140` EXPLAIN 的是一条**手写查询**，不是 `refs_list_general_ledger`。生产总账读的真实排序键 `(journal_date, posted_at, ledger_line_id)` 没有匹配索引，也未被 EXPLAIN。**只能说"一个限定科目的分页查询已证明走索引"。**

**`high-volume-read-indexes-contract.test.mjs`** 是对 `383` 的 **SQL 源文本正则**，从不连库、从不跑 EXPLAIN —— **即使索引在真实库上从未创建，它仍会通过**。作为文档漂移告警有价值，作为索引存在性证明无效。

### 2.2 `gate:security`

- **`l20-red-team-fail-closed-postgres.test.mjs`**（本轮新增，8/8 实跑通过）：未授权、跨 tenant、跨 entity、过期 token、已撤销 grant、伪造 context、WBS 证据篡改、附件感染、期末越权。每个否定用例回读五张表断言零写入。详见 `L20-red-team-fail-closed-matrix.md`
- **`posting-sod-contract-postgres.test.mjs`**（7/7，S34 已实跑）：过账四眼、actor 绑定、租户作用域、期间、幂等
- **`closed-period-write-matrix-postgres.test.mjs`**（3/3，S34 已实跑）：CLOSED 与 SOFT_CLOSED 下每个写入族均被拒且零会计行
- **`security:secret-scan`**（P13）：11 条窄规则的 diff 范围扫描

### 2.3 `gate:concurrency`
乐观锁、上下文重试与撤销、AP 跨期并发。注意**银行/对账的双连接竞态**在 `postgres-kernel.test.mjs:7627-7728` 与 `:5337-5413` 中（见 N08 §7），因文件体量未纳入本门禁——若要纳入需接受整文件的运行时长（D-N10-2）。

### 2.4 `gate:barriers`
- `migration-barrier-contract-postgres.test.mjs`：断言全链**恰一个**无条件屏障（`deepEqual(flagged,['401_native_settlement_bank_account_control.sql'])`）
- `migration-historical-head-postgres.test.mjs`：`migrateUp({until})` 原语
- **`historical-head-helper-postgres.test.mjs`**（本轮新增，4/4 实跑通过）：R14 的 `withHistoricalHead` helper

## 3. 本轮同时补齐的两个工程缺口

1. **R13 可恢复分片运行器**（`tools/test-shard-runner.mjs` + `test:shard*` 三个脚本）。超时截断不再丢失已证明的结果；失败被分类，只有 actionable 类别 gate。635 个测试文件，分片确定且稳定
2. **R14 `withHistoricalHead`**（`tests/helpers/historical-head.mjs`）。设计文档指定了它但从未实现、零调用点；现已实现并证明

## 4. 离线无法验证的生产监控/告警项（任务书明确要求列出）

以下**只能在已部署环境验证**，本会话不持有也不请求相应端点与凭据：

| # | 项 | 为何离线不可验证 | 依赖 |
|---|---|---|---|
| 1 | Outbox 积压告警 | 健康读 `refs_read_outbox_health`(433) 存在，但**无任何东西在轮询它**（D-P10-2）。告警需真实调度器 + 通知通道 | Render 通知 / 外部监控 |
| 2 | Outbox worker 存活 | 433 表头记载 staging worker 自 2026-09-02 起 Suspended，积压无人观测 | 部署侧 |
| 3 | `database_idle_client_error` 告警 | 事件已发出（`runtime/db.mjs:26-29`），但阈值与通知在部署侧 | 日志聚合 |
| 4 | 实例重启 / crash-loop | `refs-accounting-api-staging` 的 "Instance failed: exited with status 1" 只在 Render 日志可见 | Render |
| 5 | CSP / SRI 响应头 | 属静态站响应头，由 Render 静态站配置承载，**本仓库测试无法覆盖**（D-P13-4） | 部署侧 |
| 6 | 真实时延 SLO | P12 明示不断言时延；共享沙箱无有意义阈值 | 生产 APM |
| 7 | 真实数据量下的查询计划 | 10 万行是合成总体；真实基数分布与统计信息不同 | staging 真实数据 |
| 8 | 附件清理队列积压 | **无健康读**（N21 缺口 3），离线与在线都无从观测 | 需先补读 |
| 9 | S3 / scanner / OIDC / WBS 网关可用性 | 无真实端点（S36） | 部署侧 |
| 10 | 依赖与容器漏洞扫描 | 需私有仓库 GHAS + 干净 `npm ci` 环境（D-P13-1） | CI |

## 5. 本项不能证明什么

- 门禁**已可运行**，不等于**已在 CI 中运行**。接入 CI 仍需 Owner 决策（D-N10-1），且需确认 CI 有可用 PG 并能承受 10 万行灌数时间
- `gate:performance` 是容量正确性门禁，**不是时延门禁**
- `high-volume-read-indexes-contract` 是文本断言，不证明索引在真实库上存在

## 6. Owner 决策

- **D-N10-1** 是否把 `gate:all` 接入 CI 的 PG 阶段。需确认：CI 有 PG16、能承受 10 万行灌数（约数分钟）、以及失败时谁负责分诊。
- **D-N10-2** 是否把 `postgres-kernel.test.mjs` 的银行/对账双连接竞态纳入 `gate:concurrency`（需接受整文件运行时长）。
- **D-N10-3** §4 的 10 项生产侧监控，哪些进入发布前必备、哪些可发布后补。第 1、2 项（outbox 积压与 worker 存活）建议列为必备——433 表头记录的 staging 积压就是这个缺口的真实后果。
- **D-N10-4** 是否为附件清理队列补健康读（同 D-N21-3），否则第 8 项永远无法观测。
