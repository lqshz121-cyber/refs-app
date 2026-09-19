# S-GATE-04 — main 保护与 PR 治理

会话 claude-9c9cd162 · 2026-09-20 · 候选 `80f9fbfd` · 仓库 `lqshz121-cyber/refs-app`

## 0. 授权边界（先声明）

任务书要求"**仅取证**分支保护、required checks、PR review 和 merge queue 状态；**无权限时输出 API/界面检查步骤**"。

本会话**没有 GitHub API 令牌**，因此**无法读取**分支保护配置、required checks 列表、PR review 规则或 merge queue 状态。git remote 可达（`git ls-remote` 成功），但那只证明匿名 clone 权限，不等于治理配置的读权限。

**本文因此分两部分：本地可取证的事实（§1–§3），以及需 Owner 执行的检查步骤（§4）。§4 的任何一项我都没有代为执行，也不会推测其结果。**

并重申：**本会话未 direct push main，未创建 PR，未改动任何 CI 配置。** main 本地 head 仍为 `32660997`，今日 0 提交。

## 1. 候选与 main 的差异（本地可取证）

| 项 | 值 |
|---|---|
| 候选分支 | `claude/2026-09-16-n-batch-9c9cd162` |
| 候选 head | `80f9fbfd` |
| main head | `32660997` |
| 领先 main | **2702** commits |
| 落后 main | **0** commits（无需 rebase） |
| 差异规模 | **2444 files changed, 254455 insertions(+), 5509 deletions(-)** |
| 新增 up 迁移 | **376** 个（不含 down） |

**风险提示（须写进 PR 描述）**：这是一个 2702 commit / 25 万行的差异。任何"逐行审阅"的承诺都不现实；审阅必须按**主题分层**（迁移链、内核命令、HTTP 契约、测试、文档），并以门禁证据而非人眼逐行为主要保证手段。

## 2. 现有 CI 工作流（本地可取证）

| 工作流 | 触发 | 可作 required check? |
|---|---|---|
| `accounting-kernel-ci.yml`（Accounting Kernel Gate） | `pull_request` + `push:[main]` + `workflow_dispatch` | ✅ 是。它在 PR 上触发，具备成为必需检查的条件 |
| `outbox-consumer-ci.yml` | `pull_request` + `push:[main]` + `workflow_dispatch` | ✅ 是 |
| `codeql.yml` | **仅 `workflow_dispatch`** | ❌ 否。手动触发的工作流不会在 PR 上产生检查结果（呼应 D-P13-1） |
| `deploy.yml` | `workflow_run`（在 Accounting Kernel Gate 完成后） + `workflow_dispatch` | ❌ 部署工作流，不应作为合入门禁 |
| `wbs-readonly-pilot.yml` | 仅 `workflow_dispatch` | ❌ 否 |

**结论：当前具备 PR 触发能力的只有 2 个工作流。** CodeQL 只能手动跑，因此**安全扫描目前不可能成为必需检查** —— 这与 P13 的结论一致。

## 3. 本轮新增、可纳入门禁的测试入口（本地可取证）

本会话新增并接入的脚本，均可作为 required check 的候选：

| 脚本 | 内容 | 需 PG |
|---|---|---|
| `npm run posttest`（已含本轮新增 5 个契约） | 表普查漂移、分片运行器单测、对账清算回归钉定、SOFT_CLOSED 契约、historical-head helper | 部分 |
| `npm run gate:all` | performance / concurrency / security / barriers 四组 | 是 |
| `npm run test:shard` | 638 文件可恢复分片全量（S-GATE-03 用的就是它） | 是 |
| `npm run security:secret-scan` | diff 范围密钥扫描 | 否 |

## 4. 需 Owner 执行的检查步骤（我未执行，不推测结果）

### 4.1 界面路径
`https://github.com/lqshz121-cyber/refs-app/settings/branches` → 查看 `main` 的 branch protection rule。逐项记录：
- Require a pull request before merging（是否开启；required approvals 数量；是否 Dismiss stale approvals；是否 Require review from Code Owners）
- Require status checks to pass（是否开启；**具体勾选了哪些 check 名称**；是否 Require branches to be up to date）
- Require conversation resolution
- Require linear history
- **Do not allow bypassing the above settings**（管理员是否可绕过）
- Allow force pushes / Allow deletions（应均为关闭）
- Merge queue 是否启用

