# REFS Architecture V2 — QuickBooks 体验 × WBS 地产业财一体化

版本：2026-08-01 Draft 1
面向：Ricky、Claude、Codex
目标：重建产品与技术架构，不在现有原型上继续堆叠孤立页面。

## 1. 产品定义

REFS 是 WanBridge/WBS 的地产会计引擎。它由两个清晰分层、同一账本收口的产品面组成：

1. **QuickBooks-compatible Accounting Workspace**：沿用用户熟悉的会计对象、录入模式、列表/表单/Drawer、Banking、Reconcile、Register、AP、AR、JE、Close、Reports 与 Audit 操作习惯。
2. **WBS Real Estate Accounting Control Plane**：接收 WBS、FAST、Faster PO、PM、Closing、Loan、Bank 等源数据，以公司 Setting、Mapping、Rule、AI Judge、人工审批驱动记账。

所有源数据必须通过同一条链路：

`Source → Source Document → Staging → Mapping → Rule → AI Suggestion → Human Review → Draft Transaction/JE → Approval → Post → GL → Report/Reconcile/Audit`

禁止任何业务模块、AI 或同步任务直接写 GL。

## 2. 不照搬 QuickBooks 的控制差异

QuickBooks 的交互模型是参照，REFS 的会计控制模型是最终约束。

- QuickBooks Banking 支持 Match、Categorize、Exclude、Split、Undo；REFS 对齐这些操作。
- QuickBooks 银行规则可自动分类，部分场景可自动确认；REFS 只能生成建议或 Draft，不允许 AI/规则自动 Post。
- REFS 强制 Draft → Review → Approval → Posted，且 Maker ≠ Approver。
- Posted ledger lines 不可编辑；JE 更正只能通过 Reverse 或 Reclass，并保留完整链路。业务单据可以有 `VOIDED` 状态，但若已过账，Void command 必须追加 reversal/linkage/audit，不能删除或修改原 Posted ledger lines。
- 关闭期间禁止新过账；重开必须独立权限、原因与审计记录。
- 手工 JE 必须有附件；自动 JE 必须有 `source_document_id`、`source_record_id`、`rule_code`、`setting_version`。
- 辅助核算科目必须带合法 `member`；六位科目不可降级为四位。

## 3. 用户体验架构

### 3.1 全局 Shell

- 左侧可折叠导航，支持收藏、最近使用与角色隐藏。
- 顶栏固定：公司/实体、期间、搜索、Create New、待办、帮助、用户。
- 全局 `+ New`：Invoice、Bill、Expense、Check、Deposit、Transfer、Journal Entry、Receive Payment、Pay Bills、Credit Memo。
- Command Palette：按对象编号、金额、Payee、Unit、Source ID、JE 编号全局检索。
- 列表统一具备筛选、排序、列显隐、密度、保存视图、批量动作、导出、分页和键盘操作。
- 对象采用 List → Drawer quick view → Full edit 三层交互，减少页面跳转。
- 所有金额录入表单实时显示 Debit、Credit、Difference、影响账户和来源追踪。

### 3.2 十组信息架构

1. **Control Center**：Dashboard、My Work、Approvals、Exceptions、AI Audit。
2. **Accounting Settings**：Company Settings、Chart of Accounts、Dimensions、Mappings、Rules、Recurring Templates。
3. **Sales & Receivables**：Customers、Invoices、Sales Receipts、Receive Payments、Deposits、Credit Memos、AR Aging。
4. **Expenses & Payables**：Vendors、Bills、Expenses、Purchase Orders、Pay Bills、Checks、Vendor Credits、AP Aging。
5. **Banking & Reconciliation**：Bank Feeds、For Review、Posted/Matched、Excluded、Rules、Registers、Statements、Reconcile、History。
6. **Journal & General Ledger**：Journal Entries、Recurring JEs、Account Register、General Ledger、Trial Balance、Reclassify、Reverse。
7. **Real Estate Accounting**：Project Cost、CWIP、Unit Cost、Unit Transfer、Loan、Property Operations、Closing、Intercompany。
8. **Close**：Close Checklist、Accruals、Reversals、Reconciliations、Review Notes、Period Lock、Close Package。
9. **Reports**：Financial、Management、Project/Unit、AP/AR、Loan、Bank、IC、Audit、Custom Reports。
10. **Admin**：Entities、Users、Roles、Approval Policies、Integrations、Import/Export、Audit Log、System Health。

