# X03 — 真实 WBS Draft 科目映射审核包

会话 claude-9c9cd162 · 2026-09-20 · 候选 `2adae56d` · 链头 435

## 0. 结论：机制已补齐并测试；数据侧阻断于 staging 只读访问

X03 由两半组成，二者的状态不同，必须分开说：

| 半 | 状态 |
|---|---|
| **机制**：分组维度、proposal→review→approve 路径、异常入队 | ✅ **已完成并测试**（§2–§4） |
| **数据**：把 WBPA 那 1191 条实际聚合成工作包 | ⛔ **阻断**——1191 条在 staging 数据库里，本会话无访问（§5） |

**不以合成数据冒充真实工作包。** 按任务书"不得伪造数据"，我不会生成一份看起来像 1191 条聚合结果的文件。

## 1. 1191 是什么（引自 H09/H02 的既有取证，非本轮重新测量）

WBPA 2026 H1 受控导入：**1285 源 / 1237 TEST_ONLY Draft / 0 正式过账**。
- `mapping_state`：**1191 `MAPPING_MISSING`**、94 `MAPPING_READY_FOR_REVIEW`、0 `AMBIGUOUS`
- `import_state`：1237 行有 Draft、48 行 `SOURCE_STAGED` 无 Draft
- 交叉：Draft∧Ready 84、Draft∧Missing 1153、Staged∧Missing 38、Staged∧Ready 10
- 分布：9 个 project_code、75 个 vendor_no、47 个 cost_code（仅计数，未保存值）
- 金额形态：1209 行为正（+1,361,427.34），**76 行为负（−24,343,397.24），其中 11 行 < −1,000,000**（最大 |3,238,035.50|），全部处于 Ready → **需人工确认符号约定（付款/冲销 vs 应付发生），不得自动过账**

O01 已定位根因：WBS 规则 `project_codes=公司代码` + 22 个科目缺失 + Credit 默认规则缺失 + Settings 未审批。

## 2. 机制：既有工具已覆盖大部分要求

`server/tools/wbs-h1-mapping-review-workpack.mjs`（O01 产出）是一个**纯函数**，输入是操作员做的两份已认证只读导出，输出是审核队列。它已经：
- 按 Controller 必须做的**决定**分组，共 8 个决策类
- 以**整数分**重算 control totals
- 区分"可由 REFS 建议"与"必须人工决定"
- **从不审批、从不写入、从不过账**（载荷硬置 `accounting_authority:'NONE'`、`can_approve:false`、`can_post:false`）

X03 要求的分组维度中，原工具已有：公司、期间、候选 COA、金额、笔数。**缺：风险、置信度。**

## 3. 本轮补齐：风险与置信度（V1 → V2）

### 置信度 —— 由决策类推导，不是猜

| 决策类 | 置信度 | 依据 |
|---|---|---|
| `SETTINGS_APPROVAL_PENDING` | **HIGH** | 规则已匹配、科目已存在，只差一个人工 Settings 决定 |
| `COA_ACCOUNT_TO_CREATE` | MEDIUM | 规则已匹配，但科目须经 COA 权限创建 |
| `RULE_SCOPE_COMPANY_WIDE` / `RULE_PROJECT_MISMATCH` / `RULE_WITHOUT_ACCOUNT` / `NO_RULE` / `CREDIT_RULE_MISSING` | LOW | 需要人的语义判断，或根本无规则可依 |
| `VENDOR_MEMBER_MISSING` / `COST_CODE_MISSING` | **NONE** | 属主数据/数据质量问题，不是映射决定 |

置信度是**决策类的属性**而非逐行属性，因此不会逐行漂移。

### 风险 —— 由金额推导，且符号与量级同等重要

| 条件 | 风险 |
|---|---|
| \|金额\| ≥ 1,000,000 | **CRITICAL** |
| **金额为负**（任何量级） | **≥ HIGH** |
| ≥ 100,000 | HIGH |
| ≥ 10,000 | MEDIUM |
| 其余 | LOW |
| 金额不可解析 | **UNKNOWN**（不静默降为 LOW） |

**负数永不低于 HIGH** 是刻意的：H09 发现的 76 行负数（合计 −24,343,397.24）的符号约定尚未经人工确认，在确认前它们不应被排在低优先级。

