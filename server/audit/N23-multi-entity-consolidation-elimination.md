# N23 — 多实体 / 公司间 / 合并 / 抵销审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

**纠正一个常见误判：合并与公司间抵销不是"没做"。** 它们是持久化的、受 SoD 控制的内核对象，有完整状态机、四眼 CHECK、证据哈希与陈旧性守卫。

真正的缺口更窄也更具体：**无实体层级与持股比例**（因此只支持 100% 全额合并，无权益法、无少数股东权益）、**抵销只改合并报表不进任何总账**、**合并仅支持单币种与完全对齐的期间边界**、**无合并财务报表（只有列报科目试算平衡）**。

## 2. `entity` 表：扁平，无层级，无持股

`001:29-43`。列：`entity_id, tenant_id, entity_code, source_system, source_entity_id, name, base_currency, active, created_at`。

已核验：全库 439 个迁移中 `ALTER TABLE entity\b` 命中 **0**（仅有 `ALTER TABLE entity_identity_change` 之类的同前缀名）。**无 `parent_entity_id`、无持股列、无层级表。** 实体是扁平独立的，只由 `tenant_id` 与 `base_currency` 区分。

唯一实体相邻的后加表是 `entity_identity_change`（`427:11`），是名称/来源绑定/active 变更的审计链，不是层级。

**集团结构不表达在 `entity` 上，而是按每次报告运行、作为合并快照上的显式成员枚举表。**

## 3. 公司间往来：两套机制

### 3.1 单元转移（370/371）— 真正的双实体过账，带 due-to/due-from 与配对

- `unit_transfer_pair`（`370:37`）载 `source_entity_id`/`target_entity_id`、`source_due_from_account_code`/`target_due_to_account_code`、双方映射快照与期间
- 状态机 `370:78`：`DRAFT_PAIR → PENDING_REVIEW_PAIR → PENDING_APPROVAL_PAIR → APPROVED_PAIR → POSTED_PAIR`（+ `CANCELLED_PAIR`）
- 权限 `370:3-18`：`REAL_ESTATE.UNIT_TRANSFER.{VIEW,CREATE,SUBMIT,REVIEW,APPROVE,REJECT,CANCEL,POST}`
- `unit_transfer_elimination_basis`（`370:112-121`）持久化 `carrying_amount`、`transfer_price`、`intercompany_profit CHECK(>=0)`、双方 `journal_entry_id`、`source_cost_layers`、`evidence_hash` —— **这是绑定到两个实体各自真实已过账分录的未实现内部利润基础记录**
- `unit_transfer_ic_open_item`（`371:14-28`）：`direction IN('DUE_FROM','DUE_TO')`、`counterparty_entity_id`、`original_amount`/`remaining_amount`、`status IN('OPEN','SETTLED')`，FK 指向 `journal_entry` 与 `ledger_line` —— **这是真正的往来明细账**
- 后续修正：405（跨实体币种）、406（双实体 outbox）、408（分录门禁枚举）

### 3.2 公司间对账读（080）— 只读，不产生分录

`refs_get_intercompany_reconciliation` — `080:12`。

- 配对**绝不从科目码/摘要/金额推断**：要求双方各自发布、且已审批的 `mapping_snapshot` family=`INTERCOMPANY_ACCOUNT_PAIR`（索引 `080:8-10`）
- 守卫：实体须相异否则 22023（`080:53-55`）；对**双方**断言 `GL.REPORT.VIEW`（`080:56-57`）；期间边界须精确对齐否则 22023（`080:65-67`）
- 返回双方期末余额、`difference_amount`、`in_balance`，及双方 JE/JL/GL/来源单据 ID 数组
- `080:3-7` 自陈"creates neither an elimination entry nor an adjustment"
- HTTP `GET .../reports/intercompany-reconciliation` — `accounting-http.mjs:1837-1848`

## 4. 合并（082 + 384）

### 4.1 快照 schema（082）

- `consolidation_snapshot`（`082:6-26`）：`reporting_entity_id`、`reporting_period_id`、`group_ref`、`version`、`currency`、`receipt_hash`、`snapshot_hash`、`prepared_by`、**`CHECK(approved_by <> prepared_by)`（`082:19`）**
- `consolidation_member`（`082:28-44`）：显式 `member_entity_id` + `member_period_id` 列表。**这是数据库里唯一的"层级"——每快照一份扁平成员名单，无父子、无比例**
- `consolidation_account_map`（`082:46-55`）、`consolidation_elimination_evidence`（`082:57-67`）
- 四表全部 RLS（`082:74-81`）+ `reject_mutation()` 追加写（`082:82-85`）

