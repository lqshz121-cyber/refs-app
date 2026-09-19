# N19 — 预算 / 预测 / 保存视图 / 自定义报表审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

四者**都存在**，且**全部严格读侧或 Draft 侧——没有任何一个能写 `ledger_line`**。但有两个实质问题：

1. **预算没有任何写入路径**：表和读都在，全库 0 处 `INSERT INTO budget_snapshot`。数据只能由特权带外插入。
2. **保存视图从不在服务端执行**：没有任何读接受 `saved_view_id`，它只是客户端预设。

报表**调度/投递/订阅 NOT IMPLEMENTED**。

## 2. 预算（081）— 只读快照，无摄入

- `budget_snapshot` — `081:8`。含 `version`、`source_ref`、`receipt_hash`、`snapshot_hash`(`^sha256:`)、`prepared_by`、`approved_by`，**表级 `CHECK(approved_by<>prepared_by)`** — 制衡写进 schema 而非仅在代码
- `budget_line` — `081:31`。`comparison_side IN('DEBIT','CREDIT')`、`budget_amount>=0`
- RLS `081:45-54`；追加写触发器 `081:55-58`（`reject_mutation()`）
- 读 `refs_get_budget_vs_actual` — `081:59`，`refs_assert_scope(...,'GL.REPORT.VIEW')` 在 `081:72`
- 内核 `getBudgetVsActual` — `kernel-repository.mjs:3372`；HTTP `GET .../reports/budget-vs-actual` — `accounting-http.mjs:1849`

**已核验缺口**：全库 439 个迁移中 `INSERT INTO budget_snapshot` 命中数 = **0**。无内核方法、无 HTTP 路由创建或导入预算。引用 `budget_snapshot` 的 `.mjs` 只有测试夹具与 `runtime/forecast-workflow-contract.mjs`、`runtime/ai-budget-vs-actual-review.mjs`、`runtime/ai-accounting-skill-registry.mjs`。**预算摄入作为产品面 NOT IMPLEMENTED。**

## 3. 预测（388）— 完整三态审批，严格不过账

- 权限 `388:3-7`：`REPORT.FORECAST.VIEW`(LOW/READ)、`.CREATE`(HIGH/`FORECAST_DRAFT`)、`.SUBMIT`(HIGH)、`.APPROVE`(**CRITICAL**)
- `forecast_workflow` `388:13`。`status IN('DRAFT','PENDING_APPROVAL','APPROVED')`。**三方 SoD 写成表级 CHECK**：`submitted_by<>created_by`、`approved_by ∉ {created_by, submitted_by}`。状态—修订号耦合亦为 CHECK：DRAFT⇒rev0、PENDING_APPROVAL⇒rev1、APPROVED⇒rev2
- `forecast_line` `388:22`：每行必须引用 `budget_snapshot_id` + `budget_version` + `budget_snapshot_hash` + `posted_actual_evidence_hash`，并有复合 FK 指回 `budget_snapshot`。**一条预测行不可能脱离已审批的不可变预算快照存在**
- 该迁移的全部 `INSERT INTO` 目标为：`permission_catalog`、`runtime_human_permission_authority`、`forecast_workflow`、`forecast_line`、`forecast_workflow_history`、`forecast_workflow_gate`、`idempotency_receipt`、`audit_event`、`outbox_event`。**无 `journal_entry`/`journal_line`/`ledger_line`**
- HTTP：`GET .../forecasts/{workflowId}` `accounting-http.mjs:490`（ETag=revision）、`POST .../forecasts` `:2830`、`POST .../{id}/transitions` `:2842`

**缺口：无列表端点。** OpenAPI 仅有 post / `{workflowId}` get / transitions post，必须预先知道 UUID。

## 4. 保存视图（386 + 391）— 惰性预设

- 权限 `386:3-7`：`.VIEW`/`.CREATE`/`.UPDATE`(LOW)、`.SHARE`(**MEDIUM**，authority=REVIEW)
- `report_saved_view` `386:13`：`visibility IN('PRIVATE','ENTITY_SHARED')`、`filters jsonb`、`revision`、`UNIQUE(tenant_id,entity_id,owner_actor_id,name)`
- `report_saved_view_history` `386:23`：追加写，`reason` 8–2000 强制，`UNIQUE(view_id,revision)`
- 守卫触发器：DELETE 抛 **55000**「Saved report view is retained evidence」；租户/实体/属主/创建时间漂移或非 `revision+1` 抛 **42501**
- `refs_report_saved_view_payload`：行不存在**或**是他人 PRIVATE 视图 → **P0002**（私有视图以 404 隐藏，而非 403）
- 分页：`p_limit` 1–100 否则 22023；keyset `(updated_at, view_id)`
- 创建时动态选权限：`ENTITY_SHARED` 用 `.SHARE`，否则 `.CREATE`，**并额外**断言 `.VIEW`
- 391 扩展枚举 `DIMENSION_PNL`（`391:18`），并重定义校验（`391:22`）要求该类型恰含 `['dimensionRef','dimensionType']` 且 `dimensionType IN('PROPERTY','PROJECT','UNIT')`，其他类型禁带维度键

**实质缺口**：`savedViewId` 在 `accounting-http.mjs` 仅出现于 `:498` 与 `:2839`——即保存视图自身的 CRUD 路由。`refs_read_custom_report` 取显式标量参数。**没有任何报表读能"按保存视图"执行**；浏览器必须自行把视图展开成查询参数。连带后果：除 `DIMENSION_PNL` 外，`filters` jsonb 对所有报表类型都是**未校验的自由格式**。

