# N25 — CWIP 与项目成本全链审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

项目主数据（429）与单元售出结转（430）已实现且受控；CWIP 余额可被 rollforward 报表读出。但全链存在**一个结构性断点和一个结构性缺失**：

1. **转固（CWIP → 固定资产）完全不存在**，且被上游 CHECK 结构性堵死。
2. **WBS Cost→CWIP 摄入路径写空维度**，因此这条路进来的成本对 429/430 的项目/单元读**完全不可见**。

两者合起来意味着：成本可以进 CWIP，报表能看到 CWIP 总额，AI 能提示项目已完工，然后**没有任何代码路径能把这笔余额转到资产台账**。

## 2. 三条互不相通的成本归集路径

### 2.1 WBS Cost→CWIP 摄入（132/133/137/138）

- 复核证据 `wbs_cost_cwip_review_evidence` — `132:7`
- 命令 `refs_create_wbs_cost_cwip_draft` — `133:13`，现行定义 `138_wbs_cost_cwip_draft_idempotency.sql`
- 科目取自已审批 `mapping_snapshot.output_rules->>'cwip_account_code'` / `'offset_account_code'`（`133:31`）；金额取自 `source_document.gross_amount`（`133:31`）；四眼在 `133:26`
- 走 `refs_create_auto_journal`（`133:37-38`）建 AUTO Draft，权限 `WBS.COST.CWIP.DRAFT` + `GL.JE.AUTO.CREATE`（`133:19-20`）

**关键发现**：发出的分录行携带 `'dimensions','{}'::jsonb` — `138:36`（原 `133:36`）。**无 `project_ref`、无 `cost_code_ref`、无 `unit_ref`。**

因为 `refs_read_project_cost_layers` 过滤 `l.dimensions->>'project_ref'=p_project_ref`（`429:308`），`refs_read_unit_sale_closeout` 同理（`430:117`），**这条路进来的成本永远不会出现在项目成本层或单元结转读里**，尽管它会计入 `refs_get_cwip_rollforward`。

### 2.2 建设期利息资本化（431 + AI 读 199/200/219/247/248/259/283/296/363）

`loan_master` 的 `capitalizationStart/End` + `projectRef` + `cwipAccountCode` 是全有或全无的窗口，在 `api/accounting-http.mjs:2655-2656` 以 `INCOMPLETE_CAPITALIZATION_WINDOW` 校验。

### 2.3 普通 Draft 分录携带维度

这是 429/430 设计针对的路径，且是**明示设计**：`429:12-16` 原文声明本迁移"不新增任何过账路径：资本化、成本转移与单元释放仍是携带维度的普通 Draft 分录（GL.JE.CREATE）"。

## 3. 项目 / 成本码 / 单元主数据（429）

| 表 | 行 | 要点 |
|---|---|---|
| `project_master` | `429:27` | `project_type IN('DEVELOPMENT','RENTAL','LAND','OTHER')`；`capitalization_policy IN('CWIP_UNTIL_COMPLETION','EXPENSE_AS_INCURRED')`；`status IN('DRAFT','APPROVED','RETIRED')`；`CHECK(approved_by<>created_by)` (`429:47`) |
| `project_cost_code` | `429:50` | `cost_category IN('LAND','HARD','SOFT','FINANCING','MARKETING','OTHER')`；`capitalizable boolean NOT NULL`；需 APPROVED 父项目 (`429:180`) |
| `project_unit` | `429:73` | `allocation_basis IN('AREA','EQUAL','SPECIFIC_IDENTIFICATION')`；`allocation_weight CHECK(>0)`；需 APPROVED 项目 (`429:207`) |
| `project_master_event` | `429:97` | 追加写；`event_type IN('CREATED','APPROVED','RETIRED')` |

生命周期 `refs_transition_project_master` — `429:223`：APPROVE 需 DRAFT + 异人（`429:244-245`）；RETIRE 需 APPROVED 且无 APPROVED 子对象（`429:248-251`）；`revision` 乐观锁，冲突 40001（`429:242`）。

权限 `429:18-25`：`PROJECT.MASTER.VIEW`(LOW/READ) / `.CREATE`(HIGH/DRAFT) / `.APPROVE`(HIGH/APPROVE)。

## 4. "成本层"是两个不同的东西 — 务必区分

