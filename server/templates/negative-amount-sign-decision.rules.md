# Z05 — 76 条负数符号决策模板：验证规则与状态转换

配套文件：`negative-amount-sign-decision.template.json`（schema `REFS_NEGATIVE_SIGN_DECISION_V1`）

**本模板不含任何真实交易数据，也不得被填入后连同真实数据提交进仓库。**

## 1. 填写规则（每条 entry）

| 字段 | 规则 |
|---|---|
| `source_category` | 必填。按**来源类别**分组，不是逐行 —— 76 行应收敛为少数几条 entry |
| `stable_id_hash` | 必填，`sha256:` 前缀。**是身份的哈希，不是身份本身**；不得写 vendor_no、发票号或描述 |
| `company_code` | 只写代码，**不写公司名** |
| `period_code` | `YYYY-MM` |
| `absolute_total` | 聚合金额，四位小数字符串。**不得逐行列出金额** |
| `risk` | 按 X03 规则推导；**负数任何量级不低于 HIGH**，\|金额\|≥1,000,000 为 CRITICAL |
| `candidate_meaning` | 必须是 `decision_options` 的键之一；这是**准备者的提议**，不是决定 |
| `debit_effect` / `credit_effect` | 只写科目代码。与 `candidate_meaning` 的 `ledger_effect` 必须一致 |
| `approver` | **必须不同于 `prepared_by`**（四眼） |
| `decided_meaning` | 初值只能是 `UNDECIDED`；只有具名 approver 可改 |
| `decision_reason` | 一旦 `decided_meaning` 离开 `UNDECIDED` 即为必填，8–2000 字符 |

## 2. 状态转换：每种决定之后系统允许与拒绝什么

这是本模板最重要的一节 —— **决定不只是一个标签，它决定了后续哪些操作被允许**。

| `decided_meaning` | 允许 | 拒绝 |
|---|---|---|
| `UNDECIDED`（初值） | 只读查询、进异常队列 | **禁止建 Draft、禁止 Post、禁止映射审批** |
| `PAYMENT_OR_SETTLEMENT` | 建付款 Draft（需匹配的已过账应付 + 银行成员） | 无匹配应付时禁止；禁止直接冲减 open_balance |
| `REVERSAL_OF_PRIOR_ACCRUAL` | 建冲销 Draft，行由原分录派生 | **必须指名原分录**；无原分录标识则禁止 |
| `CREDIT_NOTE_FROM_VENDOR` | 走 `AP_VENDOR_CREDIT` 调整 + 分摊 | 禁止当作付款处理（二者对账龄的影响不同） |
| `NEGATIVE_PAYABLE_ACCRUAL` | 建负额应付 Draft | **需 Owner 逐条书面确认**；这是最容易误判的一种读法 |
| `SOURCE_DATA_ERROR` | 进异常队列，等待 WBS 侧更正 | **REFS 不得自行翻转符号**；禁止任何 Draft |

**所有路径共同的硬约束**（与现有控制一致，非本模板新增）：
- 一律止于 **Draft**，其后仍走 Submit→Review→Approve→Post 四眼链
- 期间控制照旧：非 OPEN 期间以 55000 拒绝
- **禁止自动 Post**、禁止绕过 SoD、禁止 WBS 写入

## 3. 校验清单（填完后逐条过）

1. 没有任何 entry 的 `decided_meaning` 仍为 `UNDECIDED` 却填了 `decided_at`
2. 每条已决定的 entry 都有 `decision_reason`（≥8 字符）与 `approver`
3. 每条 entry 的 `approver ≠ prepared_by`
4. `debit_effect`/`credit_effect` 与所选 `decision_options[*].ledger_effect` 不矛盾
5. 所有 `absolute_total` 之和 = **24,343,397.24**（H09 的负数合计绝对值）—— 对不上说明分组遗漏
6. 所有 `row_count` 之和 = **76**
7. 全文不含 vendor 名称、发票号、描述文本或任何原始负载
8. 标为 `NEGATIVE_PAYABLE_ACCRUAL` 的 entry 均附 Owner 书面确认引用

第 5、6 条是 control total —— **它们对不上就不要提交**。

## 4. 本模板不做的事

- **不替 Owner 做会计决定。** `candidate_meaning` 是提议，`decided_meaning` 只有具名 approver 能填
- **不读取 staging 原始行。** 本会话无访问，且模板按设计也不需要
- 不把 76 行的任何金额逐行写出 —— 只有按类别的聚合
