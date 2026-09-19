# N09 — AP/AR 缺失对象持久化（PO / Check / Write-off）

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证
任务书要求"审计并实现"；本文只做审计与可审查方案，**不实现**——三者都需要 Owner 先定业务规则（§6）。
按 N26 同一口径：**有 React 页面不等于有实现**；生产入口是 `src/app.jsx → AuthoritativeApp`，只能从 `src/legacy-demo-app.jsx` 到达的一律计为 NOT IMPLEMENTED。

## 0. 结论

| 对象 | 内核（表/状态机/命令/权限） | 前端 | 判定 |
|---|---|---|---|
| Purchase Order | 无 | 置灰"Not available"选项 + 2 张不可用报表 | **NOT IMPLEMENTED** |
| Check（实体支票） | 无 | 置灰选项、不可用 CHECK_DETAIL 报表、**导航项 `checks-payments` 实际渲染账单付款登记簿** | **NOT IMPLEMENTED** |
| AP Write-off | 无 | 无 | **NOT IMPLEMENTED**（已由现有测试钉定） |
| AR Write-off / 坏账 | 无 | 无 | **NOT IMPLEMENTED**（且 AR 连 void/cancel 都没有） |

**最需要注意的不是"缺三个对象"，而是 §4：今天唯一能做核销的路径是手工分录，而手工分录会让账龄与控制科目对账直接失衡——这是一个可证明的、当前就存在的控制断裂。**

## 1. Purchase Order — 结构性缺席

已核验（全库 439 个迁移）：
- `purchase_order|goods_receipt|three_way` 命中数 **0**
- **`quantity` 命中数 0** —— 数量概念在 schema 中根本不存在，因此数量控制与按数量的收货匹配是**结构性缺席**，不是"有表未接线"
- 单据类型系统无法表达 PO：`004:26` `document_kind text NOT NULL CHECK (document_kind IN ('AP_BILL','AR_INVOICE'))`
- 内核无 purchase/PO 相关方法；HTTP 无 `purchase-orders` 路由段
- 权限目录无 `*.PURCHASE_ORDER.*` / `PO.*`

仅存于 UI / 目录（无内核支撑）：
- `src/authoritative-workspace.jsx:43` `{id:'PURCHASE_ORDER',label:'Purchase order'}`，无 `available:true`，故 `:221` 渲染为 `disabled` 并加后缀 `" — Not available"`
- `src/authoritative-reports-workspace.jsx:110,112` `OPEN_PURCHASE_ORDER_BY_PROJECT` / `..._LIST_BY_VENDOR` 在**不可用**报表目录中
- `purchase_order_ref` 出现在 AI 决策包契约（`runtime/ai-accounting-decision-packet-full-contract.mjs:15,66`）中，是 CONSTRUCTION_COST 必带的**自由文本引用，不是指向任何 PO 行的外键**

最近似能力：AP 账单本身（`business_document`，表头级金额、无行、无数量）+ 项目成本编码/预算（`project_master`、`project_cost_code`、`budget_line`）。**无承诺/预算占用余额，无收货，因此不存在两方或三方匹配。**

## 2. Check — 结构性缺席

已核验：`check_number|check_no|stop_payment|void_check` 命中数 **0**（按业务标识符搜索，已排除 SQL `CHECK` 约束关键字）。

**付款对象本身不带任何支付工具信息**：`payment_occurrence`（`004:52-72`）有 `occurrence_kind IN ('AP_PAYMENT','AR_RECEIPT')`、金额、币种、日期、状态、分录链接 —— **无 payment_method、无 instrument、无支票号、无收款人字段**，且**全库 `ALTER TABLE payment_occurrence` 命中数 0**。所以没有任何东西可供编号、作废或止付。

"check" 字段确实出现的地方**只在导入侧且无类型**：`runtime/wbs-inbound-data-adapter.mjs:41` 列出上游应付流的字段名 `check_system, check, check_no, check_amount, check_date, clear_date`；`wbs-provider-final1-payable-normalizer.mjs:101`（`checkNo`/`checkDate`）等。这些若被持久化，落在 `wbs_inbound_row.raw jsonb`（`058:7-9`）里 —— **无类型列、无支票号唯一性、无生命周期**。

UI：
- `src/authoritative-workspace.jsx:42` `{id:'CHECK',label:'Check'}` 同样置灰为 "Not available"
- `src/authoritative-reports-workspace.jsx:62` `CHECK_DETAIL` 在不可用报表目录
- **导航标签误导**：`src/authoritative-navigation-shell.jsx:42` 的 `checks-payments` 项，在 `src/authoritative-app.jsx:779` 被路由到 `AuthoritativeBillPaymentsWorkspace` —— **是账单付款登记簿，不是支票登记簿**。与 N26 §3 的「Closing Accounting」属同一类问题