## 4. 统一会计对象模型

业务对象不能全部伪装成 JE。用户看到的是 Invoice、Bill、Payment、Deposit、Transfer、Expense、Check 等原生对象；Posting Engine 再把它们统一投影为不可变 Ledger Entry。

核心对象：

- `organization`, `entity`, `fiscal_period`, `user`, `role`, `permission`, `approval_policy`
- `account`, `account_hierarchy`, `dimension_type`, `dimension_member`
- `customer`, `vendor`, `project`, `property`, `phase`, `unit`, `loan`, `bank_account`
- `source_document`, `source_record`, `staging_item`, `mapping`, `accounting_rule`, `setting_version`
- `invoice`, `invoice_line`, `receipt`, `deposit`
- `bill`, `bill_line`, `bill_payment`, `expense`, `check`, `vendor_credit`
- `bank_feed_transaction`, `bank_match`, `bank_statement`, `reconciliation`
- `journal_entry`, `journal_line`, `posting_batch`, `ledger_entry`
- `approval_instance`, `approval_step`, `exception`, `attachment`, `audit_event`
- `close_task`, `recurring_template`, `intercompany_pair`, `unit_cost_layer`, `unit_transfer`

每个可过账对象必须包含：实体、币种、业务日期、会计期间、状态、来源、创建人、版本、附件、审批链和幂等键。

每条会计行支持：`entity/project/property/phase/unit/wbs_node/cost_code/vendor/customer/loan/bank_account/source_document/ic_pair/member`。

## 5. 状态机

### 5.1 源数据与 Staging

`RECEIVED → VALIDATING → PENDING_MAPPING → PENDING_CODING → PENDING_REVIEW → READY_FOR_DRAFT → DRAFT_CREATED`

失败分支：`DUPLICATE | VALIDATION_FAILED | MAPPING_EXCEPTION | RULE_EXCEPTION | QUARANTINED`。

### 5.2 会计交易

`DRAFT → PENDING_REVIEW → PENDING_APPROVAL → APPROVED → POSTED`

驳回回到 `DRAFT`；Posted 只能追加 reversal 或产生 Reclass 子交易。原 ledger lines 永久不变；允许追加 reversal/reclass linkage、actor/time 和只读状态投影。

### 5.3 Banking

`PENDING → SUGGESTED_MATCH | SUGGESTED_CATEGORY | NEEDS_INFO → REVIEWED → MATCHED | POSTED | EXCLUDED`

Undo 将关联对象安全退回 Review；已完成银行对账的交易必须先走 Reopen/Unreconcile 权限流程。

### 5.4 Reconciliation

`DRAFT → IN_PROGRESS → READY_TO_SIGN_OFF → SIGNED_OFF → LOCKED`

只有 Difference = 0 且未处理项目为 0 才能 Sign-off。

## 6. WBS Auto Bank Reconciliation 兼容层

现有 WBS 数据不能直接复制到 GL，必须通过适配器转换：

- `autopaymentbank` → Company/Batch monitoring projection。
- `fast_auto_payment_detail` → source record + payable/bank staging detail。
- `accountbook` / payable data → Bill/Expense/Check source facts。
- `accountbookpaymentset` → bank/payment account setting snapshot。
- `match_business_info` → match evidence and lineage。

关键双步模型保持不变：

1. PAYABLE 入账：费用/CWIP 借方，`Cr 291001`，按 Payee/公司挂辅助核算。
2. Bank Feed 清账：`Dr 291001 / Cr 111000`，关联原 payable、银行交易和匹配证据。