**(i) 项目成本层（429）** — `refs_read_project_cost_layers` `429:293`。按 `(cost_code_ref, unit_ref, account_code)` 归集 POSTED 且带 `dimensions.project_ref` 的台账行（`429:304-323`）。`layer_class='CWIP'|'NON_CWIP'` 纯由期末是否存在覆盖该科目的 APPROVED `CWIP_ACCOUNT_CLASSIFICATION` 映射决定（`429:310-316`）。异常码 `429:326-332`：`PROJECT_NOT_REGISTERED`、`PROJECT_NOT_APPROVED`、`COST_CODE_MISSING`、`COST_CODE_NOT_APPROVED`、`UNIT_NOT_APPROVED`、`CWIP_ON_NON_CAPITALIZABLE_CODE`。载荷硬置 `can_capitalize:false, can_transfer:false, can_post:false`（`429:348`），HTTP 在 `accounting-http.mjs:2594` 复核。

**(ii) 单元转移成本层（370，跨实体）** — `refs_unit_transfer_cost_snapshot` `370:175-196`。按 `(property_ref, unit_ref)` 的 POSTED 科目余额快照，带 `ledger_line_ids` 与 `basis_hash`，落在 `unit_transfer_pair.source_cost_layers`（`370:70`）。这是**账面价值快照，不是分摊**。

**分摊本身 NOT IMPLEMENTED。** `allocation_weight` 被存储（`429:81`）、被读出（`429:283`）、被 HTTP 校验（`accounting-http.mjs:2752`），但**从未参与任何算术**。`AREA` 与 `EQUAL` 被主动拒绝：`430:224-226` 抛 23514 —「Unit cost release is only defined for SPECIFIC_IDENTIFICATION units」，`430:186-187` 注释点名 Owner 决策 D-P06-1。

**命名冲突提示**：`allocation_basis` 在 AI 提案族（119/196/197/198/200）里是另一个枚举 `'ENTITY_ONLY'|'SOURCE_DIMENSIONED'`（如 `197:25`、`196:29`），同名不同义。

## 5. CWIP 科目识别：`CWIP_ACCOUNT_CLASSIFICATION`

- `mapping_snapshot` 定义在 `001:229`，其 **`family text NOT NULL`（`001:233`）无 CHECK、无目录表** → 该族名是**约定而非声明枚举**
- 首现于 077：偏索引 `mapping_snapshot_cwip_account_read_idx ... WHERE family='CWIP_ACCOUNT_CLASSIFICATION'` — `077:8-10`，rollforward 在 `077:53` 使用。`077:3-7` 声明 CWIP 绝不从科目名称、前缀、项目名、来源表头或 WBS 状态推断
- 规范解析器 `refs_cwip_account_class` — `430:73-87`：取生效日上 APPROVED 快照中 `priority` 最高者，返回 `candidate_count`，调用方要求恰为 1（`430:121`、`430:231`）。同优先级多候选 = 未解析，绝不猜测（`430:55-56`）
- **口径不一致**：077(`:53`)、248(`:10`) 接受 `status IN('APPROVED','RETIRED')`；429(`:312`)、430(`:80`) 只接受 `'APPROVED'`

## 6. 转固（CWIP → 固定资产）— NOT IMPLEMENTED，且被结构性堵死

已核验：
- 全库 `refs_*cwip*transfer*` / `refs_transfer_cwip` / `refs_capitalize_cwip` 匹配数 **0**
- `placed_in_service|cwip.*fixed_asset|fixed_asset.*cwip` 的全部命中均为 `fixed_asset_register_evidence` 上的**列名** `placed_in_service_date`，无命令、无函数、无路由

**上游结构性阻断**：`ai_invoice_capitalization_proposal.capitalization_treatment CHECK(IN('CWIP','FIXED_ASSET'))` — `197:19`，处理方式在提案时即固定。台账复核拒绝非 FIXED_ASSET：`237:32`；取得命令再次复核：`341:65`。因此**一个 CWIP 处理的提案、或一笔累积的 CWIP 余额，在本仓库中无任何代码路径可以成为已登记资产**。

唯一相关产物是只读模型 `refs_read_ai_cwip_post_completion_source` — `230:6`，其表头（`230:3`）自陈"This is a read model only"。它报告 `project_ref / project_status / completion_date / posting_date`，不提案、不过账。

`project_master.capitalization_policy='CWIP_UNTIL_COMPLETION'`（`429:34`）被存储、被读出（`429:281`），**无任何命令消费**。

## 7. 单元售出结转与 COGS 释放（430）

读 `refs_read_unit_sale_closeout` — `430:100`。仅从 POSTED 台账派生：`capitalized_cost`（CWIP 类科目净借）、`cogs_released`、`revenue_recognized`（`430:126-128`）。状态 `430:136-140`：`UNSOLD`/`REVENUE_WITHOUT_COGS`/`COGS_WITHOUT_REVENUE`/`PARTIALLY_RELEASED`/`CLOSED_OUT`。载荷硬置 `can_release:false, can_post:false`（`430:167`）。

