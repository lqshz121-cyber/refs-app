# R14 — 迁移 historical-head / barrier 契约覆盖审查

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 审查 + 补齐缺失原语

## 0. 结论

任务书问："remaining tests 是否穿越 401/414？"

**答：会。20 个 `migrateDownThrough` 调用点全部仍未转换，全部会穿越 `down/401`。** 设计文档 `MIGRATION-BARRIER-TEST-DESIGN.md`（S18）已给出正确方案并实现了底层原语，但**方案里的 `withHistoricalHead` 包装器从未被实现，调用点数为 0**。

本项已**补齐该缺失原语并实证**（4/4 通过），使 20 个调用点的转换从"无工具可用"变成"逐点机械替换"。转换本身因涉及改动一个 9000+ 行的共享测试文件且每点都需真库验证，列为 Owner 决策 D-R14-1。

## 1. 屏障现状（已核验）

| 屏障 | 位置 | 性质 |
|---|---|---|
| `MIGRATION_RESET_BLOCKED` | 抛出点 `runtime/migrations.mjs:186`；屏障文件 `db/migrations/down/401_native_settlement_bank_account_control.sql` | **无条件**。理由："migration 305 is retained as immutable historical evidence" |
| `DB_DOWN_FORBIDDEN` | `runtime/migrations.mjs:107` | 非 `_test` 库拒绝 down/reset，除非 `REFS_ALLOW_DB_DOWN=1` |
| 414 族（55006） | `414_runtime_context_additive_authority_fix` | **条件性**：仅在存在未撤销上下文时拒绝 |
| 其余 43 个条件性屏障 | 分散 | 在其保护的证据存在时拒绝 |

`migration-barrier-contract-postgres.test.mjs:70-75` 对全部 439 个 down 文件跑静态检测器并断言 `deepEqual(flagged,['401_native_settlement_bank_account_control.sql'])` —— **全链恰有一个无条件屏障**，且静态检测器与实库一致。

**关键机制差异**：`MIGRATION_RESET_BLOCKED` 的 fail-fast 预检在 `migrateDown(pool,{all:true})` 内（`:177-188`）。**单步 `migrateDown(pool)` 不跑该预检**，因此会真正执行 `down/401` 的函数体并在运行时抛 P0001。这正是 `migrateDownThrough`（逐步 down）撞墙的方式。

## 2. 20 个未转换调用点

`tests/postgres-kernel.test.mjs:441` 的 `migrateDownThrough(pool,target)` 循环执行单步 `migrateDown`，直到刚刚 down 掉的正是 target。

全部 20 个 target（已核验，均低于 401）：

```
181_wbs_test_large_bank_batch (1)      302_business_document_counterparty_read (1)
185_wbs_test_bank_staged_import (2)    303_attachment_reservation_recovery (1)
189_general_ledger_page_before_lineage (1)  304_settlement_input_reads (2)
251_wbs_ai_approved_entity_period_settings_read (1)  310_credit_usage_context (1)
312_refund_bank_selection (1)          314_credit_allocation_targets (1)
317_native_sales_receipt (1)           318_sales_receipt_reads (1)
326_counterparty_register (1)          331_attachment_entry_authority (2)
333_credit_entry_attachment_authority (2)
```

从链头 433 走到其中任何一个，都必须执行 `down/401` → P0001。其中 `:2735` 与 `:2783` 两处**本就断言 55006**（预期 414 屏障拒绝），属有意；其余 18 处预期成功，**必然失败**。

设计文档 `:9-13` 自陈这正是"P0-B、N12(:7241)、N11/N14(:7733) 中триaged 的既存红集"。

**已核验：`probeMigrationRoundTrip`（16 个调用点）在事务内做单函数 down/up 后 ROLLBACK，不碰屏障，设计文档明确列为 out of scope，无需改动。**

## 3. 已实现的原语 vs 缺失的包装器

