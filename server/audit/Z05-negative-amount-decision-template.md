# Z05 — 76 条负数会计决策模板

会话 claude-9c9cd162 · 2026-09-20
**未读取任何 staging 原始行。模板不含真实交易数据，也不替 Owner 做会计决定。**

## 0. 交付

| 文件 | 内容 |
|---|---|
| `server/templates/negative-amount-sign-decision.template.json` | 可填写模板，schema `REFS_NEGATIVE_SIGN_DECISION_V1` |
| `server/templates/negative-amount-sign-decision.rules.md` | 填写规则、状态转换、校验清单 |

## 1. 为什么需要人来决定

H09 的既有取证（本轮未重新测量）：**76 行负数，合计 −24,343,397.24，其中 11 行低于 −1,000,000**，最大绝对值 3,238,035.50。

一个负的来源金额可能意味着付款、冲销、供应商贷项、真负额应付，或者干脆是来源侧符号错了。**这五种读法的分录完全不同，系统无法从数据本身推断。** 在 Owner 决定前，这批行不得建 Draft、不得过账。

## 2. 六个决定选项（封闭集，各自写明分录后果）

| 选项 | 分录后果 | 前置 |
|---|---|---|
| `PAYMENT_OR_SETTLEMENT` | Dr 291001 / Cr 现金，冲减未付 | 有匹配的已过账应付 + 银行成员 |
| `REVERSAL_OF_PRIOR_ACCRUAL` | 原分录的镜像 | **必须指名原分录** |
| `CREDIT_NOTE_FROM_VENDOR` | 走 `AP_VENDOR_CREDIT` + 分摊 | 供应商成员与贷项证据 |
| `NEGATIVE_PAYABLE_ACCRUAL` | 负额应付（反向计提） | **需 Owner 逐条书面确认** —— 最易误判 |
| `SOURCE_DATA_ERROR` | 无分录，进异常队列 | WBS 侧更正；**REFS 不得自行翻符号** |
| `UNDECIDED` | 无 | 唯一合法初值 |

把"分录后果"直接写进选项，是为了让**选择的代价在做选择之前就摆在眼前**，而不是等实现时才发现。

## 3. 状态转换：决定之后系统允许/拒绝什么

这是模板最重要的部分 —— **决定不只是一个标签，它决定后续哪些操作被允许**。完整表见 `rules.md` §2。要点：

- `UNDECIDED`（初值）→ **禁止建 Draft、禁止 Post、禁止映射审批**
- `REVERSAL_OF_PRIOR_ACCRUAL` → **无原分录标识则禁止**
- `CREDIT_NOTE_FROM_VENDOR` → **禁止当作付款处理**（二者对账龄影响不同）
- `SOURCE_DATA_ERROR` → **禁止任何 Draft**，REFS 不翻符号
- 所有路径一律**止于 Draft**，其后仍走四眼链；期间控制照旧（非 OPEN 以 55000 拒绝）；**禁止自动 Post**

## 4. 不含真实数据的保证

- 每条 entry 以 **`sha256:` 身份哈希**标识，不写 vendor_no、发票号、描述
- 金额**只按类别聚合**，不逐行列出
- 公司**只写代码不写名称**
- `rules.md` §3 的校验清单第 7 条即为"全文不含原始负载"

## 5. 两条 control total（对不上就不要提交）

- 所有 `absolute_total` 之和 = **24,343,397.24**
- 所有 `row_count` 之和 = **76**

它们是分组是否遗漏的唯一客观检查。

## 6. 四眼

`approver` **必须不同于 `prepared_by`**；`candidate_meaning` 是准备者的**提议**，`decided_meaning` 只有具名 approver 能改，且一旦离开 `UNDECIDED` 就必须填 8–2000 字符的 `decision_reason`。

## 7. Owner 决策

- **D-Z05-1（会计判断，非技术）** 按来源类别逐条给出 `decided_meaning`。**在此之前这 76 行不得进入任何 Draft 或过账路径。**
- **D-Z05-2** 若出现 `NEGATIVE_PAYABLE_ACCRUAL`，需逐条书面确认并附引用。
- **D-Z05-3** 决定落定后，是否把 §3 的状态转换实现为系统强制（而非仅文档约定）。建议实现 —— 否则约束只存在于纸面。
