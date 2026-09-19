# N18 — 固定资产折旧、减值与处置审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证，未改动任何迁移或生产数据

## 1. 结论摘要

固定资产全链（取得 → 折旧 → 减值 → 处置）**已实现且受控**：四条命令全部只产生 DRAFT 分录，经由标准 Submit→Review→Approve→Post 链条过账，期间控制 55000 在 Draft 与每次 transition 上都重新校验。折旧在 SQL 中确定性计算，不在 JS 侧做算术。

发现 3 个实质缺口（见 §5），其中 **减值 Draft 缺少 Post 守卫** 是唯一具备账务风险的一项。

## 2. 表与生命周期（取证）

资产主档不是一张 `fixed_asset_master`，而是一张**独立复核产出的证据表**：

| 表 | 迁移:行 | 关键点 |
|---|---|---|
| `fixed_asset_register_evidence` | `236_fixed_asset_register_evidence.sql:3` | `status CHECK(status='ACTIVE')` — 主档只有一个状态值；`depreciation_method CHECK(='STRAIGHT_LINE')`、`depreciation_convention CHECK(='FULL_MONTH')` 硬编码；`salvage_value CHECK(>=0 AND <cost_basis)`；`useful_life_months CHECK(BETWEEN 1 AND 600)` |
| `fixed_asset_acquisition_binding` / `_posting` | `341:4` / `341:18` | `_posting` 主键 `(tenant_id,entity_id,asset_id)` → 每资产仅一次取得过账 |
| `fixed_asset_depreciation_binding` | `355:9` | 保存 `schedule_snapshot` + `schedule_snapshot_hash` + `journal_snapshot_hash`；`attachment_ids CHECK(cardinality>0)` |
| `fixed_asset_depreciation_posting` | `355:54` | 主键含 `accounting_period_id` → 每资产每期仅一次折旧过账 |
| `fixed_asset_impairment_assessment_evidence` | `242:3` | `impairment_loss CHECK(=greatest(posted_carrying_value-recoverable_amount,0))`；`status CHECK(='INDEPENDENTLY_REVIEWED')` |
| `fixed_asset_impairment_draft_binding` | `432:29` | `UNIQUE(tenant_id,entity_id,..._assessment_evidence_id)` → 每评估一个 Draft |
| `fixed_asset_disposal_evidence` | `240:3` | `carrying_value CHECK(=disposed_cost-accumulated_depreciation)`；`gain_or_loss CHECK(=proceeds-carrying_value)` |
| `fixed_asset_disposal_draft_binding` / `_posting` | `360:9` / `337:12` | |
| `fixed_asset_post_impairment_depreciation_policy` | `358:12` | 减值后修订年限政策，需独立复核 |

用户看到的"资产状态"是**读出来的派生值**，不是主档字段：`338_fixed_asset_register_read.sql:26`（`339:28` 重述）派生 `DISPOSED_REVIEWED → DISPOSAL_POSTED → REGISTERED → ACTIVE`。

## 3. 折旧计算：SQL 内确定性，无独立排程表

`refs_fixed_asset_depreciation_schedule_snapshot` — `355:73-109`，被 `359:76` 替换。

- 月额 `round((cost_basis - salvage_value)/useful_life_months, 4)` — `355:78`
- 已历月数自 `placed_in_service_date` 至 `period.ends_on` 闭区间 — `355:79`
- 末月清尾差：钳制到 `cost_basis - salvage_value` — `355:89-92`
- 金额以 `to_char(...,'FM999999999999990.0000')` 定长文本输出，保证快照哈希稳定

**没有常驻折旧排程表。** 全库 `CREATE TABLE ...schedule...` 只命中 `ai_amortization_schedule*`(119) 与 `recurring_schedule*`(390)。计算出的排程只在每次 Draft 时写进 `fixed_asset_depreciation_binding.schedule_snapshot`（`355:33`）。JS 侧无折旧算术：`runtime/kernel-repository.mjs:748-754` 仅调哈希函数与命令。

## 4. Draft-only 与期间控制（已核验）

四条命令全部经 `refs_create_manual_journal`（`002_accounting_runtime.sql:1009`）创建 DRAFT：

| 路径 | 命令 | 建账调用 |
|---|---|---|
| 取得 | `refs_create_fixed_asset_acquisition` `341:44` | `341:75` |
| 折旧 | `refs_create_fixed_asset_depreciation` `355:173` | `355:193` |
| 处置 | `refs_create_fixed_asset_disposal` `360:103` | `360:127` |
| 减值 | `refs_create_fixed_asset_impairment_draft` `432:63` | `432:132` |

期间控制：`refs_create_manual_journal` 在 `002:1025-1027` 以 `ERRCODE='55000'` 拒绝非 OPEN 期间；每次非 REJECT 的 transition 在 `002:1092-1096` 重新校验。折旧额外要求**恰好等于 OPEN 期末日**：`355:124` / `359:141`，同为 55000。

## 5. 实质缺口

### 5.1 减值 Draft 缺少 Post 守卫（唯一账务风险项）