### 4.2 合并试算平衡读

`refs_get_consolidation(p_tenant,p_entity,p_period,p_group_ref)` — `082:87`。每 `(presentation_account_code, presentation_side)` 一行，含 `member_actual_amount`、`elimination_amount`、`consolidated_amount`（= 前者减后者，`082:147`），加完整 JE/JL/GL/来源单据溯源数组。

拒绝态（`report_status`，`082:138-142`，是**值不是错误码**，被阻断时金额置 NULL）：`BLOCKED_MEMBER_SCOPE_REQUIRED`、`BLOCKED_MEMBER_PERIOD_OR_CURRENCY_REQUIRED`、`BLOCKED_MEMBER_POSTED_EVIDENCE_REQUIRED`、`BLOCKED_ELIMINATION_EVIDENCE_REQUIRED`、成功态 `APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT`，以及 373 包装器加的 `BLOCKED_STALE_INTERCOMPANY_ELIMINATION_SOURCE`。

注意作用域微妙处 `082:107`：成员作用域失败被捕获并降级为 `BLOCKED_MEMBER_SCOPE_REQUIRED`，**不向上抛 42501**。

### 4.3 合并配置工作流（384）

- 权限 `384:2-9`：`GROUP.CONSOLIDATION.CONFIG.{VIEW,CREATE,SUBMIT,APPROVE}`，APPROVE = CRITICAL
- 状态机 `DRAFT(0) → PENDING_APPROVAL(1) → APPROVED(2)`，maker/checker CHECK `384:23`
- `refs_guard_consolidation_configuration_workflow`（`384:37-41`）：无门禁行则抛 **42501**「requires an authoritative command」
- `refs_validate_consolidation_configuration`（`384:47-62`）：报告期须 `ledger_code='PRIMARY'` 且 `status='OPEN'`；1–200 成员；1–5000 科目映射；**每个成员须通过 `refs_assert_scope(...,'GL.REPORT.VIEW')`（`384:54`）**；每个成员期间的 `starts_on`/`ends_on` 须完全相同且成员 `base_currency` 须等于集团币种（`384:55`）；映射源科目须存在且 active（`384:60`）。全部失败用 **23514**
- APPROVE 时（`384:75`→`384:80`）原子写入 `consolidation_snapshot` + `_member` + `_account_map`

## 5. 抵销分录（373）— 存在且受控，但**只改报表不进总账**

- 权限 `373:3-22`：`GROUP.INTERCOMPANY_ELIMINATION.{VIEW,CREATE,SUBMIT,REVIEW,APPROVE,CANCEL,POST}`，APPROVE 与 POST 均 CRITICAL
- 状态机 `373:41`：`DRAFT → PENDING_REVIEW → REVIEWED → APPROVED → POSTED`（+CANCELLED）。非法转换由触发器 `373:119-138` 拦截 → **55000**；绕过权威命令 → **42501**（`373:125`）
- **四眼是表级 CHECK（`373:59-62`）**：`reviewed_by<>created_by`；`approved_by ∉ {created_by,reviewed_by}`；`posted_by ∉ {created_by,reviewed_by,approved_by}`
- `source_classification`/`counterparty_classification` 就是 **`DUE_FROM`/`DUE_TO`**（`373:32,36`），CHECK 强制互反且反号（`373:54-55`）；`matched_amount = LEAST(abs(source),abs(counterparty))`（`373:56`）；**`raw_mismatch = source + counterparty` 被保留，从不静默吸收**（`373:57`）
- `intercompany_elimination_line`（`373:78-90`）：恰两行（`line_no IN(1,2)`），CHECK 强制 `DUE_FROM ⇒ 列报借方/分录贷方`，反之亦然（`373:89`）
- 一个来源范围同时只能有一个活跃批次：偏唯一索引 `373:73-74`
- 期间控制：Draft **与** Post 都要求 OPEN 的 PRIMARY 报告期，否则 **55000**（`373:404`、`373:505`）
- 来源陈旧性：Draft 前（`373:410`）、每次转换前（`373:450`）、Post 前（`373:512`）三次重算比对，任何漂移 → **40001**
- Post 前平衡证明（`373:513-514`）：恰 2 行、借贷相等且等于 `matched_amount`，否则 **23514**

