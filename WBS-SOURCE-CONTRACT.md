# WBS → REFS Source Contract

版本：2026-08-01 Discovery 1  
性质：只读摸排；尚未获得生产 API/service account，不代表已完成真实同步。

## 1. 已验证 WBS 模块证据

证据来自 WBS Accounting 前端当前路由与 lazy chunks（2026-08-01），未执行任何 WBS 写操作。

| WBS route | 当前可验证用途 | 前端 bundle/API 证据 | REFS 归属 |
|---|---|---|---|
| `/companyAccount` | 公司会计工作台；查询、Setting、Review/Approve、Close/Unclose、附件与分录详情 | chunk 843；`/accounting/api/accounting/list|getOne|sources|businessSourceType|journalEdit/*|review|approve|reject|reversal|fileList` | Source & Staging / Journal workflow |
| `/sourceDetail` | 源记录/会计详情 Drawer，包含 bank/cost/payable detail、附件回源 | chunk 340；`journalEdit/bank|cost|payable|log`；附件 `ftFilesysid`。HTTP method 尚未证明，正式 adapter 仅可调用明确的只读 endpoint | Source document / mapping evidence / audit |
| `/cashOrBankBookAccountSetting` | Account、Cost、Payable、Receivable、Batch Setting | chunk 417 + common 586；`setting/accountSetting|costSettings|payableSettings|receiveableSettings|copyAccountingSetting` | Versioned Setting families |
| `/accountRelation` | Cost Code ↔ Account relation 的查询、增删改、导入导出 | chunk 379 + 586；`costcodeAccountRelation/list|add|update|delete|import|download`。元数据仅确认 `id,cost_code,account,account_name,type`；没有 company/effective/version/approval | Mapping family: COST_CODE_ACCOUNT；歧义时 fail closed |
| `/matchInfo` | 当前路由标题为 Match Info；bundle 主要出现 balance/report approval API，尚不能证明是银行匹配 | chunk 460；元数据表 `match_business_info` 只有 business type/id、batch GUID、create time、source，缺 entity/bank/amount/currency/status/undo version | Discovery quarantine，不生成 Match 或 JE |
| `/accountLink` | Account Report Link/报表关联，不是原始银行 feed | chunk 38；`report/companyList|reportType|getActCodes|showPDF|download` | Report lineage/read model |
| `/generalLedger` | 总账与 source drilldown | chunk 694；`balanceCell/showGeneralLedger` + accounting detail APIs | WBS→REFS 对账验证，不作为写账源 |
| `/balance`, `/balanceV2`, `/IncomeStatement` | 余额、BS/IS 类财务报表 | route metadata + balance/report APIs | Cutover/reconciliation control totals |
| `/Consolidate`, `/interComReport(s)`, `/companyEquityTracing` | 合并、公司间、权益追踪 | common 586；`consolidableReport|saveConsolidate|interComReport|companyEquityTracing` | IC/Consolidation validation |
| `/companyReviewSwitch` | 公司级 Review 开关/审批配置 | route metadata + `setting/approvalSwitch` | Approval policy input |
| `/propertyComparisonReport` | 多公司六位科目比较，支持 detail/total 与 ETL 下载 | 当前页面实际验证；例如 111000、164xxx、270xxx、795000 | Migration control totals |

WBS 前端还暴露权限标识 `WBS_AutoBankReconciliation`、`TBD_AutoBankReconciliation`、Company Account Review/Approve/Unclosing。REFS 不复制浏览器权限判断，必须把它们映射到服务端 RBAC policy。

### 1.1 只读元数据确认的 source detail 字段

`accounting.accounting_info` 已确认包含 `id, cb_id, business_guid, sys_id, source, data_source, come_from, com_code, set_date, posting_date, amount, debtor, lender, account, account_code, cost_code, project, pj_code, unit, unit_guid, unit_per_guid, payee, payee_no, bill_no, journal_no, review, approve_status, originator, reviewer, approver, approve_time, reject_reason, account_id, check_date, clear_date, file_relation_id, old_file_relation_id` 等字段。

