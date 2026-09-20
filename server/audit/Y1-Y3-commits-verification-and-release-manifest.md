# Y1–Y3 — X01/X02 提交定位、独立复核、合并顺序与发布 manifest

会话 claude-9c9cd162 · 2026-09-20 · 候选 `8558391f` · 链头 `435_ap_ar_write_off_reducer.sql`（ledger 441）

> 任务文件因路径异常尚未写入；本文先行完成其中已明确且安全的三项（定位、复核、manifest）。

## Y1 — 精确提交与补丁

| 项 | X01 | X02 |
|---|---|---|
| commit | **`2ca4367ca6e3cb42e38e0620f397e1f0b331cc81`** | **`8b0bd335f37e12afd980d3db2a6ec90da36d9540`** |
| 时间 | 2026-09-20 09:38:34 +0800 | 2026-09-20 09:56:13 +0800 |
| 父提交 | `410c967a` | `2ca4367c` |
| 改动 | 4 文件 / +148 −3 | 9 文件 / +833 −3 |

### X01 改动文件
- `server/tests/accounting-settings-workflow-postgres.test.mjs`（admin 池维护超时 + 根因注释）
- `server/tests/postgres-kernel.test.mjs`（同一潜在缺陷）
- `server/tests/statement-timeout-production-safety-postgres.test.mjs`（**新增**，137 行回归）
- `server/package.json`（接入 posttest）

### X02 改动文件
- `server/db/migrations/434_ap_ar_write_off.sql`（**新增** 268 行：命令 + 证据表 + 权限）
- `server/db/migrations/435_ap_ar_write_off_reducer.sql`（**新增** 162 行：reducer 扩展）
- `server/db/migrations/down/434_...`（39 行，含 55006 条件屏障）、`down/435_...`（106 行）
- `server/runtime/kernel-repository.mjs`（+16，`createApArWriteOff`）
- `server/runtime/migration-manifest.mjs`（+2 条目）
- `server/db/TABLE-CENSUS.json`（249→250 表）
- `server/tests/ap-ar-write-off-postgres.test.mjs`（**新增** 233 行）
- `server/package.json`

### 补丁产物
`outputs/x01-x02-patches-2026-09-20-claude-9c9cd162/`
- `0001-X01-statement-timeout-fix.patch`（29 KB）
- `0002-X02-ap-ar-write-off.patch`（82 KB）
- `X01-X02-series.patch`（111 KB，两者按序）

## Y1b — 冲突风险与合并顺序（**已实测，非推断**）

两个提交**只共用一个文件**：`server/package.json`（两者都往 `posttest` 串里加测试）。

在 `410c967a` 的干净 worktree 上用 `git apply --check` 实测：

| 场景 | 结果 |
|---|---|
| X01 单独 → `410c967a` | ✅ **APPLIES CLEAN** |
| X02 单独 → `410c967a` | ❌ **CONFLICTS**（`server/package.json:64`，posttest 上下文行已含 X01 的条目） |
| X02 → X01 之后 | ✅ APPLIES CLEAN |
| 序列（X01+X02）→ `410c967a` | ✅ APPLIES CLEAN |

**结论：合并顺序是强制的 —— X01 必须先于 X02。** X02 无法被单独 cherry-pick，除非人工解决那一处 posttest 字符串冲突。

## Y2 — 干净 PG16 独立复核

在**两个全新 PostgreSQL 16.14 实例**上从零复核（`initdb` → 建库建角色 → 全链迁移 → 跑测试）：

| 复核项 | 结果 |
|---|---|
| **Y2-A** X02 核销链 `ap-ar-write-off-postgres` | **6/6 通过**，退出码 0 |
| **Y2-B** X01 生产安全回归 `statement-timeout-production-safety` | **5/5 通过** |
| **Y2-C** 原先失败的文件 `accounting-settings-workflow-postgres` | **57014 出现 0 次**（修复前为 2 次），0 失败 |

### Y2-B 的新证据，以及一个值得注意的走向

```
X01 evidence: TRUNCATE tenant CASCADE over 250 tables = 9382ms;
              product read = 3ms; production ceiling = 10000ms
```

**表数已从 249 增至 250（X02 新增 `ap_ar_write_off_binding`），夹具耗时随之从 9.0–9.4s 升到 9382ms —— 占 10s 预算的 94%。**

这说明两件事：
1. 该夹具成本**随 schema 增长**，与数据量无关；每加一张表都更接近上限
2. **如果没有 X01 的修复，X02 自己就会把这个文件推过 10 秒边界** —— 两个改动在这一点上是耦合的

## Y3 — 发布候选 manifest

产物：`outputs/release-candidate-manifest-2026-09-20-claude-9c9cd162/release-candidate-manifest.json`
（schema `REFS_RELEASE_CANDIDATE_MANIFEST_V1`，机器可读）

| 项 | 值 |
|---|---|
| 候选 head | `8558391f` · `claude/2026-09-16-n-batch-9c9cd162` |
| 基线 main | `32660997` |
| 领先 / 落后 | **2708** / **0**（无需 rebase） |
| 差异 | **2460 文件 / +256,525 / −5,510** |
| 迁移台账 | **441** |
| 链头 | `435_ap_ar_write_off_reducer.sql` |
| 候选新增迁移 | **378** |

### 回滚边界（必须写进 PR 与发布审批）

**回滚只能是服务版本回滚，不是 schema 回滚。**
- 无条件屏障 **1 个**：`down/401_native_settlement_bank_account_control.sql`（迁移 305 作为不可变历史证据被保留）
- 条件性屏障 **44 个**（本轮新增 `down/434`：存在核销证据时以 **55006** 拒绝）
- `MIGRATION_LEDGER_AHEAD` 会拒绝用旧版本对已迁移到更新链头的库启动 —— 回滚服务版本前须确认目标版本链头 ≥ 库链头

### 已验证 / 未验证

**已验证**：迁移 UP 441 / REPLAY 幂等 / DOWN 435 / DOWN 434 / 有证据时 55006 屏障；
全服务端门禁 638 文件（631 通过、1 跳过、6 失败，**候选引入失败 = 0**）。

**未验证（如实声明）**：未部署到任何 staging 或生产；**未 push**，候选仅存在于本地（领先 origin 54 个提交）；浏览器 E2E 与 WBS 只读仍因凭据 BLOCKED。

## Owner 决策

- **D-Y-1** 合并顺序 X01 → X02 已实测强制。若要拆分为两个 PR，第二个 PR 必须以第一个为基线，否则 `package.json` 冲突。
- **D-Y-2** 这个 2708 commit / 25.6 万行的候选是否拆分（同 D-SG04-3）。**建议拆分**；本文的 merge_order 段可作为最小可合入单元的样板。
- **D-Y-3（新）** 夹具 TRUNCATE 已达预算 94% 且随建表增长。是否把"新增表时复核该夹具余量"列入迁移检查单，或改为每文件单库（同 D-SG03-2）。**按当前走向，再加约 15 张表就会重新越界，届时 X01 的修复也不够。**
