# Z03 — 测试库清理可扩展性

会话 claude-9c9cd162 · 2026-09-20 · 链头 435（250 表）

## 0. 结论

| 策略 | 实测 | 判定 |
|---|---|---|
| **A** `TRUNCATE tenant CASCADE`（现状） | **7727 ms**（同日另测 5714 / 7226 / 8440 / 9382 ms） | 占 10s 预算 77–94%，**成本随表数增长** |
| **B** 依赖图分批 DELETE | **不可行** | 250 张表中 **184 张带 DELETE 触发器**（留存证据守卫）；实测 `DELETE FROM refs_deployment_identity` 报 42501 |
| **C** `CREATE DATABASE … TEMPLATE` | **264 ms**（另测 276 / 313 / 433 / 426 ms） | **快约 29 倍**，成本随**数据量**而非表数 |
| **D** 持久夹具（每测唯一 tenant，不清理） | 未采用 | 该文件 `:263` 有一处不带 tenant 过滤的 `count(*)` 断言，依赖全局空表 |

**采用 C。** 并新增一条**防回归阈值测试**，使"再加表"不会重新静默逼近上限。

## 1. 为什么 B 不可行（这是本项最值得记的发现）

最显而易见的便宜修法是把 TRUNCATE 换成按依赖序的 DELETE —— O(行数) 而非 O(表数)。**它不可行，而且不可行的理由是好的。**

`TRUNCATE` **不触发行级触发器**；`DELETE` 会。本 schema 有大量留存证据表带 `reject_mutation()`、`refs_deployment_identity_immutable` 等 DELETE 守卫：

- **250 张表中 184 张带 DELETE 触发器**（实测 `pg_trigger` 计数）
- 实测：一次朴素的按序 DELETE 在 `refs_deployment_identity` 上以 **42501 `Deployment identity is immutable`** 中止

要让 DELETE 走通就得 `DISABLE TRIGGER`，那正是 Z03 明令禁止的"弱化测试隔离"。**夹具当初用 TRUNCATE 不是随意选择，而是绕开这些守卫的唯一途径。**

已把这条钉进 Z03-1，以免日后有人再把"改成 DELETE"当成显而易见的优化重新提一遍。

## 2. 采用的策略：克隆模板库

`server/tests/helpers/template-database.mjs`

- `ensureTemplateDatabase()` —— 整个进程只迁移**一次**，把结果标记为 `IS_TEMPLATE`
- `withFreshDatabase(body)` —— 每个消费者拿到 `CREATE DATABASE … TEMPLATE` 的全新克隆；body 结束（或抛错）后 `DROP … WITH (FORCE)`，四个角色 URL 必被还原
- `measureTeardownStrategies()` —— 供阈值测试读取的基准

**为什么快且不随 schema 增长**：`CREATE DATABASE … TEMPLATE` 是近乎空库的**文件拷贝**，成本跟数据量走；`TRUNCATE CASCADE` 要对每张表取 ACCESS EXCLUSIVE 锁并重写文件，成本跟表数走。这正是本项要解决的斜率问题。

**实现过程中撞到一个正确的守卫**：`migrations.mjs:102` 拒绝迁移名字与 `MIGRATION_DATABASE_URL` 不符的库（`MIGRATION_DATABASE_REJECTED`）。该守卫是对的，所以 helper 在迁移模板期间**临时把该变量指向模板**，迁完立刻还原 —— 而不是绕过守卫。

## 3. 防回归检查（Z03 明确要求）

`server/tests/fixture-teardown-scalability-postgres.test.mjs`，**5/5 通过**，已接入 `npm run gate:performance`。

| 用例 | 断言 |
|---|---|
| Z03-1 | 钉住"DELETE 不可替代"：DELETE 守卫表数 >100，且 `refs_deployment_identity` 的 DELETE 必须 42501 |
| Z03-2 | 克隆必须比 TRUNCATE 快一个数量级（`cloneMs*3 < truncateMs`） |
| **Z03-3** | **阈值**：`TRUNCATE` 耗时须 < 10000 ms 的 **85%** |
| Z03-4 | 克隆是可用、迁移完整（ledger >400）、彼此隔离的库，且用完即删 |
| Z03-5 | body 抛错时四个角色 URL 仍被还原 |

**Z03-3 的失败信息直接写了处置方式**，避免下一个人重蹈覆辙：

> Do NOT fix this by raising the production statement_timeout.
> Migrate the affected fixture to tests/helpers/template-database.mjs (withFreshDatabase) …

阈值取 85% 而非贴着 100%，是因为共享沙箱给不出稳定毫秒数 —— **这是趋势跳闸线，不是时延 SLO**。当前 7727 ms = 77%，还有余量；9382 ms = 94% 那次会触发。

## 4. 与 X01 的兼容关系

X01 给夹具的 **admin 池**加了维护级 `statementTimeoutMs`，**生产配置一字未改**。二者是互补而非重复：

- **X01** 让今天的夹具不再失败 —— 但对斜率无能为力
- **Z03** 处理斜率 —— 提供更便宜的替代路径，并在余量被吃掉时提前报警

两者都保留。X01 的维护超时仍是尚未迁移到克隆策略的夹具的安全网；Z03-3 是决定何时必须迁移的信号。

## 5. 本轮未做的事（有意）

**未重构 `accounting-settings-workflow-postgres.test.mjs`。** 那是 34 个子测试的文件，改成每测克隆需要重建池与逐条复核断言语义（尤其 `:263` 那条依赖全局空表的 `count(*)`）。原语已就绪并证明，转换是确定性工作，但需要它自己的验证轮次 —— 列为 D-Z03-1。

按当前斜率：**再加约 15 张表，TRUNCATE 就会重新越过 10 秒**，届时 X01 的维护超时也救不了业务语义（测试会变得极慢而非失败）。Z03-3 会在 85% 处先报警。

## 6. 交付物

- `server/tests/helpers/template-database.mjs`（新增）
- `server/tests/fixture-teardown-scalability-postgres.test.mjs`（新增，5/5）
- `server/package.json`（`gate:performance` 纳入跳闸线）

## 7. Owner 决策

- **D-Z03-1** 是否批准把 `accounting-settings-workflow-postgres.test.mjs`（及后续超阈值的夹具）迁移到 `withFreshDatabase`。原语已就绪；建议在 Z03-3 首次报警前完成。
- **D-Z03-2** 85% 阈值是否合适。更严会在共享 CI 上抖动，更松则留不出反应时间。
- **D-Z03-3** 是否把 `gate:performance` 接入 CI（同 D-N10-1）。跳闸线不跑就等于不存在。