这些字段证明 WBS 有公司、项目、Unit、Cost Code、Payee、审批和附件定位信息，但不能证明单字段唯一或可作 CDC。`cb_id/sys_id/bill_no/journal_no` 均没有逻辑唯一约束；币种也未在该表中确认。REFS source key 必须等待 WBS 数据字典确认 immutable business/line ID 与 revision，不能用 bill number、description 或 JE number 拼接替代。

`accounting.accounting_log` 已确认包含 `company_code, cb_id, come_from, sys_id, source, relation_content, bill_no, content, create_user, create_time, type`，可作为回源审计事实，但仍需稳定 parent ID 与 event ID 才能安全增量同步。

## 2. 需要 Ricky/WBS 团队确认的源模块

以下名称来自现有 REFS/WBS 协作资料，不把它们当作已验证数据库权限：

| Candidate source | 预期业务事实 | 必须确认 |
|---|---|---|
| `autopaymentbank` | 公司/批次/银行付款监控 | 主键、更新时间、删除标志、公司与银行账户键 |
| `fast_auto_payment_detail` | FAST 硬成本、payable/bank detail | cost code、project/unit、vendor/payee、业务状态、金额币种 |
| `accountbook` | Payable/expense/check/bank book 事实 | source type、document no、posting/void 状态、附件键 |
| `accountbookpaymentset` | 银行/付款科目 Setting | effective date、version、approval、公司范围 |
| `match_business_info` | 匹配证据 | bank line id、business source id、match type、actor/time、undo/reconcile 状态 |

生产同步前必须由 WBS 提供只读 API、数据字典、速率限制、增量游标语义和重放窗口；不得从浏览器页面硬爬 170 万行。

## 2.1 Discovery risk register

| Severity | Verified risk | Required REFS behavior |
|---|---|---|
| P0 | `match_business_info` 的 business/batch 组合只有普通索引，没有逻辑 UNIQUE；且缺 entity/bank/amount/currency/status/undo version | 原样保存重复 raw rows；inbox 复合唯一；duplicate quarantine；未补齐字段前禁止生成 bank match |
| P0 | `costcode_account_relation.cost_code` 非唯一，且没有 company/effective/version/approval | 同优先级多结果返回 `MAPPING_AMBIGUOUS`；不得任取第一条；REFS mapping 必须自行版本化审批 |
| P0 | `accounting_info` 只有 `id` 主键，业务候选键非唯一且可空 | 由 WBS 明确 immutable source/line ID + revision；REFS 用复合唯一与 payload hash，冲突 fail closed |
| P0 | `/accountLink`/PDF/download/GL 是汇总或展示结果 | 只进入 reconciliation control/read model；任何 report-as-source 请求直接拒绝 |
| P0 | accountRelation 无更新时间，sourceDetail 不是 list，match 只有 create time | 正式接入必须提供 cursor、stable ordering、tombstone 和 replay window；否则只允许受控 snapshot/hash diff |
| P0 | `ftFilesysid/file_relation_id` 缺 name/type/size/hash/object version 证据 | 未经服务端对象存在和 SHA-256 验证的附件不得满足凭证门 |

## 3. Canonical ingestion model

### 3.1 Raw envelope

```json
{
  "source_system": "WBS",
  "source_module": "companyAccount",
  "source_entity_id": "WBLD",
  "source_record_id": "opaque-wbs-id",
  "source_version": "updated_at-or-sequence",
  "event_type": "UPSERT",
  "occurred_at": "2026-07-31T00:00:00Z",
  "received_at": "server-assigned UTC",
  "payload_hash": "sha256:...",
  "payload_ref": "object://raw/wbs/...",
  "correlation_id": "..."
}
```

唯一约束：`UNIQUE(source_system, source_module, source_entity_id, source_record_id, source_version)`。  
当前态约束：`UNIQUE(source_system, source_module, source_entity_id, source_record_id) WHERE is_current`。

优先增量游标：`(updated_at, primary_key)`；若 WBS 只有序列号则使用 `(sequence, primary_key)`；若两者都没有，进入受控 snapshot diff，并以 canonical payload hash 去重。任何删除/撤销必须使用 tombstone/event，不物理删除历史版本。

### 3.2 Normalized source document

必填 header：`source_document_id, source_system, source_module, source_record_id, entity_id, document_type, document_no, business_date, accounting_date, currency, gross_amount, status, source_url/ref, attachment_ids, raw_event_id`。