### 5.1 承重发现（已逐行核验 `373:510-525`）

`refs_post_intercompany_elimination` **不写 `journal_entry`、不写 `journal_line`、不写 `ledger_line`**。它：
1. 开 `intercompany_elimination_internal_gate` 的 `PROJECT` 门禁行
2. `INSERT INTO consolidation_elimination_evidence(...) SELECT ... 'INTERCOMPANY_ELIMINATION_BATCH:'||batch||':LINE:'||line_no ...`
3. 把批次翻到 `POSTED` 并写 `post_evidence_hash`

**因此抵销只改变合并"报表"，从不触及任何成员实体的总账。** 反向由触发器 `refs_guard_intercompany_elimination_projection`（`373:142-156`）强制：任何 `elimination_ref` 以 `INTERCOMPANY_ELIMINATION_BATCH:` 开头的证据行，必须产生于某个已审批批次的 Post 事务内，否则 **42501**。

事后陈旧性：373 把 082 的函数改名为 `refs_get_consolidation_082`（`373:263`）并包装（`373:266-287`）——若某已 POSTED 批次的来源证据其后变化，受影响的合并行翻为 `BLOCKED_STALE_INTERCOMPANY_ELIMINATION_SOURCE`，金额置 NULL。

## 6. 持股比例 / 少数股东权益 — 内核 NOT IMPLEMENTED

全库 `db/migrations/` 与 `runtime/` 中 `ownership_pct`、`ownership_bp`、`minority_interest`、`noncontrolling`、`equity_method` 命中 0。SQL 中 `ownership` 仅两处且均非股权：`unit_transfer_unit_control.current_owner_entity_id`（`370:331-339`）与资本化维度规则里的 `ownership_requirement ∈ {REQUIRED,OPTIONAL,FORBIDDEN}`（`374:203`）。

合并隐含**仅 100% 全额合并**：`refs_get_consolidation` 不加权求和成员金额（`082:120-128`）再减抵销，**无比例因子、无少数股东权益行**。

持股**确实被建模，但只在冻结的前端演示壳里**：`src/consolidation-groups.js` 定义 `parent_entity_id`、`ownership_bp`（基点，0..10000，`:251-252` 校验）、`method ∈ {FULL,EQUITY,EXCLUDED}`。其自身表头（`:43-50`）声明所有成员均为 FULL@10000bp 且"Non-controlling interest measurement is NOT implemented"。该文件只被 `src/module-consolidation.jsx` 引用，后者只被 `src/legacy-demo-app.jsx:30` 引用；而 `legacy-demo-app.jsx:1-3` 自陈是"Frozen pre-Phase-2 demonstration shell… intentionally not imported by the production entry point"，`src/app.jsx` 确认生产入口只导入 `AuthoritativeApp`。**按实现口径计为 NOT IMPLEMENTED。**

## 7. 维度

过账上的维度是**形状校验的自由 jsonb，不是注册表**：`journal_line.dimensions jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof='object')`（`001:393`），`ledger_line` 同（`001:430`）。**无维度键白名单、无逐键 FK、无维度值注册表、无维度校验函数。**

确实存在的具名维度主数据：

| 主数据 | 位置 | 版本 | 审批 | 停用 |
|---|---|---|---|---|
| `account_master` | `002:49-61` | ❌ | ❌ | ✅ `active` |
| `member_master` | `002:63-73` | ❌ | ❌ | ✅ `active` |
| `counterparty_change` | `327:26-41` | `expected_version` | ✅ maker/checker | — |
| `project_master` 等（429） | `429:27,50,73,97` | ✅ `revision` | ✅ | ✅ `RETIRED` |
| 设置级 `dimension_rules[]` | `374:203,304` | ✅（设置快照工作流） | ✅ | `effective_from/to` |

**`property_ref`、`unit_ref`、`cost_code_ref`、`lease_ref`、`party_ref` 无主表**——它们只是 jsonb / 来源行里的字符串。全库无 `property_master`（`CREATE TABLE [a-z_]*propert[a-z_]*` 只命中 `wbs_property_rent_*` 证据表）。**在一个房地产内核里，物业维度未注册，这是实质缺口。**

## 8. 跨实体读拒绝 — 42501 已确认

`refs_assert_scope`（`002:566-576`）：租户不符或实体未授权 → `'Tenant/entity scope denied'` **42501**（`:570`）；实体级权限缺失 → `'Permission % denied'` **42501**（`:573`）。HTTP 映射 `accounting-http.mjs:334` → **403**。