**无审批工作流**：无 PENDING/APPROVED 态、无第二人。共享由独立权限（`.SHARE`）而非审批步骤把关。

## 5. 自定义报表（391）— 固定白名单投影，非用户定义

`391:3-6` 表头明示：渲染器是刻意固定的只读投影，无用户 SQL、无表达式语言、无动态关系、无导出、无分录、无过账面。

- 权限 `REPORT.CUSTOM.VIEW`（`391:7`，authority=READ）
- 索引 `ledger_line_custom_report_scope_idx(tenant_id,entity_id,period_id,account_code,journal_entry_id)` — `391:35`
- `refs_read_custom_report(...)` — `391:37`。白名单 `391:44`：`report_type ∈ {TRIAL_BALANCE, BALANCE_SHEET, INCOME_STATEMENT, CASH_FLOW, BUDGET_VS_ACTUAL, DIMENSION_PNL}` 且 `p_limit BETWEEN 1 AND 200`，否则 **22023**
- 总体仅取 `journal_entry.status='POSTED'`；维度过滤 `l.dimensions @> jsonb_build_object(dimension_key, p_dimension_ref)`，`dimension_key` 只从 `PROPERTY→property_ref`/`PROJECT→project_ref`/`UNIT→unit_ref` 映射
- 输出每行带 `journal_entry_ids`/`journal_line_ids`/`ledger_line_ids`/`source_document_ids` + `row_hash`；信封带 `population_source`、`approved_snapshot_hash`、`ledger_evidence_hash`、keyset，以及硬编码 `action_flags{can_create_draft:false,can_review:false,can_approve:false,can_post:false}`
- HTTP `GET .../reports/custom` `:1545`：任何命令字段 → `400 CUSTOM_REPORT_READ_FIELDS_FORBIDDEN`；响应回声与请求不符 → **`502 CUSTOM_REPORT_RESPONSE_INVALID`**

## 6. 报表调度 — NOT IMPLEMENTED

全仓 `report.{0,12}(schedul|deliver|subscri)` 与 `schedul.{0,12}report`（排除摊销/折旧排程与 `recurring_schedule`）命中 **0**。无定时报表生成、无邮件投递、无订阅。

最近似物是**循环分录调度器**（390），它调度的是分录不是报表：写 `journal_entry`(`390:78`)/`journal_line`(`390:79`) 但 `journal_type='AUTO', status='DRAFT'`，且要求到期日落在 OPEN PRIMARY 期间（否则 23514「No open period for due date」）。**不过账、不写 `ledger_line`**。同样**无列表端点**。

## 7. 前端现状

API 客户端函数齐备（`src/accounting-api.js:2793` 自定义报表、`:2799/2802/2805` 保存视图、`:3209/3212/3215` 预测、`:1077` 预算实际对比），但**无任何 UI 组件调用它们**。覆盖只到 API 客户端层（`tests/custom-report-api-client.test.js`、`tests/report-saved-view-api-client.test.js`）。

`src/modules-more.jsx:692-720` 的「Budget → Commitment → Actual → Forecast by Cost Code」屏幕由 `:692` 的硬编码 `const CC=[...]` 驱动，且只被 `src/legacy-demo-app.jsx:14`（冻结演示壳）引用。**不得引用为预算/预测能力。**

## 8. 测试覆盖与其性质

| 面 | 测试 | 性质 |
|---|---|---|
| 保存视图 SQL | `report-saved-view-migration-contract.test.mjs` | **静态 SQL 文本断言** |
| 保存视图 HTTP | `report-saved-view-http.test.mjs:6` | stub kernel |
| 自定义报表 DTO | `custom-report-contract.test.mjs:12` | 纯 DTO |
| 自定义报表 HTTP | `custom-report-http.test.mjs:8` | stub kernel |
| 预测 | `forecast-workflow-contract.test.mjs`、`forecast-workflow-http.test.mjs:5,6` | DTO/HTTP |
| 循环调度 | `recurring-scheduler-{contract,http}.test.mjs` + `postgres-kernel.test.mjs` | **含真库** |
| 预算实际 | `ai-budget-vs-actual-review.test.mjs`、`ai-budget-variance-contract.test.mjs` | |

**缺口：自定义报表、保存视图、预测三者均无真 PostgreSQL 集成测试。** 其正确性只对 SQL 源文本与 DTO 断言，未对运行中的数据库断言。循环调度是唯一例外。

## 9. Owner 决策

- **D-N19-1 预算摄入**。是否新建预算导入命令（maker/checker + 快照哈希 + 幂等）？现状是预算只能带外插入，这在审计上等于"预算数据无来源链"。若暂不做，需在 UI 明示"预算需由 DBA 装载"。
- **D-N19-2 保存视图服务端执行**。是否让报表读接受 `savedViewId` 并在服务端展开？若不做，建议把 `filters` 的 jsonb 校验扩展到全部报表类型，避免存入无意义的过滤器。
- **D-N19-3** 是否为预测与循环调度补列表端点。
- **D-N19-4** 是否为自定义报表/保存视图/预测补真库测试（当前仅文本断言）。
- **D-N19-5** 报表调度/订阅是否进入路线图。