必填 line：`source_line_id, line_no, amount, direction, description, payee/vendor/customer, bank_account, project, property, phase, unit, loan, cost_code, external_dimension_refs`。

质量失败进入 `QUARANTINED`：公司未知、币种/金额无效、日期缺失、source key 不稳定、维度指向不存在、附件引用非法。Quarantine 不得生成 Draft。

## 4. Setting / Mapping / Rule resolution

每次判断保存不可变快照，而不是只保存当前配置 ID：

- `setting_snapshot`: family、company、effective_from/to、version、approved_by/at、canonical hash。
- `mapping_snapshot`: family、input keys、output account/member rules、version、status、test evidence、approved_by/at。
- `rule_evaluation`: rule code/version、ordered predicates、matched facts、Dr/Cr result、confidence、reason。
- `ai_decision`: model/prompt version、input digest、candidate list、risk、human-required、final human choice/override diff。

优先级：明确 company override → company rule profile → approved shared template → no match exception。多个同优先级有效结果必须 `RULE_AMBIGUOUS`，不得任意挑选。

## 5. End-to-end state machine

`RECEIVED → VALIDATING → PENDING_MAPPING → PENDING_CODING → PENDING_REVIEW → READY_FOR_DRAFT → DRAFT_CREATED → PENDING_JE_REVIEW → PENDING_JE_APPROVAL → APPROVED → POSTED → RECONCILED`

失败/旁路状态：`DUPLICATE, QUARANTINED, MAPPING_EXCEPTION, RULE_EXCEPTION, EXCLUDED, REJECTED, REVERSED`。

一个 command 的 transaction boundary 必须同时完成：状态 compare-and-set、idempotency reservation、业务对象/Draft JE、source link、audit event、outbox event。任一失败整体回滚。

## 6. WBS Auto Bank Reconciliation 双步模型

1. PAYABLE 事实：逐业务行 `Dr Expense/CWIP/Inventory`；`Cr 291001`，vendor/payee member 必填。
2. Bank feed：匹配原 payable 后 `Dr 291001 / Cr 111000`，111000 必须带真实 bank account member。
3. `bank_match` 保存 bank line、payable source、JE/line、候选规则、金额/币种/日期差、actor/time。
4. 匹配到已存在 Posted payment 时只建立 linkage，不重复生成费用或清账 JE。
5. 已是 Draft 的自动生成可以 Undo；非 Draft 进入审批撤回/Reverse/Reclass；已 Reconciled 先走 Reopen/Unreconcile 权限流程。

## 7. API contract required from WBS

最低只读 API：

- companies/entities and stable IDs
- bank accounts and account members
- business source types and source records/lines
- account/cost/payable/receivable/batch settings with version/effective dates
- cost code/account relations
- journal/accounting detail and workflow history
- match evidence
- attachments metadata and authorized download reference
- GL/control-total reports for migration reconciliation

每个 list endpoint 必须支持稳定排序、cursor、`updated_since`、page size、删除/撤销标志；每个 detail 必须返回 immutable source ID 和 version。REFS adapter 保存 WBS request id、HTTP status、cursor before/after、row count、hash、duration、retry count 和 error code，但绝不记录 token。

## 8. Trace contract

任意 Posted GL line 必须能一跳到 JE，再到业务对象/Staging，再到 WBS normalized source/raw event、附件、Setting/Mapping/Rule/AI snapshot 和全部 audit events。反向从 WBS source 也必须列出所有 Draft/Posted/Reversal/Reclass/Match/Reconciliation links。

禁止用 description、JE number 或可编辑 document number 作为唯一链接。所有链接使用不可变 ID，并在 API/数据库有外键或唯一约束。

## 9. 第一批验收数据

先用 12 个可人工复核的小样本打通，而不是全量灌入：普通银行收款、Loan Draw、在建利息、完工利息、Loan Repayment、Escrow、AP Cost Code、多行 Bill、Security Deposit、PM Rent Pickup、Intercompany、Missing Mapping。每条必须提供 WBS raw→REFS Posted/Exception 的完整 trace JSON 和 GL/control-total 对账。
