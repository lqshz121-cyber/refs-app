# N32 — 报表钻取与权限审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

**报表→台账→分录→来源单据的正向钻取全链已实现**，每一跳都用不可变 UUID 而非单据号。权限由单一收口点 `refs_assert_scope` 把守，跨实体读以 42501→403 拒绝。

三个实质缺口：**实体以下无行级授权**、**五个报表读完全不分页**（见 N38）、**最老的两条报表路由无响应侧作用域复核**。

## 2. 报表读清单（取证）

**注意：不存在独立的 Trial Balance 路由或内核方法。** TB 是 `refs_get_financial_statements` 内的一个 `statement_type` 值；`kernel-repository.mjs` 中 `trial.?balance` 命中 0。审计文档措辞须为"TB 是财务报表读的一个 statement_type"。

| 报表 | SQL 函数 | 权限 | 内核 | HTTP |
|---|---|---|---|---|
| TB/BS/IS/CF（同一读） | `refs_get_financial_statements` `062:15`，断言 `062:44` | `GL.REPORT.VIEW` | `:3091` | `GET .../reports/financial-statements` `:1535` |
| 总账分页 | `refs_list_general_ledger` `189:6`，断言 `189:19` | `GL.JE.VIEW` | `:2578` | `GET .../general-ledger/entries` `:1436` |
| 总账快照页 | `refs_read_general_ledger_snapshot` `300:92`，断言 `300:99` | `GL.JE.VIEW` | `:2584` | `GET .../general-ledger/snapshot-entries` `:1446` |
| 科目明细账 | `refs_list_account_register` `083:65` | `GL.REPORT.VIEW`+`GL.JE.VIEW` | — | `GET .../general-ledger/account-register` `:1426` |
| 分录明细 | `refs_get_journal_entry_detail` `095:3`，断言 `095:14` | `GL.JE.VIEW` | `:2509` | `GET .../journal-entries/{id}` `:1101` |
| 现金流分类 | `refs_get_cash_flow_classification` `075:12`，断言 `075:38` | `GL.REPORT.VIEW` | `:3217` | `:1799` |
| 预算实际 | `refs_get_budget_vs_actual` `081:59` | `GL.REPORT.VIEW` | `:3372` | `:1849` |
| 维度损益 | `074:41` | `GL.REPORT.VIEW` | — | `:1787` |
| 自定义报表 | `refs_read_custom_report` `391:37` | `REPORT.CUSTOM.VIEW` | `:952` | `:1545` |
| 来源单据明细（钻取终点） | `refs_get_source_document_detail` `084:48`，`165:9` 重定义 | `GL.JE.VIEW` | `:2689` | `:1140` |

`GL.REPORT.VIEW` 定义于 `062:4`：`('GL.REPORT.VIEW','GL','LOW','GL_REPORT_READER')`。

## 3. 过滤维度 — 很窄

- **financial-statements**：`requireExactQuery(['periodId'])`（`:1539`）。实体来自路径。**无科目、项目、成员、维度过滤 — NOT IMPLEMENTED**
- **general-ledger/entries**：`['periodId','accountCode','query','limit','offset']`（`:1440`）。`query` 是自由文本（≤160 字符、无控制字符，`:251`）；`accountCode` 须匹配 `^[A-Za-z0-9._-]{1,64}$`（`:248`）。**无成员/项目/单元过滤参数**
- **snapshot-entries**：同上 + `snapshotToken`（须 `sha256:<64hex>`，`:252`）
- **account-register**：`['periodId','accountCode']`，两者必填
- **reports/custom**：`reportType,periodId,dimensionType,dimensionRef,limit,afterAccountCode`。**这是唯一带项目/物业/单元维度过滤的报表读**，且只接受单一维度、只对 `DIMENSION_PNL` 生效
- **budget-vs-actual / cash-flow-classification**：仅 period

## 4. 分页与页界

- **不分页**：financial-statements、cash-flow-classification、budget-vs-actual、journal-entry 明细、account-register。返回该期间全量行。详见 N38
- **总账 offset 分页**：HTTP `optionalReadLimit`（`:259`）默认 100、正则 `^[1-9]\d{0,2}$` 后显式 `limit>200` 抛错 → **400 `INVALID_QUERY_PARAMETER`**；SQL 纵深防御 `189:26` `p_limit>200 OR p_offset<0` → **22023** → **HTTP 422**（`:350`）
  - **审计要点：同一越界条件产生两个不同 HTTP 码**（HTTP 守卫 400，落到 SQL 则 422）
  - 响应带 `count(*) OVER()::bigint AS total_count`（`189:47`），无需额外计数往返