| 组件 | 状态 |
|---|---|
| `migrateUp(pool,{until})` | **已实现**（`runtime/migrations.mjs:129-130`），带 `MIGRATION_UNTIL_FORBIDDEN`（仅 `_test` 库）与 `MIGRATION_UNTIL_UNKNOWN`（须为清单文件名）双守卫 |
| 原语证明 | **已有** `tests/migration-historical-head-postgres.test.mjs` |
| `withHistoricalHead` 包装器 | **此前不存在**。全仓 `withHistoricalHead` 命中数 = 0 |
| 20 个调用点转换 | **未做** |

即：设计文档写了"conversion pattern"示例代码，但那个 helper 从未被写出来，所以转换无从开始。

## 4. 本项补齐：`withHistoricalHead`

新增 `tests/helpers/historical-head.mjs`，按设计文档 `:52-58` 的规格实现：建 `refs_hist_<rand>_test` → 重定向四个角色 URL（`runtimeConfig` 要求四者同库）→ `migrateUp({until})` → 运行 body → `DROP DATABASE ... WITH (FORCE)` → 恢复环境。

**保证**（全部由 `finally` 覆盖，body 抛错亦然）：共享门禁库不被触碰；临时库必被删除；四个角色 URL 必被还原；**不穿越任何屏障**，因为历史头是**正向**构建的，只有被测迁移会被 down 一步。

新增证明 `tests/historical-head-helper-postgres.test.mjs`，**真库实跑 4/4 通过**：

| 用例 | 断言 |
|---|---|
| R14-1 | 以 **181**（20 个 target 中最深的一个）建头；恰停在该头，其后一条不应用；被测迁移 down 再 up 成功——**401 从未被应用到该库，故无从穿越** |
| R14-2 | body 抛错时，临时库仍被删除、四个 URL 仍被还原 |
| R14-3 | 共享门禁库的链头在一次 historical-head 运行前后**完全未变** |
| R14-4 | 畸形 target 与非清单 target 在建库前即被拒（后者 `MIGRATION_UNTIL_UNKNOWN`） |

选 181 作为证明对象是刻意的：它是转换需要的最深历史头，证明了最强的情形。

该测试已接入 `posttest` 与新增的 `npm run gate:barriers`。

## 5. 剩余工作与代价

20 个调用点的转换是逐点机械替换：

```js
// 现状
await migrateDownThrough(adminPool,'317_native_sales_receipt.sql');
await migrateUp(adminPool);

// 转换后
await withHistoricalHead('317_native_sales_receipt.sql',async({pool})=>{
  await migrateDown(pool);
  await migrateUp(pool,{until:'317_native_sales_receipt.sql'});
  // 需要历史头的断言放这里，对 pool 执行
});
```

代价：每点一次 `CREATE DATABASE` + 最多 N 条迁移（设计文档估 3–8 秒/点，20 点约 1–3 分钟），**远低于当前"保证失败"的代价**。

**本会话未执行转换**，原因有三：
1. 目标是 `postgres-kernel.test.mjs`（9000+ 行的共享文件），每点转换都需按原测试意图逐一复核——设计文档 `:59-62` 自己也要求"Each conversion is reviewed against the test's original intent"
2. 其中若干点在 roundtrip **之后**还在共享库上断言功能行为，那部分须保留原样，不能机械替换
3. 每点转换后都需真库验证；20 点串行验证超出单次会话的合理范围

## 6. Owner 决策

- **D-R14-1（首要）** 是否批准执行 20 个调用点的转换。原语与 helper 已就绪并证明，属确定性工作。建议按 target 升序分批（181/185/189 → 251–318 → 326–333），每批独立验证。
- **D-R14-2** 转换完成前，这 18 个必然失败的调用点在 CI 中如何处理：标记为已知红集（现状）、`t.skip` 并附 D-R14-1 引用、还是暂时排除该文件。**建议第二种**——skip 带理由比静默红更诚实，且 R13 的分片运行器会把它们归入 SKIPPED 而非 PASSED。
- **D-R14-3** `:2735`/`:2783` 两处断言 55006 的用例，转换后语义会变（历史库上不存在活跃上下文，414 不会拒绝）。需决定：保留在共享库上测屏障，还是改为专门的屏障测试。
