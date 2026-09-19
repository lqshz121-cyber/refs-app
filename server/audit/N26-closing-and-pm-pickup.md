# N26 — Closing 与 PM Pickup 审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证
任务书明确要求："禁止把 UI 视为实现"。本文对每一项都分别核验了内核侧与前端侧，并标注哪一侧存在。

## 1. 结论摘要

| 对象 | 内核实现 | 前端 | 判定 |
|---|---|---|---|
| 房地产 Closing（成交结算单）作为业务对象 | ❌ 无表、无状态机、无命令、无路由 | 生产导航有「Closing Accounting」但指向**会计期间关闭** | **NOT IMPLEMENTED** |
| Closing 作为 AI 只读面 | ✅ 单个函数 `refs_read_ai_closing_settlement_source`（249） | 无 | 已实现（只读） |
| PM Pickup = 物业管理接管/上线 | ❌ 全库零命中 | 仅冻结演示壳 | **NOT IMPLEMENTED** |
| PM Pickup = WBS 物业租金 pickup | ✅ 三表 + 三命令 + 完整 SoD | ✅ 生产工作台，真 API | 已实现（止于 Draft） |

**最需要向 Owner 报告的一点**：生产导航里标着「Closing Accounting」的条目，点进去是**会计期间关闭工作台**，不是成交结算单。任何按导航判断能力的人都会得出错误结论。

## 2. Closing —— 内核里只有一个 AI 只读函数

### 2.1 唯一存在的产物

`refs_read_ai_closing_settlement_source(p_tenant,p_entity,p_period,p_limit DEFAULT 500)` — **`249_ai_closing_settlement_source_read.sql:3`**（已逐行读取核验）。

- `PERFORM refs_assert_scope(p_tenant,p_entity,'AI.ANALYSIS.EXPLAIN')` — `249:7` → 拒绝为 42501 → HTTP 403
- `p_limit` 须 1..500 否则 **22023** — `249:8`
- 须存在 `ledger_code='PRIMARY'` 的会计期间否则 **22023** — `249:9`
- **完整总体超过 `p_limit` 时直接拒绝**（`54000`，「Complete closing settlement population exceeds the bounded analysis limit」）— `249:10`。这是防"部分总体"的控制，值得肯定
- 查询本体（`249:17-20`）：`source_document d JOIN source_document_line l ... WHERE d.source_module='closing'`，按期间日界，排除状态 `RECEIVED/VALIDATING/QUARANTINED/REJECTED/EXCLUDED/DUPLICATE`
- 派生字段：`settlement_type` 取 `external_dimension_refs->>'signed_settlement_type'`，回退 `document_type ILIKE '%SALE%' ? 'SALE':'PURCHASE'`（`249:14`）；`closing_date` 取 `signed_closing_date` 回退 `d.business_date`（`249:15`）

### 2.2 佐证性缺席（已逐条核验）

- `CREATE TABLE [a-z_]*clos[a-z_]*` 全库命中 **0**。**不存在任何 closing 表**
- `CREATE FUNCTION refs_*clos*` 全库只有 6 个：`refs_read_ai_closing_settlement_source`、`refs_close_period`、`refs_close_period_v*`、`refs_read_period_close_history`、`refs_read_period_close_readiness`、`refs_read_unit_sale_closeout`。**后五个是会计期间关闭或单元售出结转，不是成交结算**
- `source_module` 是 `source_document` 上的 CHECK，历经 `001:175` → `137:10` → `187:8` 扩展，当前允许集合 `bankFeed, payable, cost, cost_general_ledger, loan, pmCharge, closing, ai_test_prepaid`。**`closing` 只是一个来源单据标签**
- `api/accounting-http.mjs` 中 `closing` 全库命中 **1 处**，且是 `:1124` 的解析器配置 `'CLOSING_V1'`——**不存在 closing 的 REST 路由**

### 2.3 消费链（纯只读，零过账）

`runtime/kernel-repository.mjs:1285` → `runtime/ai-closing-settlement-review.mjs`，仅导出 `classifyClosingSettlementLine`（`:37`）与 `analyzeClosingSettlement`（`:46`）。七条正则把行分类为 `PURCHASE_PRICE`/`LOAN_PROCEEDS`/`TITLE_OR_CLOSING_COST`/`TAX_OR_OPERATING_PRORATION`/`ESCROW_OR_DEPOSIT`/`CREDIT_OR_CONCESSION`/`BROKER_OR_PROFESSIONAL_FEE`。每个 finding 携带 **硬编码** `ACTIONS={can_create_draft:false,can_review:false,can_approve:false,can_post:false}`（`:5`）。总体不完整时抛 `AI_CLOSING_SETTLEMENT_POPULATION_INCOMPLETE`（`:48`）。