已核验：全库带 `WHEN(NEW.status='POSTED')` 的触发器共 7 个，分布在 337 / 341 / 343 / 345 / 349 / 355 / 360。**432 不在其中**——它唯一的触发器是 `fixed_asset_impairment_draft_binding_append_only`（`432:51-52`，`BEFORE UPDATE OR DELETE`，追加写保护），不是过账守卫。

后果：折旧在 Post 时会重跑 `refs_validate_fixed_asset_depreciation_ready`（`355:210`）、处置在 Post 时会重新推导快照（`360:143`），而减值分录从 Draft 到 Post 之间**不会把分录行重新绑回评估证据**。`432:107-112` 的"已反映在 Posted 账"检查只在 Draft 时求值。

建议：为 432 增加与 355/360 同形的 Post 守卫，并在 binding 上补 `journal_snapshot_hash` 列。属前向迁移，需 Owner 批准（D-N18-1）。

### 5.2 无子账—总账控制科目勾稽

现有勾稽全部是**按资产、走 `fixed_asset_register_evidence_id` 维度**的：`refs_read_fixed_asset_register_v2`（339）、`refs_read_ai_fixed_asset_posted_reconciliation`（238→354→`372:54`）。

**不存在**把资产台账合计与总账资产/累计折旧控制科目余额对比的读。因此一笔**打到 170100 但不带资产维度**的分录不会被任何勾稽发现。全库唯一的控制科目勾稽表是 `wbs_h1_accounting_control_reconciliation`（`273:7`），其 `module_code CHECK(='PAYABLE')`（`273:11`）。

### 5.3 432 未启用 RLS / 未 REVOKE

341（`:15-16`）、355（`:50-51`）、360（`:37-38`）都做了 `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` + `REVOKE ALL FROM PUBLIC,refs_app`；`432:29-52` 三项皆无。

缓解：全库无 `ALTER DEFAULT PRIVILEGES`、无 `GRANT ... ON ALL TABLES`，`refs_app` 无直接表权限。属纵深防御不一致，非开放读路径。

### 5.4 其他（能力边界，非缺陷）

- 折旧方法/惯例被 CHECK 硬编码为 `STRAIGHT_LINE`/`FULL_MONTH`（`236:3`，`355:123`/`359:140` 重申）。余额递减、工作量法、半年/期中惯例 **NOT IMPLEMENTED**
- 无批量折旧运行：每资产一条命令一张分录，无 `depreciation_run` 对象
- 无减值转回命令：242/243/432 只减不转；处置时在 `360:123` 冲销累计减值
- 无部分处置/部分报废：`337:44` 要求处置清掉**全额**先前成本，`240:6` 约束 `disposed_cost = asset.cost_basis`
- 处置价款只取自 `source_document.gross_amount`（`360:124`、`360:116`），从不取自请求；零价款处置必须提供零额来源单据（`360:118`）
- 维度名分裂：`432:114-121` 自陈 243 用 `impairment_assessment_evidence_id`，而 336/337/339/340/352/357/358/359/360 用 `fixed_asset_impairment_assessment_evidence_id`；432 同时写两种拼写（`432:122-127`）作为过渡，待 Owner 决策 D-P08-1

## 6. 测试覆盖

真库（`tests/postgres-kernel.test.mjs` 内 `pgTest` 行号）：7856/7872/7886/7900/7914/7921/7931/7952/7960（处置完整性、时间线、来源绑定、序列化、强制取得）；8200–8220（减值+处置台账绑定 10 个用例，含双锁序并发与 Post 时来源漂移）；8222（真 HTTP 读回台账）；8223–8292（减值后政策链）；8304–8369（台账读、签名游标分页、**100 001 资产分页**、过账审计身份）；8390–8451（原始来源绑定与取代序列化）；**8826**（折旧排程在使用年限后停止并清末月尾差）；**8847**（折旧留痕、单 Post 竞态、刷新台账 GL 与报表）；**8919**（处置推导平衡 Draft 并在 Post 重验证据）。

专用真库文件：`tests/fixed-asset-impairment-draft-postgres.test.mjs:81,97`。

HTTP 契约（**stub kernel，无库**）：`fixed-asset-{impairment-draft,depreciation,disposal,acquisition,acquisition-options,depreciation-options,post-impairment-policy}-http.test.mjs`。

## 7. Owner 决策

- **D-N18-1** 是否批准为 432 补 Post 守卫 + `journal_snapshot_hash`（前向迁移 + PG 测试），使减值与折旧/处置的 Post 时重绑定一致。
- **D-N18-2** 是否需要资产子账 ↔ 控制科目勾稽读（可发现不带资产维度的越权分录）。需先确定资产/累计折旧控制科目的权威来源（COA 设置 or 新映射族）。
- **D-N18-3** 是否为 432 补齐 RLS + REVOKE，与 341/355/360 对齐。
- **D-N18-4** 直线法之外的折旧方法是否进入路线图；若是，需先决定 `236:3` 的 CHECK 如何前向放宽而不破坏已有证据。