同步策略：按源表主键和更新时间做增量游标；原始 payload 只读保存；规范化记录可重跑。Raw event 使用 `UNIQUE(source_system, source_module, source_entity_id, source_record_id, source_version)`；当前态使用同一前四元组的 partial unique；业务 posting/idempotency key 另按事件 occurrence 定义，三者不得混用。

## 7. 地产会计规则包

- Loan Draw：`Dr 111000 Cash / Cr 270100 Loan Payable`，不得计成本。
- Loan Interest：在建 `Dr 164500`；完工/在用 `Dr 795000`；贷记应付利息或现金。
- Construction Invoice：`Dr CWIP / Cr AP`，必须带 Project、Unit/WBS、Cost Code、Vendor。
- Security Deposit：进入 `225000` 负债，不得记收入。
- Unit Lifecycle：Land/CWIP → Finished Inventory → COGS，累计结转不得超过 Unit 累计成本。
- Closing：以 Confirmed Amount、Title Withholding、Closing Statement 为来源，拆分 Cash/AR、Revenue、COGS、Withholding。
- Unit Transfer：A 转出/B 转入双 JE、成本桥、IC pair、证据清单与 cutoff。
- Intercompany：自动镜像 Due from/to，双方实体、成员、金额、期间和 pair 必须一致。

## 8. 服务架构

先采用模块化单体，避免过早微服务化：

- `web`：React/TypeScript 前端。
- `api`：REST API、JWT/session、RBAC、request validation。
- `accounting-core`：状态机、校验、Posting Engine、Reversal/Reclass。
- `rules`：Setting/Mapping/Rule resolution，纯函数、版本化。
- `integration`：WBS/FAST/PM/Bank adapters、outbox/inbox、幂等。
- `reporting`：GL projection、TB、BS、IS、现金流和维度报表。
- `worker`：导入、匹配、批量 posting proposal、报表快照。
- PostgreSQL：事务账本和控制数据；对象存储：附件与原始源文件；Redis 可后置。

任何 Posting 必须在单个数据库事务中完成：锁期间 → 校验权限/SoD → 校验维度 → 校验平衡 → 写 posting batch/ledger → 写 audit/outbox → commit。

## 9. API 边界（V1）

- `/api/v1/auth/*`, `/users`, `/roles`, `/permissions`
- `/entities`, `/periods`, `/accounts`, `/dimensions`, `/members`
- `/customers`, `/vendors`, `/projects`, `/properties`, `/units`, `/loans`, `/bank-accounts`
- `/source-documents`, `/staging-items`, `/mappings`, `/rules`, `/settings`, `/exceptions`
- `/invoices`, `/receipts`, `/deposits`, `/bills`, `/bill-payments`, `/expenses`, `/checks`, `/transfers`
- `/bank-transactions`, `/bank-matches`, `/bank-statements`, `/reconciliations`
- `/journal-entries`, `/posting-batches`, `/ledger-entries`
- `/close-tasks`, `/recurring-templates`, `/intercompany-pairs`, `/unit-transfers`
- `/reports/trial-balance`, `/reports/balance-sheet`, `/reports/income-statement`, `/reports/cash-flow`, `/reports/general-ledger`
- `/audit-events`, `/attachments`, `/imports`, `/exports`

通用写操作使用 `Idempotency-Key`；资源使用 `version`/ETag 做乐观锁；所有列表采用 cursor pagination；所有写请求产生 append-only audit event。

`repo.js` 迁移时先保持 `load/save/audit` facade，但内部不得把远端 API 伪装成同步调用。应新增异步 `get/list/create/update/command`，旧 facade 仅作为过渡缓存层，逐模块切换。

## 10. 报表与账本原则