仅注册为 AI skill：`runtime/accounting-server.mjs:241,296`；`runtime/ai-accounting-skill-registry.mjs:56` 记 id `CLOSING_SETTLEMENT_ACCOUNTING_REVIEW`，status `IMPLEMENTED_REVIEW_CANDIDATE`，`findingCategory: null`。

### 2.4 判定

**Closing 作为业务对象 NOT IMPLEMENTED。** 无表、无 ID、无状态机、无 revision、无审批、无自身期间控制（除 PRIMARY 期间存在性检查）、无分录生成（Draft 或 Posted 皆无）、无异常表、无 `audit_event`、无 `outbox_event`、无 REST 路由。

最接近的过账侧邻居是 `refs_read_unit_sale_closeout` 与 `unit_cogs_release_binding`（见 N25 §7）——它处理单元售出 COGS 释放，但**由项目/单元成本层驱动，而非由结算单驱动**。

## 3. Closing 的前端（务必区分两件事）

**(1) 权威（生产）应用。** `src/authoritative-navigation.js:110-113` 注册导航项 `closing-accounting`，标签 **"Closing Accounting"**，类型 `API_COMMAND`。`src/authoritative-app.jsx:799` 的路由为：

```js
['month-end-close','period-management','closing-accounting'].includes(route)
  && <AuthoritativePeriodCloseWorkspace .../>
```

**即生产环境标着「Closing Accounting」的页面是会计期间关闭工作台。权威应用中不存在结算单页面。**

**(2) 冻结演示壳。** `src/modules-core.jsx:565` 的 `ClosingWorkspace({ctx})` 读演示种子 `CLOSINGS[0]` 并显示借贷平衡检查（`:566-571`）。它只被 `src/legacy-demo-app.jsx:13` 引用，而该文件 `:1-3` 自陈"Frozen pre-Phase-2 demonstration shell… intentionally not imported by the production entry point"；`src/app.jsx` 确认生产入口只导入 `AuthoritativeApp`。

**按任务书口径（不得把 UI 视为实现）：结算单页面只存在于生产不加载的冻结演示壳，计为 NOT IMPLEMENTED。**

## 4. "PM Pickup" 的两种含义

### 4.1 物业管理接管/上线 —— NOT IMPLEMENTED

全仓 `/tmp/gw2` 的 `.sql/.mjs/.jsx/.js` 中 `takeover`、`take-over` 命中 **0**（已核验）。无物业接管对象、无 PM 合同、无在管物业注册表。且如 N23 §7 所述，**全库无 `property_master` 表**。

### 4.2 内核里的 "pickup" = WBS 物业租金 Pickup —— 这是真实现

持久化对象：
- `wbs_property_rent_source_admission` — `156:7`
- `wbs_property_rent_review_evidence` — `157:8`
- `wbs_property_rent_draft_evidence` — `157:25`

命令与生命周期：
- **准入** `refs_admit_wbs_property_rent_source`（`156:52`），哈希绑定 `156:44`/`156:36`。产出状态 `ADMITTED_PENDING_RENT_PICKUP_PRODUCER`（`156:128`），`can_create_draft:false, can_approve:false, can_post:false`
- **复核** `refs_review_wbs_property_rent`（`157:48`）
- **建 Draft** `refs_create_wbs_property_rent_draft`（`157:93`）
- **状态机承载在 `source_document.status` + `staging_item.status` 上**，非私有枚举：`PENDING_REVIEW → READY_FOR_DRAFT`（`157:82-83`），之后进入标准分录生命周期
- **只产生 Draft**。UI 明示："Draft creation never submits, reviews, approves, or posts the Journal"（`src/authoritative-property-rent-workspace.jsx:26`）
- **期间控制**：准入要求 OPEN 期间否则 **55000**（`156:109`）；162 增加期间限定读
- **SoD（均 42501）**：准入者 ≠ 复核者（`157:61`）；准入 ≠ 复核 ≠ 建 Draft 三方互异（`157:104`）；复核者不得是设置/映射的创建者或审批者（`157:74`）
- **映射确定性**：恰一个服务端解析的已审批设置否则 23514（`157:69`）；`mapping_snapshot` family `WBS_PROPERTY_RENT_PICKUP` 中恰一个最高优先级映射否则 23514（`157:71-73`）；映射输出须给出 `control_account='120200'`、相异收入科目、`due_days 0..365`、存在的客户、两科目均 active，否则 23514（`157:77`）
- **异常**：复核时解决 `exception_code='PROPERTY_RENT_PRODUCER_UNAVAILABLE'` 的 `accounting_exception` 行；缺失或变更 → **40001**（`157:84`）
- 乐观并发 `expected_revision` + `expected_evidence_hash`，不符 40001；幂等冲突 23505；畸形命令 22023