最近似能力：`payment_occurrence`(AP_PAYMENT) + 银行对账子系统。付款可被匹配并清算，但**因为没有支票号，就没有未兑付支票清单、没有陈旧支票账龄、没有止付状态**。

## 3. Write-off — 两侧皆无，已由现有测试钉定

已核验：`write_off|writeoff|bad_debt|uncollectible` 全库命中数 **0**。

调整类型枚举封闭且无核销：`004:87` `adjustment_kind text NOT NULL CHECK (adjustment_kind IN ('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL','AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL'))`，且无后续迁移拓宽它。

### 现有钉定测试（S34 已实跑通过，本文引用其精确内容）

**`tests/ap-lifecycle-state-machine-postgres.test.mjs:285`** — `R03-5: the AP write-off is not implemented anywhere — pinned as a gap, not assumed`。文件头 `:14-15` 自陈"内核根本没有核销命令，所以本文件钉住这个事实，而不是任其被假定为已实现"。它对真库断言：
1. `SELECT proname FROM pg_proc WHERE proname ~* 'write.?off'` 返回 `[]`
2. `business_adjustment` 的 adjustment_kind 约束不匹配 `/WRITE_OFF/i`
3. 正向钉定：今天唯一的非现金 AP 清偿路径是 `AP_BILL_VOID`（全额）与 `AP_VENDOR_CREDIT`（部分）

**注意断言 1 的范围**：它是**全库 `pg_proc` 普查**，因此同时也否证了 **AR** 核销例程——schema 中不存在任何形式的核销函数。

**`tests/ar-lifecycle-state-machine-postgres.test.mjs`** — AR 侧比预期更缺：
- **R04-2**（`:205`）：`permission_catalog` 中 `AP.%` 匹配 VOID|CANCEL 的是 `['AP.BILL.VOID.APPROVE','AP.BILL.VOID.CREATE']`，而 `AR.%` 匹配结果为 **`[]`**——"AR 连 void 或 cancel 权限都没有"。恰一个例程能把 `business_document.status` 写成 `'VOID'`（`refs_apply_ap_ar_posted_adjustment`），且它以 `AP_BILL_VOID` 为门。测试还**警告**：现行视图 `refs_ap_ar_control_reconciliation` 只在 AP 腿排除 VOID，"若日后引入 AR void 而不同步改这个视图，会静默重复计数"。内核亦无 `createArInvoiceWriteOff`（`:259`）
- **R04-4**（`:313`）：AR 退款是终态——无 `AR_REFUND_REVERSAL`/`AR_REFUND_VOID` 类型（而 `AP_PAYMENT_REVERSAL` 与 `AR_RECEIPT_REVERSAL` 都有）。另发现 legacy `refs_create_ar_refund` 在 HTTP 侧已 410 退役（`accounting-http.mjs:3513`）但**仍安装且仍对 `refs_app` 授予 EXECUTE** —— 不可达死代码上挂着实时授权
- **R04-3**（`:263`）：`sales_receipt.status` 是 `DRAFT/POSTED` 两态，无 reversed 态；冲销其 MANUAL 分录后 `status` 仍为 POSTED 且 revision 不变

## 4. 今天做核销会发生什么（本项最重要的一节）

**唯一路径是手工分录**（`createManualJournal`/`createJournalAdjustment`）。后果是**可证明的控制断裂**：

账龄函数 `refs_ap_aging`/`refs_ar_aging`（现行定义 `046_ap_ar_aging_available_credits.sql`）有两条腿：
- 单据腿（`046:19-22` AR / `:53-56` AP）：取 `business_document.open_balance`，过滤 `status NOT IN ('DRAFT','PENDING_POST','VOID','REVERSED')`
- 贷项腿：**按字面枚举的调整类型** `AR_CREDIT_MEMO`（`:28`）/ `AP_VENDOR_CREDIT`

手工分录移动了 291001/120200，**但从不触碰 `business_document.open_balance`**。于是：
1. 该单据**永远继续账龄**
2. `refs_ap_ar_control_reconciliation`（`039:5-6` 单据侧 = `sum(open_balance)`；`:10-11` 台账侧 = 291001/120200 净额；`:17,19` 相等标志）**翻为不平**

代码自己承认了这一点：`428_ap_control_member_open_items_read.sql:6` 把"台账净额与子账开口余额不符"描述为"控制人必须解释的异常（未核销供应商贷项、**291001 上无单据的手工 JE**、在途清算）"。

**而且 CoA 里早就有专用坏账科目却无对象可过账到它们**：`src/coa-wbs.js` 含 `482100 Bad Debt Expense`、`482400 Bad Debt Recovery`、`706000 Bad debt expense(Credit losses)`、`125003 Allowance for Doubtful Accounts`、`121001 Allowance for credit losses`，以及数十个 `Less: … Write Off` 收入备抵科目。

