# Z04 — X01/X02 发布候选审查包

会话 claude-9c9cd162 · 2026-09-20 · **禁止 push / deploy / 合 main —— 本文仅供审阅**

## 1. 强制顺序（已实测，非推断）

```
  410c967a  (基线)
      │
      ├─► 2ca4367c   X01  语句超时修复        ← 必须先
      │
      └─► 8b0bd335   X02  AP/AR 核销          ← 依赖 X01
```

在 `410c967a` 的干净 worktree 上以 `git apply --check` 实测：

| 场景 | 结果 |
|---|---|
| X01 单独 | ✅ CLEAN |
| **X02 单独** | ❌ **CONFLICTS** — `server/package.json:64` |
| X02 接在 X01 后 | ✅ CLEAN |
| 序列 X01+X02 | ✅ CLEAN |

**冲突原因**：两者是唯一共用文件 `server/package.json`，都往 `posttest` 串里加测试；X02 的上下文行里已含 X01 加的那条。
**后果**：X02 **不可单独 cherry-pick**。拆两个 PR 时，第二个必须以第一个为基线。

## 2. 精确 commit / patch

| | X01 | X02 |
|---|---|---|
| commit | `2ca4367ca6e3cb42e38e0620f397e1f0b331cc81` | `8b0bd335f37e12afd980d3db2a6ec90da36d9540` |
| 父 | `410c967a` | `2ca4367c` |
| 规模 | 4 文件 / +148 −3 | 9 文件 / +833 −3 |
| patch | `0001-X01-statement-timeout-fix.patch` | `0002-X02-ap-ar-write-off.patch` |

序列补丁：`X01-X02-series.patch`
位置：`outputs/x01-x02-patches-2026-09-20-claude-9c9cd162/`

## 3. 迁移影响

| | 值 |
|---|---|
| X01 新增迁移 | **0**（纯测试与脚本改动） |
| X02 新增迁移 | **2**：`434_ap_ar_write_off.sql`、`435_ap_ar_write_off_reducer.sql`（各含 down） |
| 合入后台账 | **441** |
| 合入后链头 | `435_ap_ar_write_off_reducer.sql` |
| 新增表 | **1**：`ap_ar_write_off_binding`（249 → 250） |
| 新增权限 | **4**：`AP.BILL.WRITE_OFF.CREATE/APPROVE`、`AR.INVOICE.WRITE_OFF.CREATE/APPROVE` |
| 改动既有对象 | `business_adjustment` 两条 CHECK 放宽；`refs_apply_ap_ar_posted_adjustment` 以 CREATE OR REPLACE 增一分支（**既有两分支逐字节沿用**） |

## 4. 预部署检查

按顺序，任一失败即停：

1. `npm run validate:staging-env` → 退出码 0
2. `npm run verify:staging-release` → 四服务 release 全等候选 SHA
3. 迁移台账读回 → **441** / 链头 `435_...`
4. `GET /health/ready` → true（**注意语义：只覆盖数据库 schema 与授权，不覆盖 S3/scanner/WBS**）
5. outbox `backlog_state` → `DRAINED` 或 `PENDING_WITHIN_WINDOW`

## 5. 回滚边界 —— **服务版本回滚，不是 schema 回滚**

| 边界 | 内容 |
|---|---|
| 无条件屏障 | **1 个**：`down/401`（迁移 305 作为不可变历史证据被保留） |
| 条件性屏障 | **44 个**，含**本批新增** `down/434`：存在核销证据时以 **55006** 拒绝（已实测，且 head 停在 434 不半拆） |
| 向前修复边界 | `down/435`（reducer 回退）**可安全执行**，即使核销数据存在 —— 它只是停止新核销 Draft 激活，不触碰已留存证据 |
| 台账守卫 | `MIGRATION_LEDGER_AHEAD` 拒绝用旧版本对更新链头的库启动。**回滚服务版本前须确认目标版本链头 ≥ 库链头** |

**实践含义**：若核销上线后需撤回，正确动作是**回滚服务版本并停用权限**，而不是回滚迁移 434。

## 6. 逐项测试证据

| 证据 | 结果 | 环境 |
|---|---|---|
| X02 核销链 `ap-ar-write-off-postgres` | **6/6** | 全新 PG16 16.14 |
| X01 生产安全回归 `statement-timeout-production-safety` | **5/5** | 全新 PG16 |
| X01 原失败文件 `accounting-settings-workflow-postgres` | **57014 从 2 次 → 0 次，0 失败** | 全新 PG16 |
| 迁移 UP / REPLAY / DOWN 435 / DOWN 434 | 全通过 | 全新库 |
| `down/434` 条件屏障（有证据时） | **55006**，head 停在 434 | 全新库 |
| 静态屏障检测器 | 全链无条件屏障仍**恰 1 个**（434 被正确识别为条件性） | — |
| 全服务端门禁（S-GATE-03） | 638 文件 / 631 通过 / **候选引入失败 = 0** | 临时 PG16 |

## 7. 本包未做

- **未 push**（候选领先 origin 55 个提交）、**未部署**、**未合 main**、未改 Render 或分支保护
- 未在任何 staging 或生产环境验证；上表全部证据等级为 `EVIDENCED`，**非** `LIVE_VERIFIED`

## 8. Owner 决策

- **D-Z04-1** 顺序 X01→X02 已实测强制。批准按此顺序合入，或批准作为单一序列补丁合入。
- **D-Z04-2** 核销上线后若需撤回，确认走"服务版本回滚 + 停用四个权限"而非回滚迁移 434（§5）。
- **D-Z04-3** 是否把 §4 的五步预部署检查固化进发布检查单。
