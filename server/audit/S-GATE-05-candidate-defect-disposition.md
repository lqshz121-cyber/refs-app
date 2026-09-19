# S-GATE-05 — 候选缺陷处置

会话 claude-9c9cd162 · 2026-09-20 · 候选 `80f9fbfd` · 链头 433

任务书要求：处置或明确标记四类阻断；**对任何无法在本次上线实现的核心会计模块，明确为 NO-GO 或经 Owner 签字的 scope exclusion；不得用页面或 mock 代替持久化功能。**

## 0. 处置总表

| # | 阻断项 | 处置 |
|---|---|---|
| 1 | WBS `final1/orphans` 死路由 | ✅ **已消除**（已核验：`accounting-http.mjs` 中 `orphans` 命中数 = 0） |
| 2 | 会计设置剩余失败 | ⚠️ **收窄但未清零**：11 个相关文件中 10 个全绿；第 11 个的 34 条子测试中，**2 条在全新库上仍超 10 s 生产语句超时**（新发现） |
| 3 | 历史 barrier 测试 | ⚠️ **原语已补齐，转换未做**：20 个调用点仍穿越 `down/401`，属既有红集（R14） |
| 4 | 缺失的 AP/AR/地产功能 | ❌ **须 Owner 裁定 NO-GO 或 scope exclusion**（§4） |

## 1. WBS final1/orphans 死路由 —— 已消除

已核验：`api/accounting-http.mjs` 中 `orphans` 字符串命中数为 **0**；`runtime/*.mjs` 亦无 `final1/orphans` 路由。该项由 N02 处置完毕，本轮复核确认。

## 2. 会计设置剩余失败 —— 收窄，并有一项新发现

S-GATE-03 全量运行中，11 个会计设置相关测试文件：

| 结果 | 文件数 | 断言 |
|---|---|---|
| PASSED | 10 | contract 11、http 10、kernel-wiring 3、migration-contract 19、openapi 8、authoritative-contract 7、authoritative-http 7、wbs-proposal 7、wbs-h1-proposal-http 2、wbs-h1-proposal 4 —— 合计 **78 条全绿** |
| FAILED | 1 | `accounting-settings-workflow-postgres` |

**新发现（本轮实证，非读码）**：把该文件单独放到**完全全新的数据库**上重跑，问题依然复现：

- 子测试 1–13 通过
- **子测试 14**（workflow 表拒绝一切不合法状态/actor/时间戳/父子/接替形态）→ `57014`，**10016 ms**
- **子测试 15**（history 表拒绝非规范转换/修订/前驱/actor/理由）→ `57014`，**10177 ms**

两者都恰好卡在 **10 s = `runtime/config.mjs:58` 的生产默认 `statement_timeout`**。

**定性**：**既有问题，不是候选引入，也不是共享库残留。** 这两条是"约束矩阵"型用例（对一张表批量尝试大量非法形态），单条语句耗时超过生产语句超时。

**这件事的双面性值得 Owner 注意**：
- 若只是测试写法问题（一条语句里塞了过多矩阵行），改测试即可
- 但若生产代码里也存在同形状的语句，那么**生产环境下它同样会在 10 s 被 `statement_timeout` 掐断** —— 那就不是测试问题
- **本会话未区分这两者**，因为需要看到被掐断的确切语句。列为 D-SG05-2

该文件整体在 140 s 内未跑完（34 条子测试），**其余子测试状态未知**，不得宣称通过。

## 3. 历史 barrier 测试 —— 原语已补，转换未做

完整分析见 `R14-migration-barrier-coverage-review.md`。摘要：

- `postgres-kernel.test.mjs` 有 **20** 个 `migrateDownThrough` 调用点，target 181..333，**全部低于 401**
- 从链头 433 走到任何一个都必须执行 `down/401`，其 RAISE 无条件 → P0001
- S-GATE-03 实跑**确证**了这一点：该文件失败的内层真因正是 `P0001: Native settlement function replacement cannot be rolled back because migration 305 is retained as immutable historical evidence`
- 设计文档 `MIGRATION-BARRIER-TEST-DESIGN.md` 的方案正确，但其 `withHistoricalHead` helper **从未被实现**（全仓命中数 0）
- **本轮已实现并以最深 target 181 实证（真库 4/4）**

**处置**：转换是确定性工作，但需逐点复核原测试意图、且每点需真库验证，列为 **D-R14-1**。转换前建议按 **D-R14-2** 以 `t.skip` 附理由标记，使其在 R13 运行器中归入 SKIPPED 而非静默红。

## 4. 缺失的 AP/AR/地产功能 —— 须 Owner 裁定

这是本项唯一无法由我处置的一类。任务书明确："**不得用页面或 mock 代替持久化功能**"。以下全部**已核验为内核不存在**，且其中数项在 UI 上有会误导的入口。