### 新增 `triage` 视图
`by_risk` / `by_confidence` 各自的 rows/entries/amount，加上 `suggestable_rows`、`must_decide_rows`、`negative_amount_rows`。队列按 **风险降序 → 置信度降序 → 行数降序** 排序，使 Controller 先看到"钱最多且最不确定"的条目。

schema 升为 `WBS_H1_MAPPING_REVIEW_WORKPACK_V2`。

测试 `tests/wbs-h1-mapping-review-workpack.test.mjs` **4/4**（原 3 项 + X03 新增 1 项，覆盖量级分档、符号规则、不可解析金额、以及置信度按类固定）。

## 4. proposal → review → approve/reject 路径

**已有可直接复制的先例**：保险 PC 映射族已实现完整链路 ——
`refs_create_wbs_insurance_pc_mapping_proposal` → `refs_read_wbs_insurance_pc_mapping_proposal` → `refs_approve_wbs_insurance_pc_mapping_proposal`，并有 `refs_record_wbs_insurance_pc_mapping_pre_admission` 与 `refs_read_wbs_insurance_pc_mapping_trace`。

底层 `mapping_snapshot` 已具备 `DRAFT → APPROVED → RETIRED` 生命周期（`001:241`）与 `priority` 解析（同优先级多候选 = 未解析，绝不猜测）。

**因此 payable 族不需要新机制，只需要把保险族的命令形状复制一份。** 本会话未创建该迁移，原因是：目标科目集合取决于 §5 的真实数据（22 个缺失科目的具体身份），在拿到数据前建命令等于先猜结论。列为 D-X03-2。

**异常入队**：映射错误/缺失/重复/跨期已有 `accounting_exception`（`001:320-342`，含 OPEN/IN_REVIEW/RESOLVED/WAIVED 与活跃去重偏唯一索引）与 `refs_read_mapping_exception_register`。N20 §3.2 已记录其缺口：**无通用 resolve/waive/reprocess 命令**，唯一解决器是 `157:84` 的单一领域硬编码。

## 5. 阻断：数据侧所缺的最小输入

工具是纯函数，输入是操作员做的**两份已认证只读导出**：

```
GET /entities/{id}/wbs/h1-accounting-settings-proposal?periodId=<period>
GET /entities/{id}/wbs/h1-payable-accounting-proposal?periodId=<period>&limit=200&offset=<N>   # 全部页、全部期间
```

然后：

```
node server/tools/wbs-h1-mapping-review-workpack.mjs \
  --settings settings.json --payables payables-pages.json [--company-wide-project WBPA]
```

**本会话缺少的**：staging 的只读访问（S35 已确证环境中 WBS 相关环境变量为 0；且当前用户访问 REFS US Staging 返回 403，缺只读 grant，**不得自行授予**）。

因此本项**不产出** 1191 条的聚合文件。工具已就绪，拿到两份导出即可在数分钟内产出。

## 6. 安全性：输出不含敏感负载

工具输出的是**决策类、计数、整数分合计、成本码/科目码**。它不回传原始 WBS 负载、不含个人信息、不含凭据。H09 当时的分布统计亦为"仅计数，未保存值"。这一性质由既有测试的第 3 项（input validation and no-network/no-write source guard）守住。

## 7. Owner 决策

- **D-X03-1（阻断解除）** 是否授权 staging 只读 grant，使操作员能产出上述两份导出（须按 F8 最小权限方案：只读隔离测试实体与报表，不含 post/reopen/WBS write/admin）。**这是 X03 数据侧唯一的前置。**
- **D-X03-2** payable 映射族的 proposal→approve 命令是否照搬保险族形状新建迁移。建议**在拿到 §5 的导出之后**再建——22 个缺失科目的具体身份决定命令的校验面，先建等于先猜。
- **D-X03-3（会计判断，非技术）** 76 行负数（−24,343,397.24，含 11 行 < −1,000,000）的**符号约定**：是付款/冲销还是应付发生？在 Owner 确认前，这些行已被本轮的风险分档强制排在最前且标为 ≥HIGH，**不得自动过账**。
- **D-X03-4** 是否补通用异常 resolve/waive/reprocess 命令（同 D-N20-4），否则映射异常只能靠单一硬编码解决器出队。