### 4.2 API 路径（需具备 `repo` 权限的令牌）
```
GET /repos/lqshz121-cyber/refs-app/branches/main/protection
GET /repos/lqshz121-cyber/refs-app/branches/main/protection/required_status_checks
GET /repos/lqshz121-cyber/refs-app/branches/main/protection/required_pull_request_reviews
GET /repos/lqshz121-cyber/refs-app/rulesets
```
把四个响应原样存档为证据（注意：响应中不含密钥，可安全留存）。

## 5. 最小建议（按任务书要求提出）

按重要性排序。每一项都是**建议**，非我执行的变更：

1. **禁止 direct push main**：开启 branch protection，勾选 Require a pull request before merging
2. **至少一个审批**：required approvals ≥ 1，且开启 Dismiss stale pull request approvals when new commits are pushed
3. **禁止 force push 与删除**：Allow force pushes = off，Allow deletions = off
4. **限制管理员绕过**：Do not allow bypassing the above settings = on。否则前三项对管理员形同虚设
5. **必需检查**：把 `Accounting Kernel Gate`（`accounting-kernel-ci.yml`）设为 required。这是当前唯一在 PR 上触发的会计内核门禁
6. **把安全扫描变成可门禁的**：`codeql.yml` 当前只有 `workflow_dispatch`，需增加 `pull_request` 触发才可能成为必需检查（D-P13-1）；`security:secret-scan` 亦建议接入 PR（D-P13-2）
7. **Require branches to be up to date**：候选当前落后 main 0 commit，开启此项成本为零，但可防止未来的合入竞态

## 6. PR 描述必须包含的内容（任务书第 3 项）

创建 PR 前，以下须在描述中准确列出。**本会话未创建 PR**；以下是备好的素材：

- **差异**：2444 files / +254455 / −5509；领先 main 2702 commits，落后 0
- **迁移**：新增 376 个 up 迁移（含等量 down）；链头 `433_outbox_health_read.sql`；ledger 计数 **439**（已在 PG16 实证，见 S-GATE-03 §1）
- **回滚边界**：**迁移不可整体回滚**。链上有 **1 个无条件屏障**（`down/401_native_settlement_bank_account_control.sql`，因迁移 305 作为不可变历史证据被保留）与 **43 个条件性屏障**。回滚只能是**服务版本回滚，不是 schema 回滚**。且 `MIGRATION_LEDGER_AHEAD` 会拒绝用旧版本对已迁移到更新链头的库启动
- **门禁证据**：S-GATE-03 全量 638 文件 —— 631 passed / 1 skipped / 6 failed，其中**候选引入失败 = 0**；6 项分别为 1 既有红集（R14 的 401 屏障）、4 共享库残留（已在全新库上实证通过）、1 外部依赖缺失
- **风险**：见 S37 §3 的七项确定性阻断/风险项，以及 §4 的未实现能力清单（转固、Closing 对象、预算摄入、持股比例、AP write-off 等）——这些须在 PR 中如实列明，避免审阅者据导航或 AI 分类法推断出系统不具备的能力

## 7. Owner 决策

- **D-SG04-1** 是否按 §5 的七项配置 main 保护。第 4 项（禁止管理员绕过）最关键——缺它则前三项可被绕过。
- **D-SG04-2** 是否给 `codeql.yml` 增加 `pull_request` 触发，使安全扫描可成为必需检查（同 D-P13-1）。
- **D-SG04-3** 这个 2702 commit / 25 万行的候选是否拆分为多个 PR 分批合入。**建议拆分**——单个 PR 的审阅质量与回滚粒度都不可接受。若拆分，建议按：迁移链 → 内核命令 → HTTP 契约 → 测试与工具 → 文档。
- **D-SG04-4** `npm run gate:all` 与 `test:shard` 是否纳入 required checks（需 CI 具备 PG16，同 D-N10-1 / D-SG03-2）。