- **快照分页**：`300:100` 同界；HTTP 额外要求 `offset>0` 必带 `snapshotToken`，否则 **400 `GENERAL_LEDGER_SNAPSHOT_REQUIRED`**（`:1452`）——第 2 页起必须出示第 1 页的总体哈希，总体变动即拒绝而非静默重分页
- **自定义报表**：keyset `afterAccountCode`，DTO 1–200（`runtime/custom-report-contract.mjs:12`）→ 400；SQL 1–200 → 22023 → 422
- **保存视图**：keyset `(updated_at, id)`，HTTP 1–100 → 400；SQL 1–100 → 422

## 5. 钻取全链（已实现，四跳）

每一跳都是不可变 UUID —— `001:576` 注释明示 trace link 只用不可变 ID。

1. **报表行自带证据**：`refs_get_financial_statements` `RETURNS TABLE` (`062:20-40`) 每行含 `journal_entry_ids[]`、`journal_line_ids[]`、`ledger_line_ids[]`、`source_document_ids[]`。`refs_read_custom_report`(391) 同四数组 + `row_hash`
2. **总账页引用同一身份**：`refs_list_general_ledger` 返回 `journal_entry_id, journal_number, journal_line_id, ledger_line_id, member_ref, source_document_ids[]`（`189:10-14`）
3. **分录明细**：`refs_get_journal_entry_detail` 返回表头 + `line_no, journal_line_id, ledger_line_id, account_code, debit/credit, member_ref, dimensions, source_document_ids[]`（`095:6-11`）。期间不存在或分录不存在均抛 **P0002**（`095:18`、`095:24`）→ **404 `JOURNAL_ENTRY_NOT_FOUND`**（`:1109`）
4. **原始业务对象**：`GET .../source-documents/{id}`（`:1140`）→ `refs_get_source_document_detail`（`084:48`，`165:9` 加 `provider_trace`）。`source_link`（`001:554`）是联结表，可指向 `raw_event / source_document / source_document_line / staging_item / journal_entry / journal_line / posting_batch / ledger_line / bank_source / bank_match / reconciliation / attachment`，并以 `CHECK(num_nonnulls(...))` 强制恰好一种

前端同链：`src/authoritative-lineage-drill.jsx:2`。其 `readExactAuthoritativeLedgerLine` 会拒绝非 POSTED 分录的钻取，以及分录未留存所选 `(journal_line_id, ledger_line_id)` 对的情形。上限 `LEDGER_PAGE_SIZE=200, LEDGER_RESULT_CAP=10000`。

**链条终点（诚实边界）**：`tests/report-ledger-reverse-trace-postgres.test.mjs:12-14` 自陈——报表→台账→分录→来源单据这段是**报表优先反向验证**的；来源单据→外部 WBS provider event 那一跳**只有来源优先的正向覆盖**，没有报表优先覆盖。

## 6. 权限与行级作用域

单一收口点 `refs_assert_scope(target_tenant, target_entity, required_permission)` — `002:566`：

```
IF refs_current_tenant() IS DISTINCT FROM target_tenant OR refs_entity_allowed(target_entity) IS NOT TRUE THEN
  RAISE EXCEPTION 'Tenant/entity scope denied' USING ERRCODE='42501';
IF refs_entity_has_permission(target_entity, required_permission) IS NOT TRUE THEN
  RAISE EXCEPTION 'Permission % denied' USING ERRCODE='42501';
```

映射 **42501 → HTTP 403**（`accounting-http.mjs:334`），且响应体消息被强制为通用 `'Forbidden'`（`problemFor`，`:352`），**不泄漏作用域信息**。

`refs_entity_allowed` 现行定义在 `274_runtime_grant_sod_expiry.sql:261`：一条查询同时要求——存活的 `runtime_auth_context` 行（匹配 `refs.context_hash`、`bound_login=session_user`、`bound_backend_pid=pg_backend_pid()`、`bound_txid=txid_current()`、未撤销、未过期）**且**匹配的未撤销未过期 `runtime_actor_grant`**且**处于 `effective_from/to` 窗口内的 active `permission_catalog` 行。**令牌里带着但已被撤销/过期的授权不通过。**

**实体以下无行级授权 — 实质缺口。** 全部授权表（`runtime_actor_grant` 等）以 `(tenant_id, actor_id, entity_id, permission)` 为键。**无项目级、物业级、成员级、科目段级授权。** 任何持有该实体 `GL.REPORT.VIEW` 的人能看到该实体的全部科目、全部项目、全部成员。报表相关表的 RLS 一律是 `tenant_id=refs_current_tenant() AND refs_entity_allowed(entity_id)`——实体粒度，无更细。

唯一的子实体过滤是**保存视图的属主隔离**：`visibility='ENTITY_SHARED' OR owner_actor_id=actor`，且他人私有视图返回 **P0002 而非 42501**。