### 若要实现，三种形态的账龄后果（供 Owner 决策参考）

| 实现形态 | 账龄与控制对账 |
|---|---|
| 手工分录（今天） | **必然失衡**（上述） |
| 新增 `business_adjustment` 类型（如 `AP_WRITE_OFF`） | **仍然错**，除非同步改 046 —— 贷项腿按字面类型名过滤，新类型对两个账龄函数与 `refs_ap_ar_period_control_lineage`（`166:36-38`）都不可见 |
| 复用分摊机制减少 `open_balance`（`009:43-50` 的供应商贷项路径，会 `open_balance=open_balance-amount` 并置 PAID/PARTIALLY_PAID） | 账龄与实体控制合计**自动跟随**；期间口径仍需补一项（同 C23 缺陷） |

另：R03-4（`ap-lifecycle:280-283`）钉定恰三个读者排除非账龄状态（`refs_ap_aging`、`refs_ar_aging`、`refs_read_ai_ap_aging_risk_source`），并要求任何新的账龄读者**有意识地**加入该集合。

## 5. 权限现状

`permission_catalog`（`002:337-338`，码正则 `^[A-Z][A-Z0-9_.]+$`）中：
- 含 PURCHASE / CHECK / WRITE 的码：**无**。**没有任何休眠未用的权限可供复用**，三者各需新建目录行
- 现有 AP/AR 码：`AP.VIEW`、`AP.BILL.CREATE`、`AP.BILL.VOID.CREATE`、`AP.BILL.VOID.APPROVE`、`AP.EXPENSE.CREATE`、`AP.PAYMENT.CREATE`、`AP.PAYMENT.REVERSE`、`AP.VENDOR_CREDIT.CREATE`、`AP.VENDOR_CREDIT.APPLY`、`AR.VIEW`、`AR.INVOICE.CREATE`、`AR.RECEIPT.CREATE`、`AR.RECEIPT.REVERSE`、`AR.CREDIT_MEMO.CREATE`、`AR.CREDIT_MEMO.APPLY`、`AR.REFUND.CREATE`、`AR.SALES_RECEIPT.CREATE`
- 现有域中**无 PROCUREMENT 域**
- **形态先例**：AP/AR 中唯一的 maker/approver 对是 `AP.BILL.VOID.CREATE` + `AP.BILL.VOID.APPROVE`，且 `ar-lifecycle:211-213` 按名断言了该对 —— 因此新增 `AP.BILL.WRITE_OFF.CREATE/APPROVE` 之类**会打破那个 deepEqual 断言，迫使钉定被有意识地修订**。这是好事，不是障碍

## 6. Owner 决策

三者都**不能由我代为设计**，因为代码里没有任何依据可供推断业务规则。

- **D-N09-1（优先）Write-off**。是否实现？若实现，必须先定：
  (i) **形态**——按 §4 的三种之一（强烈建议第三种"分摊式减少 open_balance"，因为它是唯一能让账龄与控制对账自动保持一致的路径）；
  (ii) **AP 与 AR 是否对称**（AR 还额外缺 void/cancel，见 R04-2）；
  (iii) **是否走四眼**（建议沿用 `AP.BILL.VOID.CREATE/APPROVE` 的 maker/approver 形态）；
  (iv) **备抵法还是直接核销法**——CoA 同时有 `Allowance for Doubtful Accounts` 与 `Bad Debt Expense`，两种会计政策的分录完全不同，这是会计政策决策不是技术决策。
  **在此之前，用手工分录做核销会持续制造控制对账失衡**（§4），这一点应当立即告知控制人。
- **D-N09-2 Purchase Order**。是否进路线图？注意这不是"加一张表"：**schema 中完全没有数量概念**，三方匹配需要行级 + 数量 + 收货对象，是一个完整的采购领域。若只需要"承诺/预算占用"而非完整采购，成本会低得多——请 Owner 明确到底需要哪一个。
- **D-N09-3 Check**。是否需要实体支票管理（支票号序列、未兑付清单、止付、作废）？最小变更是给 `payment_occurrence` 加支付工具字段 + 支票号唯一性；完整形态还需未兑付支票账龄与银行对账集成。
- **D-N09-4 导航标签**。`checks-payments` 指向账单付款登记簿，建议改名（与 D-N26-2 同类，零风险）。
- **D-N09-5 死代码授权**。legacy `refs_create_ar_refund` 已 410 退役但仍对 `refs_app` 授予 EXECUTE（R04-4 发现）。是否 REVOKE？属前向、低风险，但需确认无调用方。
- **D-N09-6 AR void/cancel 缺失**（R04-2）。若要补，**必须同步修改 `refs_ap_ar_control_reconciliation`**，否则按测试的警告会静默重复计数。