RLS 在行级重申同一规则（`082:78-81`、`373:109-116`、`384:34-35`），且抵销批次策略要求调用方对**报告、来源、对手方三个实体全部**有授权（`373:110`）。

**42501 语义过载**（同 N32 §6）：它同时表示作用域拒绝、SoD 拒绝与内部门禁绕过。

## 9. 缺口清单

1. 数据库中无实体层级与持股结构；集团成员是每快照的扁平枚举，无父子、无合并方法、无成员生效日
2. 无持股比例、无比例合并、无权益法、无少数股东权益
3. **抵销从不进任何总账**（`373:517-518`）。合并读之外的任何消费方看不到抵销
4. 抵销范围是**每批次一个科目对、恰两行**（`373:79`、`373:514`）。无多行、无收入/成本抵销、无长期股权投资与所有者权益抵销、无未实现利润抵销过账。单元转移记录了 `intercompany_profit`（`370:112-121`）但**无命令消费它生成抵销批次**
5. **合并仅单币种**（`384:55`、`082:108`）。无外币折算、无外币报表折算差额（CTA）
6. 合并要求成员期间边界**逐字节相同**（`384:55`、`082:108`）。不支持不同会计日历的成员
7. **无合并财务报表**。`refs_get_consolidation` 返回的是列报科目试算平衡，没有合并资产负债表/利润表/现金流量表函数
8. `refs_get_consolidation` 在无快照时**静默返回零行**（`082:104-105` `IF NOT FOUND THEN RETURN;`）——空 200 与"该集团无科目"不可区分
9. 无物业维度主表；过账维度是未校验 jsonb
10. 合并配置审批要求报告期 `OPEN`（`384:51`）——**无法为已关闭期间建立或审批集团配置**

## 10. 测试覆盖与其性质（重要限定）

- `consolidation-configuration-migration-contract.test.mjs` — **静态 SHA + token 断言**
- `intercompany-elimination-migration-contract.test.mjs`（92 行）— 静态 SHA/token 断言
- `intercompany-elimination-{contract,http,kernel-wiring}.test.mjs` — DTO / 进程内 HTTP 夹具
- 单元转移：`unit-transfer-{contract,http,kernel-wiring,migration-contract,cross-entity-currency-fix,dual-entity-outbox,journal-gate-enum-fix,pair-read-arity-fix,post-lineage-guard-fix,transition-status-outbox-fix}.test.mjs`
- AI 层：`ai-intercompany-close-review*`、`authoritative-intercompany-mappings*`

**诚实限定**：**合并与抵销没有任何真 PostgreSQL 测试。** 633 个测试文件中仅 18 个引用 `DATABASE_URL`，且无一提及 consolidation/elimination。全部合并/抵销覆盖都是**静态 SQL 文本断言 + 进程内 HTTP 夹具**。这是实质保证缺口。此外未发现针对 `082_consolidation_read.sql` 的专用契约测试。

## 11. Owner 决策

- **D-N23-1 合并模型边界**。当前是 100% 全额合并 + 单币种 + 期间边界完全对齐。是否需要持股比例/权益法/少数股东权益/外币折算？这是**重大 schema 扩展**，须先由 Owner 确认集团实际结构（是否存在非全资子公司、是否存在不同本位币实体）。
- **D-N23-2 抵销是否需要进总账**。当前抵销只改合并报表。若审计或税务要求抵销可在某个"合并实体"的账上留痕，需要新建合并账套实体与过账路径——属重大变更。
- **D-N23-3 未实现内部利润抵销**。`unit_transfer_elimination_basis.intercompany_profit` 已被记录但无消费方。是否新建从该基础生成抵销批次的命令。
- **D-N23-4 物业维度主表**。是否新建 `property_master`（对齐 429 的 DRAFT/APPROVED/RETIRED + revision + 四眼），并把 `property_ref` 从自由字符串收为 FK。需评估存量 jsonb 中的 `property_ref` 取值分布——**属只读盘点，可在获授权后进行**。
- **D-N23-5 合并/抵销真库测试**。是否要求为 082/373/384 补真 PG 集成测试。当前"静态文本断言"不足以支撑生产验收。
- **D-N23-6** `refs_get_consolidation` 无快照时的静默空返回是否改为显式 `BLOCKED_SNAPSHOT_REQUIRED` 状态值（前向、低风险）。