### 4.1 AP/AR 缺口（N09）

| 对象 | 内核 | UI 现状 | 影响 |
|---|---|---|---|
| Purchase Order | 无表、无命令、无路由、无权限；**schema 中完全没有 quantity 概念** | 置灰 "Not available" 选项 + 2 张不可用报表 | 无承诺/预算占用，无两方/三方匹配 |
| Check（实体支票） | 无；`payment_occurrence` **无任何支付工具字段**，全库无 `ALTER TABLE payment_occurrence` | 置灰选项；**导航项 `checks-payments` 实际渲染账单付款登记簿** | 无未兑付支票清单、无陈旧支票账龄、无止付 |
| AP write-off | 无（`pg_proc ~* 'write.?off'` = ∅，已由现有测试钉定） | 无 | **见下方风险** |
| AR write-off / 坏账 | 无 | 无 | 同上 |
| AR void / cancel | 无（`AR.%` 匹配 VOID\|CANCEL 的权限 = `[]`） | — | 开错的 AR 发票无干净撤销路径 |
| AR refund 冲销 | 无（退款是终态） | — | |

**必须向 Owner 强调的一条风险**：今天唯一的核销路径是**手工分录**，而它**不触碰 `business_document.open_balance`**，因此该单据会永远继续账龄，且 `refs_ap_ar_control_reconciliation` 会翻为不平。代码自陈这是"控制人必须解释的异常"（`428:6`）。**这不是未来风险，是当前每做一笔核销就发生一次的控制断裂。**

### 4.2 地产缺口（N25 / N26 / N23）

| 能力 | 状态 |
|---|---|
| **转固（CWIP → 固定资产）** | **完全不存在**，且被 `197:19` + `237:32` + `341:65` 结构性堵死。**CWIP 余额无任何代码路径可进入资产台账** |
| 单元成本分摊（AREA / EQUAL） | 明确拒绝（`430:224-226`）；`allocation_weight` 是死数据 |
| 房地产 Closing 作为业务对象 | 无表、无状态机、无命令、无路由；仅一个 AI 只读函数（249）。**生产导航「Closing Accounting」实际指向会计期间关闭工作台** |
| 物业管理接管 / 物业主数据 | 全库零命中；**无 `property_master`** |
| 持股比例 / 权益法 / 少数股东权益 | 内核零命中；仅存于冻结演示壳 |
| 外币折算 / CTA | 合并强制单币种 |

### 4.3 我的建议（Owner 裁定用）

按任务书二选一，逐项给出我的建议：

| 能力 | 建议 | 理由 |
|---|---|---|
| AP/AR write-off | **NO-GO，除非本次不涉及核销业务** | 它不是"少个功能"，而是**用替代路径会主动破坏控制对账**。若上线后确实需要核销，必须先有对象 |
| 转固 | **scope exclusion（需 Owner 签字）** | 只要本期无在建工程完工，可暂缓；但必须书面确认，否则完工时会卡死 |
| Purchase Order | **scope exclusion** | 采购是独立领域，缺它不破坏已有账务正确性 |
| Check | **scope exclusion** | 同上；但若业务实际开支票，未兑付支票无法管理 |
| Closing 对象 | **scope exclusion + 改导航标签** | 标签误导是零成本可修的，应先修 |
| 持股/权益法/外币 | **scope exclusion** | 须确认集团实际结构确为全资单币种 |
| AR void/cancel | **NO-GO 或 scope exclusion** | 开错发票无撤销路径，是日常操作会遇到的 |

**以上全部为建议，非裁定。** 每一项都需 Owner 明确签字为 scope exclusion，或列为 NO-GO。**在签字之前，S37 的 NO-GO 建议维持不变。**

## 5. 本项未做什么

- 未修改任何候选代码以"消除"上述缺陷
- 未把任何未实现能力标记为已实现
- 未以页面存在或 mock 替代持久化功能的证据
- 未查真实账以评估核销存量影响（需 Owner 授权）

## 6. Owner 决策

- **D-SG05-1（首要）** §4.3 逐项裁定 NO-GO / scope exclusion。**AP/AR write-off 与 AR void/cancel 建议优先裁定**——它们是日常操作会遇到、且当前替代路径会破坏控制对账的两项。
- **D-SG05-2** 会计设置两条超时用例（§2）：需先定位被 `statement_timeout` 掐断的**确切语句**，以区分"测试写法问题"与"生产同样会被掐断的查询"。这决定它是改测试还是改代码。
- **D-SG05-3** 是否接受 `accounting-settings-workflow-postgres` 其余子测试**状态未知**这一事实进入发布评审（该文件 140 s 内跑不完）。建议给它单独的长超时 job（同 D-SG03-3）。
- **D-R14-1 / D-R14-2** 历史 barrier 转换（见 §3）。
