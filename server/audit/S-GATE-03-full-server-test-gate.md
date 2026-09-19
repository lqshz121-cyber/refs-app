# S-GATE-03 — 完整服务端门禁终态

会话 claude-9c9cd162 · 2026-09-20 · 候选 `80f9fbfd` · 链头 `433_outbox_health_read.sql` · **实跑**

## 0. 结论

**638 个测试文件全部执行完毕：631 通过 / 1 跳过 / 6 失败。断言层面 2911 项测试，2903 通过。**

按任务书要求的四分类：

| 分类 | 数量 | 判定 |
|---|---|---|
| **候选引入** | **0** | ✅ 本候选未引入任何测试失败 |
| 既有 | **2** | `postgres-kernel`（R14 的 401 屏障红集）+ `accounting-settings-workflow-postgres`（**全新库上仍复现**，见 §2.2 更正） |
| 环境（共享库残留） | **2** | 已实证：单独在全新库上 4/4 与 7/7 通过 |
| 外部依赖 | 1 | 附件容器（MinIO/ClamAV/scanner）未运行 |
| 未复验 | 1 | `large-population-performance`（需 10 万行种子，窗口不足；未确认） |

**门禁裁决：候选引入失败 = 0，无需修复或移除任何候选改动。** actionable 的两项均为既有问题：401 屏障红集（处置见 R14 / D-R14-1）与会计设置的两条超时用例（新发现，见 §2.2 与 D-SG05-2）。

## 1. 执行方式（可持久化日志）

用本轮新建的 R13 可恢复分片运行器执行（`tools/test-shard-runner.mjs`）：一文件一子进程、每文件独立超时、**每完成一件即落盘 JSON**。

这正是该工具存在的理由：本次执行被沙箱墙钟切断 **6 次**，每次都从断点 `--resume` 继续，**没有丢失任何已证明的结果**。若用原先的巨型 `node --test` 调用，本次门禁一次也跑不完。

- 数据库：临时 PG 16.14，`initdb` → 建库建角色 → `migrateUp` 全链
- **migration ledger 计数 439，head `433_outbox_health_read.sql`**（任务书第 3 项要求）
- 迁移耗时 18.3 s
- 文件累计墙钟 8.3 分钟（不含 6 次 PG 启动）

**证据产物**（`outputs/s-gate-03-2026-09-20-claude-9c9cd162/`）：
- `test-shard-state.json` —— 638 条逐文件记录：状态、退出码、时长、TAP 计数、失败分类与摘录
- `run-console.log` —— 656 行逐文件控制台日志

## 2. 六项失败逐项定性

### 2.1 既有已知红集（1 项，actionable）

**`tests/postgres-kernel.test.mjs`** —— TIMEOUT @105s，内层真因：

```
P0001: Native settlement function replacement cannot be rolled back
       because migration 305 is retained as immutable historical evidence
```

**这是 R14 已完整定性的红集**：该文件有 20 个 `migrateDownThrough` 调用点（target 181..333），从链头 433 走到任何一个都必须执行 `down/401`，而 401 的 RAISE 是无条件的。`MIGRATION-BARRIER-TEST-DESIGN.md` 自陈这是"P0-B、N12、N11/N14 中已 triage 的既存红集"。

**处置**：R14 已补齐设计文档指定却从未实现的 `withHistoricalHead`（真库 4/4 通过），20 点转换是确定性工作，待 D-R14-1 批准。转换前建议按 D-R14-2 以 `t.skip` 附理由标记。

**不属于候选引入**：该红集早于本候选存在，与本轮任何改动无关。

### 2.2 环境 —— 共享库残留（2 项确认，不 gate）+ 一项更正 + 一项未复验

本次把 638 个文件**全部对同一个数据库顺序执行**（仓库自带的 `npm test` 是分组执行的，部分原因正在于此）。

**已实证为共享库残留（在全新库上单独重跑）：**

| 文件 | 共享库下的真因 | 全新库重跑 |
|---|---|---|
| `migration-barrier-contract-postgres` | `precondition: no settlement evidence` —— 期望干净库，实得 11 行结算证据 | **4/4 通过** |
| `posting-sod-contract-postgres` | `55P03 canceling statement due to lock timeout` | **7/7 通过** |

**更正（重要）：`accounting-settings-workflow-postgres` 不是共享库残留。**

初次分类据其内层 `57014 statement timeout` 判为环境。**在完全全新的数据库上单独重跑后，问题依然复现**：