**42501 语义过载（审计需标注）**：它同时用于作用域拒绝、SoD 拒绝与内部门禁绕过，例如 `373:125`（跨公司抵销必须走权威命令）、`384:40`（合并配置变更必须走权威命令）、`157:61`（物业租金准入与复核须异人）、`002:411/455/478/492`（身份拒绝）。

**跨实体期间偷渡另有其码**：`tests/report-posted-only-projection-postgres.test.mjs:161` 断言——用自己的实体但传**他实体的 `periodId`**，拒绝码是 **22023**（→422），既不是 403 也不是静默空集。

## 7. 响应侧作用域复核 — 不对称

新路由有：`reports/custom` 复核 `tenant_id/entity_id/period_id/report_type/dimension_*/limit/cursor` 回声，不符抛 **502 `CUSTOM_REPORT_RESPONSE_INVALID`**（`:1552`）；`snapshot-entries` 抛 **502 `GENERAL_LEDGER_SNAPSHOT_RESPONSE_INVALID`**（`:1455`）。

**最老的两条没有**：`reports/financial-statements`（`:1535`）与 `general-ledger/entries`（`:1436`）直接返回内核行，无响应侧复核。

## 8. 错误码汇总

| 码 | 抛出处 | HTTP |
|---|---|---|
| `42501` | `refs_assert_scope`(`002:569,573`)；保存视图身份漂移守卫 | **403 "Forbidden"**（`:334`） |
| `P0002` | 分录不存在(`095:18,24`)；保存视图缺失或他人私有 | 404 |
| `22023` | 页界/科目码/查询串/跨实体期间/白名单外 | 422（`:350`） |
| `23514` | 循环调度到期日无开放期间(`390:77`) | 422 |
| `55000` | 保存视图 DELETE「retained evidence」 | 423（`:342`） |
| `40001` | 序列化冲突 | 412（有 revision 前置）否则 503 |
| `54000` | 有界总体超限 | 422（`:349`） |
| `400 INVALID_QUERY_PARAMETER` | `optionalReadLimit`(`:259`)/`optionalReadOffset`(`:253`)/`requireAccountCode`(`:248`) | 400 |
| `502 *_RESPONSE_INVALID` | 响应侧作用域复核（仅新路由） | 502 |
| `503 *_UNAVAILABLE` | 内核方法缺失 | 503 |

## 9. 测试覆盖

**真库（这三个才真正证明了链条）**：
- `tests/report-ledger-reverse-trace-postgres.test.mjs` — 报表优先反向追溯。`:69` 每个 TB 行从其引用的 `ledger_line` id 精确重算，且每条引用行属该期间的 POSTED 分录；`:89` BS/IS 是同一批台账行的重新分节，不出现 TB 未引用者；`:103` 报表行 → `ledger_line` → `journal_entry` → `source_link` → 已验证附件，且分页总账引用同一行
- `tests/evidence-to-report-stage-trace-postgres.test.mjs` — `:72` 阶段 0（`NO_EVIDENCE_IMPORTED`）；`:81` 阶段 1（DRAFT 分录为 `EVIDENCE_WITHOUT_POSTINGS`，对任何报表零贡献）；`:96` 阶段 2（每个报表行可回溯到确切的 WBS raw event）
- `tests/report-posted-only-projection-postgres.test.mjs` — `:129`/`:160` 无权限 actor 读报表/总账均 42501；`:161` 跨实体 periodId → 22023；`:121-125` 总账 offset 分页跨页稳定；`:127` 每报表行有非空 `ledger_line_ids`；`:155` 无过账实体返回 `[]` 而非伪造零行

其他：`financial-statements-read-contract`、`general-ledger-read-contract`、`journal-entry-detail-read`、`sqlstate-http-drift`（SQLSTATE→HTTP 漂移）、`access-failure-diagnostics`。前端：`authoritative-lineage-drill.test.jsx` 等 5 个。

## 10. Owner 决策

- **D-N32-1 行级授权**。是否需要实体以下（项目/物业/成员/科目段）的读授权？这是一个 schema 级扩展（`runtime_actor_grant` 加维度 + 所有报表读加过滤），影响面大，须先确认业务确有此需求。
- **D-N32-2** 是否为 `reports/financial-statements` 与 `general-ledger/entries` 补响应侧作用域复核，与新路由对齐。
- **D-N32-3** 越界的双码问题（400 vs 422）是否统一。建议统一为 400（HTTP 守卫优先），SQL 侧保留为纵深防御。
- **D-N32-4** `financial-statements` 是否需要科目/项目/成员过滤参数。
- **D-N32-5** 42501 语义过载是否拆分（作用域 vs SoD vs 门禁绕过）。注意：拆分会改变现有 HTTP 映射，属破坏性变更。