读与 HTTP：
- `refs_list_wbs_property_rent_pickup(tenant,entity,limit)` — `158:3`；被期间限定版 `refs_list_wbs_property_rent_pickup(tenant,entity,period,limit)` — `162:5` 取代（`162:3` 回收旧 3 参授权）
- `GET .../wbs/property-rent-pickup?periodId&limit` — `accounting-http.mjs:816-821`；`POST .../property-rent-pickup/{id}/reviews` `:838`；`POST .../property-rent-pickup/reviews/{id}/drafts` `:846`
- 内核 `listWbsPropertyRentPickup` — `kernel-repository.mjs:1729`

前端（**生产侧，有内核支撑**）：`src/authoritative-property-rent-workspace.jsx`，路由 `property-ops-pickup`（`authoritative-app.jsx:789`），导航项 "Property Ops Pickup"（`authoritative-navigation.js:109`），从 `accounting-api.js` 导入真实 API 调用。

### 4.3 演示壳里的 "PM Pickup" —— NOT IMPLEMENTED

`src/modules-core.jsx:504` 的 `PMPickup({ctx})` 由 `PM_ROWS` 与 `src/engine.js:166` 的 `pmRule` 驱动，数据全来自 `src/seed.js` 夹具。只被 `legacy-demo-app.jsx:13` 引用。**纯 UI，无内核支撑。**

## 5. 缺口清单

1. **无 closing 对象**：无表、无 ID、无状态机、无审批、无审计事件、无异常码、无 REST 路由。`source_module='closing'` 的单据能被摄入并被 AI 分类，仅此而已
2. **结算单无结转过账**。closing 路径上完全没有分录生成；`analyzeClosingSettlement` 硬编码 `can_create_draft:false`
3. **内核不强制结算单平衡**。AI 层能产出 `closing_statement_imbalance_candidate` finding，但没有任何东西拒绝或阻断不平衡的结算单
4. **生产 UI 的「Closing Accounting」是期间关闭**（`authoritative-app.jsx:799`）。这是一个会导致误判的标签
5. **无物业管理接管对象**；无物业上线流程；无物业主数据
6. **物业租金 pickup 是单笔、仅 WBS 来源绑定**。无批次概念、无批量 pickup；且依赖 `mapping_snapshot` family `WBS_PROPERTY_RENT_PICKUP` 与**硬编码控制科目 `'120200'`**（`157:77`、`157:108`）——迁移里写死科目码值得标注
7. **物业租金 pickup 止于 Draft**。审批与过账回落到通用分录生命周期，无 pickup 专属的 approve/post 命令

## 6. 测试覆盖

- Closing：`ai-closing-settlement-source-contract.test.mjs`（23 行，对 249 up/down 的**静态文本断言**，仅 REVOKE/GRANT/DROP token）、`ai-closing-settlement-review.test.mjs`（分类器单测）。**无集成测试、无库测试、无 HTTP 测试——因为没有路由**
- 物业租金 pickup：`wbs-property-rent-pickup-contract.test.mjs`（15 行静态文本）、`wbs-property-rent-pickup-http-contract`、`wbs-property-rent-source-admission-contract`、`ai-property-rent-revenue-review{,-http}-contract`、`stage3-property-rent-authoritative-e2e{,-runbook}`
- 物业管理分类器：`ai-property-management-charge-classifier.test.mjs`（7 种处理），只读分类器，`ACTIONS` 全 false

## 7. 跨领域提示（建议在 N23 与本文各记一次）

`runtime/ai-accounting-decision-packet-full-contract.mjs:6` 的 `AI_ACCOUNTING_*` 来源类型分类法**同时包含** `CLOSING_SETTLEMENT` 与 `INTERCOMPANY`，分类目标含 `CLOSING_COST` 与 `INTERCOMPANY`（`tests/ai-accounting-decision-packet-full-contract.test.mjs:49`）。**AI 决策分类法比过账内核更宽。** 检视 AI 契约的人会以为两个领域都受支持；实际只有 intercompany（经单元转移 + 抵销批次）真正持久化或过账。

## 8. Owner 决策

- **D-N26-1 Closing 是否建为业务对象**。若房地产成交结算需要在系统内成为可审计对象（绑定成交价、佣金、比例分摊、托管、贷款结清到收入/COGS/结算分录的一个可复核包），这是一个完整的新领域，需要表、状态机、四眼、期间控制与 Draft-only 过账路径。**在此决策前，结算单只能靠 AI 只读分类，不能入账。**
- **D-N26-2 导航标签**。「Closing Accounting」是否改名为「Period Close」以消除误导？（纯前端文案，零风险，建议先行。）
- **D-N26-3 物业主数据与 PM 接管**。是否新建 `property_master` 与物业接管流程（与 D-N23-4 合并决策）。
- **D-N26-4 硬编码控制科目 `'120200'`**（`157:77,108`）是否改为经审批设置解析。属前向迁移，但会改变现有 pickup 的解析路径，需回归。
- **D-N26-5** 物业租金 pickup 是否需要批量处理能力。
