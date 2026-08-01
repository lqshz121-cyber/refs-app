# REFS Product North Star

版本：2026-08-01
定位：QuickBooks 级会计操作体验 × Oracle/NetSuite 级会计控制 × WBS 地产业财数据链。

## 1. 完成口径

“具备功能”不等于存在菜单或演示按钮。每个可过账对象必须实际跑通：

`业务源/手工单据 → Source Document → Setting/Mapping → Rule/AI Suggestion → Staging → Human Review → Draft → Review → Approval → Posted → GL → Report/Reconcile → Source Trace → AI Audit`

发布验收必须同时证明：状态可持久化、重复请求幂等、失败原子回滚、权限与 SoD 在领域/API 边界执行、Posted 不可变、期间锁有效、附件可读取、借贷平衡、科目和辅助核算合法、任意 GL 行可回源。

## 2. QuickBooks 功能目标面

| 能力域 | 必备业务对象与操作 | REFS 控制增强 |
|---|---|---|
| Global Workspace | Company/Period、全局 Search、`+ New`、收藏/最近、通知、保存视图、批量动作、导入导出 | Entity/Period 作用域不可由页面筛选器代替领域校验 |
| Customers & Sales | Customer、Product/Service、Estimate、Invoice、Recurring Invoice、Sales Receipt、Credit Memo、Refund、Receive Payment、Deposit | 每个对象有独立子账、allocation、source link 和 Draft JE |
| Vendors & Expenses | Vendor、PO、Item Receipt、Bill、Expense、Check、Vendor Credit、Bill Payment、1099 支持 | PO/Receipt/Bill 三单匹配；地产 cost code/project/unit 维度 |
| Banking | Feed Import、Pending/For Review、Match、Categorize、Split、Transfer、Exclude/Restore、Undo/Unmatch、Rules、Attachments | 真实 candidate linkage；任何新记账只生成 Draft；对账完成后受锁保护 |
| Reconciliation | Statement、Ending Balance/Date、Cleared、Difference、History、Reopen/Unreconcile | Difference 必须为 0；Sign-off/Lock；角色权限与审计原因 |
| General Ledger | COA、Register、Manual/Auto/Recurring JE、Reclass、Reverse、Trial Balance、Close | 六位科目、SUBSIDIARY member、严格审批状态机、Posted immutable |
| Inventory & Assets | Item、Quantity/Value、Adjustment、COGS、Fixed Asset、Depreciation、Disposal | 地产 Unit cost layer、CWIP→Finished Inventory→COGS cap |
| Projects & Dimensions | Project/Class/Location/Tag、项目收入成本、预算实际 | Entity/Property/Phase/Unit/WBS/Cost Code/Loan/IC Pair 全维度 |
| Reports & Planning | BS、P&L、Cash Flow、GL、TB、AP/AR Aging、Budget、Forecast、Custom/Management Reports | 所有报表只读 Posted ledger projection；支持 source drilldown |
| Accountant Tools | Batch transactions、Reclassify、Write-off、Close books、Recurring、Audit log | Maker/Reviewer/Approver/Poster 分离；不可关闭 audit log |
| Tax & Compliance | Sales tax、1099、期间/年度导出、凭证证据 | 先提供会计数据与控制接口；报税申报和 Payroll 采用专业系统集成，不伪造本地能力 |
| Admin & Integration | Users/Roles、Custom fields、Webhooks/API、Import history、Health | JWT/session、RBAC、idempotency、outbox/inbox、append-only audit |

QuickBooks 的关键银行原则被保留：下载交易在 Match 或 Categorize 前不影响账簿；Match 用于连接既有记录以避免重复；Exclude 不进入账簿；Undo 返回待处理。参考 [Intuit Match](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-transactions/match-transactions-quickbooks-online/L0MF3Fn6y_US_en_US)、[Intuit Reconcile](https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_US_en_US) 与 [Intuit Audit Log](https://quickbooks.intuit.com/learn-support/en-uk/help-article/audit-log/use-audit-log-quickbooks-online/L2WoVnW6I_GB_en_GB)。

## 3. 企业级能力吸收

- Oracle Accounting Hub：采用“业务事件 → 可配置会计规则 → 详细可审计分录 → GL”的事件会计模型，而不是让源系统直接写 GL。参考 [Oracle Accounting Hub overview](https://docs.oracle.com/en/cloud/saas/financials/25d/faiac/overview-of-oracle-accounting-hub-cloud.html)。
- NetSuite：采用 System Rules + versioned User Rules、规则优先级、导入历史、并列候选必须人工选择、Match 与 Reconcile 分离。参考 [Bank Data Matching](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_4842302228.html) 与 [Intelligent Transaction Matching](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1551275.html)。
- 用友类产品：吸收多组织、多账簿、辅助核算、银企联与共享中心的操作理念；具体功能只在取得官方接口/产品证据后进入“已验证”范围。
- REFS 独有：WBS 项目/地块/Unit/Loan/Closing/PM/FAST/Faster PO 数据，以及 `291001` PAYABLE→Bank Feed 双步清账。

## 4. WBS 地产会计扩展

1. Construction Loan：Draw、资本化/费用化利息、还本、escrow、lender reconciliation。
2. Project Cost：PO/合同/发票/付款、cost code、预算/承诺/实际、CWIP rollforward。
3. Unit Accounting：Unit cost layer、状态流转、Finished Inventory、COGS cap、Unit Transfer。
4. Property Operations：PM charge/rent/deposit/fee pickup、Owner GL、property/unit member。
5. Closing：Confirmed Amount、Title Withholding、settlement evidence、Revenue/COGS/Cash/AR 拆分。
6. Intercompany/Consolidation：双边 Due From/Due To、pair、差异、elimination batch。
7. AI Audit：finding 必须闭环到 source、JE、recommended fix、reversal/reclass、resolved evidence。

## 5. 不可突破的红线

- Source、业务模块、Mapping、Rule 和 AI 都不得直接写 Posted GL。
- AI 只能建议、解释、匹配候选和生成 Draft；不得代替审批、解锁期间或修改 Posted。
- WBS 生产接入仅使用 Ricky 授权的只读 API/service account；不把浏览器 token 写入代码、日志或文档。
- 不把 170 万级原始行放入 localStorage；原始数据进入 PostgreSQL/object storage，前端只使用分页 API。
- 未完成真实数据库、备份恢复、安全、迁移、性能与生产 E2E 前，不宣称可承载 WBS 正式账簿。

## 6. 发布顺序

1. Accounting Kernel：Period/COA/Dimensions/JE/Posting/GL/Audit。
2. Banking + JE + Reconcile 核心闭环。
3. AP/AR/Expense/Credit/Allocation 原生对象闭环。
4. WBS Source/Settings/Mapping/Staging 增量同步。
5. Loan/CWIP/Inventory/Closing/IC/Consolidation。
6. AI Judge/Audit 评估体系、异常处置与 Close Assistant。

每批必须提供稳定 SHA、文件 owner、自动测试、12 场景 E2E 证据、live SHA/build time；不得用大而全的页面数量替代垂直闭环。
