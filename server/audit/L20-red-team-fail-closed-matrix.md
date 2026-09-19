# L20 — 真实性与权限红队 fail-closed 矩阵

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · **实跑，非静态断言**

## 0. 结论

新增 `tests/l20-red-team-fail-closed-postgres.test.mjs`，对七个攻击向量 + 一个正向对照做真库对抗测试。**8/8 通过。**

六个向量确认 fail closed；一个向量（附件）**推翻了本轮 N21 的读码结论**——系统实际上是 fail closed 的，只残留一个更窄的跨实体缺口；一个向量（WBS 写入）证明连迁移超级用户都无法篡改留存证据。

## 1. 执行环境

临时 PostgreSQL 16 实例（`initdb` → 建库 → 建平台角色 → `migrateUp` 全链 439 → 跑测试 → 销毁）。tenant/entity/actor 全为随机 UUID。**未使用任何真实账、未连接 staging 或生产。**

授权链完全走生产路径：`runtime_actor_grant` →`PostgresContextIssuer` → `refs_bootstrap_context` → 命令。每个否定用例都回读 `journal_entry`/`journal_line`/`ledger_line`/`audit_event`/`idempotency_receipt` 五张表断言**零写入**。

## 2. 矩阵结果

| # | 向量 | 结果 | 证据 |
|---|---|---|---|
| L20-0 | 正向对照（有授权、期间 OPEN、证据已验证） | **成功** | 建 Draft 成功；`ledger_line=0`（Draft 绝不入台账） |
| L20-1 | 未授权访问（完全无 grant） | **拒绝 42501**，零写入 | `refs_assert_scope` |
| L20-2 | 跨 tenant + 跨 entity | **均拒绝 42501**，零写入 | (a) 在自己租户全额授权后瞄准受害租户；(b) 同租户但 grant 绑在兄弟实体上 |
| L20-3 | 过期 token / 已撤销 grant | **均拒绝 42501**，零写入 | `valid_until` 已过；以及签发后 `revoked_at` |
| L20-4 | 伪造 context（手工设 `refs.*` GUC） | **拒绝 42501** | 直连 runtime 池设 GUC 后调 `refs_assert_scope`，在任何写入前即被拒 |
| L20-5 | WBS 写入（篡改留存证据） | **四种尝试全部拒绝** | `wbs_inbound_row`/`wbs_inbound_receipt` 的 UPDATE 与 DELETE 均被 append-only 触发器拒绝；**执行者是迁移超级用户**；事后回读 `raw` 逐字节未变 |
| L20-6 | 附件感染 | **拒绝 23514**，零写入 | 见 §3 —— 本项更正了 N21 |
| L20-7 | 期末越权 | **拒绝 55000**，零写入；且无法回退期间 | 持有真实 `GL.JE.CREATE` 仍被 CLOSED 期间拒绝；再持 `GL.PERIOD.REOPEN` 尝试无留存关闭证据的重开，亦被拒，期间仍为 CLOSED |

## 3. L20-6：一个读码结论被实测推翻

**这是本轮最有价值的一次校正，如实记录。**

N21 初稿据读码断言：`refs_create_manual_journal`（`002:1041-1043`）只校验附件"租户自有"，因此未扫描或已判毒的附件可充当证据。

**实测推翻了它。** 两道守卫共同作用：

1. **上游（弱）** `002:1041-1043` 确实只查租户自有，不查 `VERIFIED_CLEAN`、不查 `entity_id`
2. **下游（强）** 该命令在 `002:1050-1051` 写 `source_link(link_type='JE_ATTACHMENT')`，触发 `require_finalized_source_link_attachment`（**`001:725-738`**，触发器安装于 **`001:757`**），对任何 `finalization_status <> 'VERIFIED_CLEAN'` 抛 **23514**「Attachment must be VERIFIED_CLEAN before it enters the trace graph」，整条命令回滚

实测结果：

| 场景 | 结果 |
|---|---|
| 从未扫描（PENDING/PENDING） | 拒绝 23514，零写入 |
| 扫描判毒（REJECTED/REJECTED） | 拒绝 23514，零写入 |
| 附件 id 不存在 | 拒绝 23503（上游门禁） |
| 空证据列表 | 拒绝 23503（上游门禁） |
| **同租户、另一实体的 VERIFIED_CLEAN 附件** | **接受** ← 残留缺口 |

**残留缺口只有跨实体一维**：`002:1042` 的 `a.tenant_id=p_tenant` 与 `001:731` 的 `WHERE tenant_id = NEW.tenant_id` 都**不按 `entity_id` 限定**。多实体租户下，A 公司的分录可以引用 B 公司的凭证。测试以 GAP PIN 形式钉住该行为——若日后加上实体作用域，断言会失败并强制有意识更新。

**连带更正**：N21 §10 已重写；S37 的该项已从【高·阻断发布】降级为【中·不阻断】，并从"转 GO 最小条件集"中撤销。

**方法论教训**：在一个用触发器做纵深防御的 schema 里，**只读命令函数不足以判断一条路径是否 fail closed**。已登记为 D-N21-6。

## 4. L20-5 的强度值得单说

篡改尝试是用 **`refs_migrator`（SUPERUSER）** 连接发起的，不是普通运行时角色。四种尝试（UPDATE row / DELETE row / UPDATE receipt / DELETE receipt）全部被 `reject_mutation()` 触发器拒绝（`058:16-17`），事后回读 `raw` jsonb 逐字节未变。

即：**即使攻击者取得了迁移超级用户，也无法静默改写已留存的 WBS 入站证据**——只能新增 receipt + 新 `source_version`，留下痕迹。

## 5. 本项不能证明什么

1. **未覆盖 HTTP 层与前端**。全部在内核/SQL 层；HTTP 侧的 401/403 映射由其他契约测试覆盖
2. **未覆盖真实 OIDC 令牌过期**——L20-3 测的是 `runtime_actor_grant.valid_until` 与 `revoked_at`，不是 JWT 过期
3. **未做真实病毒样本测试**——L20-6 用的是 `scan_status='REJECTED'` 的数据库状态，不是真实 EICAR 文件穿过扫描器侧车
4. **未覆盖 WBS 只读接口的写尝试**（无授权，见 S35）；L20-5 测的是本地留存证据表的不可变性
5. 按约束，本文件**不构成生产或 staging 验收**

## 6. Owner 决策

- **D-L20-1** 是否把本文件接入 CI 的 PG 阶段，作为常驻 fail-closed 回归门禁。
- **D-L20-2** 是否补三项本轮未覆盖的向量：真实 EICAR 样本穿过扫描器侧车、真实 OIDC 令牌过期、HTTP 层的越权矩阵。
- **D-L20-3**（= 降级后的 D-N21-1）跨实体附件证据是否收紧。