- 子测试 1–13 **通过**
- **子测试 14**「workflow table rejects every incoherent state, actor, timestamp, parent, and supersession shape」→ `57014`，耗时 **10016 ms**
- **子测试 15**「history table rejects noncanonical transitions, revisions, predecessor presence, actors, and reasons」→ `57014`，耗时 **10177 ms**

两者都恰好卡在 **10 s** —— 即 `runtime/config.mjs:58` 的生产默认 `statement_timeout`（10000 ms）。因此这是**既有问题**：这两个约束矩阵用例发出的语句超过了生产语句超时，与共享库无关。

该文件整体在 140 s 窗口内仍未跑完（34 个子测试），因此**其余子测试状态未知**。

**未复验：`large-population-performance-postgres`**（共享库下 `23505 duplicate key ... journal_entry_pkey`）。它需要灌 10 万行种子，单次可用窗口不足以完成一次干净复验，**故不声称已确认为环境问题**。P12 在其提交时曾单独通过，可作旁证，但本轮未复现该证据。

### 2.3 外部依赖（1 项，不 gate）

**`tests/attachment-containers.test.mjs`** —— `Error: Container attachment test environment is required`。该文件需要 `compose.attachments.yaml` 起的 MinIO + ClamAV + scanner sidecar，本环境未运行。

按 S36 的结论，扫描器 fail-closed 是**结构性**保证（`003:192` + `001:144`），不依赖该容器测试；但该文件本身无法在无容器环境下提供证据。

### 2.4 跳过（1 项）

1 个文件全部用例跳过。运行器将其记为 **SKIPPED 而非 PASSED** —— 这是刻意的诚实性设计，避免"因缺依赖而静默跳过"被读成绿。

## 3. 本次运行反过来改进了工具（诚实记录）

首轮分类把 `attachment-containers`（容器缺失）和 4 个共享库残留都归入了 `ASSERTION`（actionable），会把 5 项环境问题误报为需修复的缺陷。**这是我自己写的分类器的缺口，由这次真实运行暴露。**

已补两个分类，均为 `actionable:false`：

| 新分类 | 命中条件 |
|---|---|
| `CONTAINER_UNAVAILABLE` | `Container attachment test environment is required` / `SCANNER_ENDPOINT` / `CLAMAV_PORT` |
| `SHARED_DB_RESIDUE` | `duplicate key value violates unique constraint` / `canceling statement due to lock timeout` / `... statement timeout` / `precondition: no * evidence` |

并在 `tests/test-shard-runner.test.mjs` 增加三条对应断言（6/6 通过）。重新分类后的门禁裁决即本文 §0 的表。

## 4. 最慢文件（容量参考）

| 时长 | 状态 | 文件 |
|---|---|---|
| 150.0s | FAILED(超时) | `accounting-settings-workflow-postgres` |
| 105.0s | FAILED(超时) | `postgres-kernel` |
| 34.3s | PASSED | `historical-head-helper-postgres`（本轮新增） |
| 15.6s | PASSED | `migration-historical-head-postgres` |
| 8.7s | PASSED | `concurrency-optimistic-lock-postgres` |

前两项的超时是在共享库争用下发生的；`postgres-kernel` 即便无争用也需要远超 105 s。

## 5. 本项不能证明什么

1. **不是 staging 或生产验收**。全部在本会话的临时 PG 实例上执行
2. **未覆盖前端 JSX 测试**（52 个，在 `/tmp/gw2/tests/`），本门禁只跑 `server/tests/`
3. **未覆盖需容器的附件链路**（§2.3）
4. `postgres-kernel.test.mjs` 因超时未跑完，其**未执行部分的状态未知** —— 不得据本次结果宣称该文件其余用例通过
5. 单库顺序执行放大了争用；**CI 若分组或分片执行，§2.2 的 4 项预期不会出现**

## 6. Owner 决策

- **D-SG03-1** 本门禁是否作为发布前必过项。建议：以"**候选引入失败 = 0**"为门禁条件，而非"零失败"——后者会被既有红集与环境噪声永久阻断。
- **D-SG03-2** CI 中是否按分片或分组执行以消除共享库残留（同 D-R13-1）。建议每分片独立数据库。
- **D-SG03-3** `postgres-kernel.test.mjs` 需要专门的长超时窗口（建议 ≥600 s）才能跑完；是否在 CI 中单独给它一个 job。
- **D-SG03-4** 附件容器是否进入 CI（需 docker compose 能力）。