- GL 是 Posted ledger projection，不从 UI 状态或业务表临时拼接。
- TB 必须在任意实体、期间、维度过滤下借贷相等。
- BS 必须满足 Assets = Liabilities + Equity。
- IS、Cash Flow、Project P&L、Unit Cost 与 GL 使用同一 posting line 来源。
- 报表支持 cash/accrual（适用对象）、比较期间、预算对比、实体合并、drill-down 到交易和源单据。
- Consolidation 使用 elimination entity/batch，不覆盖原实体账。

## 11. AI 边界

AI 输出固定结构：建议 Dr/Cr、维度、置信度、理由、证据、命中 Setting/Rule、风险、是否需人工。

AI 可以：分类、匹配候选、异常解释、审计发现、补充信息请求。
AI 不可以：自动 Post、绕过 Mapping、修改 Posted、解除期间锁、代替审批人。

每个 AI 判断保存 model/prompt version、输入摘要、候选、最终人工选择和差异，用于可解释性与后续评估。

## 12. 迁移计划

### Phase 0 — 安全网与契约

- 建立 TypeScript workspace；把领域纯函数从 UI 抽出。
- 补 golden tests：Draw、利息、押金、COGS cap、291001 双步、SoD、期间锁、辅助核算、Posted immutable。
- 冻结 OpenAPI、数据库词典、状态机和错误码。

### Phase 1 — 会计内核

- PostgreSQL schema、Auth/RBAC、Period、COA、Dimensions、JE、Posting、GL、Audit。
- 完成 Journal、Register、TB/BS/IS 的 API 化。

### Phase 2 — QuickBooks 核心操作

- AP、AR、Banking、Match/Categorize/Split/Exclude/Undo、Reconcile、Recurring、Close。
- 统一表单、列表、Drawer、保存视图和键盘交互。

### Phase 3 — WBS 接入

- Source/Staging、四大 Setting、Mapping、Rules、Exceptions。
- WBS 增量同步与 291001 双步过账；全链路 trace。

### Phase 4 — 地产深化

- Loan、CWIP、Unit Cost、Closing、Unit Transfer、Intercompany、Consolidation。

### Phase 5 — AI 与审计

- AI Judge、AI Match、AI Audit、Close Assistant；全部保持 human-in-the-loop。

## 13. 验收标准

1. 所有业务对象可 drill-down 到 JE、GL line、source document 和 audit event。
2. 任意失败重试不会产生重复交易或重复 JE。
3. 100% Posted JE 平衡、科目合法、期间开放、维度合法、来源完整。
4. Maker/Reviewer/Approver/Post 权限和人员分离可配置且被后端强制。
5. 关闭期间、Posted immutable、Reverse/Reclass 由数据库/API 同时守护。
6. Bank Match 不重复创建费用或收入；Undo 可逆且审计完整。
7. Reconcile 差异不为零不能签字；签字后受锁保护。
8. WBS 双步链路能从 payable 追到 bank clear，291001 按 member 清零。
9. Unit/Project/Entity 报表与 GL 完全一致，COGS 不超过累计 Unit 成本。
10. 关键列表在 10 万行规模下服务端分页响应稳定；常用动作不超过三次交互。
11. Web 无鼠标可完成高频录入；金额、账户、日期、Payee 支持快速键盘选择。
12. AI 建议可解释、可拒绝、可回溯，且不存在 AI 自动 Post 路径。

## 14. Claude × Codex 分工

**Codex**：QuickBooks 风格前端、页面对象模型、交互一致性、响应式、WBS/REFS 端到端补缺与浏览器 E2E。

**Claude**：PostgreSQL、API/Auth/RBAC/Audit、WBS ingestion/worker、Posting service 与后端集成测试。

**交叉复核**：Codex 审查 API 是否能真正支撑前端闭环；Claude 审查前端是否遵循事务、幂等、状态机与审计契约。每批先声明文件 owner，另一方只读 reviewer。
**共同冻结**：对象命名、状态机、OpenAPI、会计错误码、验收 fixture。

任何前后端接口冲突先追加 ADR，再实现；不得靠组件内特殊判断绕过领域规则。