命令 `refs_create_unit_cogs_release_draft` — `430:192`，权限 `UNIT.COGS.RELEASE.DRAFT`（`430:19-23`，authority=DRAFT）+ `GL.JE.CREATE`（`430:205-206`）。守卫：APPROVED 单元属 APPROVED 项目（`430:223`）；仅 `SPECIFIC_IDENTIFICATION`（`430:224`）；源/目标科目各恰一个已审批分类（`430:231`、`430:233`）；**该单元必须已有 POSTED 收入**（`430:241`）；金额不得超过已过账资本化成本减去**未过账在途 Draft 已占用额**（`430:247-253`）。分录 Dr COGS / Cr CWIP 携带 `{project_ref, unit_ref}`（`430:256-259`），MANUAL Draft（`430:261`）。至少一个附件（`430:211`）。

`unit_cogs_release_binding` — `430:32`，`UNIQUE(tenant_id,journal_entry_id)`，追加写（`430:53`），带 `revenue_evidence`（`430:46`/`430:267`）。

冲销即复原是设计意图：读只从 POSTED 行派生，因此 `GL.JE.REVERSE` 后单元自动回到未释放状态，无需补偿性主数据更新（`430:10-12`）。

## 8. 实质缺口

1. **转固不存在**（§6）——CWIP 链条最大的洞
2. **单元成本分摊不存在**——`AREA`/`EQUAL` 被明拒（`430:224-226`），`allocation_weight` 是死数据。Owner 决策 D-P06-1
3. **WBS Cost→CWIP 写空维度**（`138:36`），与 429/430 项目/单元读结构性脱钩
4. **`capitalization_policy` 惰性**——声明、上报、零执行
5. **无资本化/成本转移命令**——`429:12-16` 声明为有意；读硬置三个 false
6. **429 的四张主数据表与 430 的 binding 均未启 RLS / 未 REVOKE**（与 432 同病，缓解同 N18 §5.3）
7. **`CWIP_ACCOUNT_CLASSIFICATION` 无 schema 级注册表**（`001:233` 裸 text），且 077/248 与 429/430 接受的 status 集合不同
8. **`UNIT_COST_LEDGER` 是有类型无实现的报表**——它在 `report_saved_view.report_type` CHECK（`386:16`，`391:18` 扩展）与 `runtime/report-saved-view-contract.mjs:2` 中，但全库无对应 `refs_read_unit_cost_ledger` 类函数

## 9. 测试覆盖

真库：`tests/project-cost-master-postgres.test.mjs:71`（主数据 SoD/CAS/幂等/审批前置/退役守卫）、`:106`（成本层：仅按已审批映射判 CWIP、未登记引用为异常、期间边界、无账务权限）；`tests/unit-sale-closeout-postgres.test.mjs:88`（六种结转状态）、`:126`（COGS 释放守卫、绝不过账、幂等、在途 Draft 占用、冲销复原）。

stub HTTP：`project-cost-master-http.test.mjs:15,30`、`unit-sale-closeout-http.test.mjs:19,33`。

Stage3 E2E：`stage3-cost-cwip-authoritative-e2e.test.mjs` 对**mock fetcher** 驱动单份 `WBS_COST_CWIP` 单据（科目 164100/610000，金额 125.5000）的 source→POSTED JE→GL→TB 链路。

**不存在**把 `refs_get_cwip_rollforward` 输出与 `refs_read_project_cost_layers` 输出对平的测试；也不存在转固测试（无物可测）。

## 10. Owner 决策

- **D-N25-1 转固路径**。是否新建 CWIP→固定资产结转命令？需先决定：结转触发依据（`refs_read_ai_cwip_post_completion_source` 的完工日？还是独立复核？）、是否沿用 Draft-only + 四眼、以及 `197:19` 的 CHECK 是否需要前向放宽以允许 CWIP 提案转为资产。**在此决策前，任何 CWIP 余额都无法进入资产台账，这是已知且不可绕过的。**
- **D-N25-2 WBS Cost→CWIP 维度**。是否前向修 `138:36` 使其携带 `project_ref`/`cost_code_ref`？需先确定映射来源（在 `mapping_snapshot.output_rules` 增字段，还是从来源单据推导）。历史已过账行的补维度属改账，不在本会话范围。
- **D-N25-3 分摊基准**（= D-P06-1）。`AREA`/`EQUAL` 的核准分摊算法。
- **D-N25-4** `CWIP_ACCOUNT_CLASSIFICATION` 的 status 口径统一为 `APPROVED` 还是 `APPROVED+RETIRED`；以及是否为 `mapping_snapshot.family` 建注册表。
- **D-N25-5** `UNIT_COST_LEDGER` 报表类型是移除，还是补实现。
