# N38 — 10 万行性能 / 分页审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证，未执行性能测试

## 1. 结论摘要

**头号发现（已亲自核验）：五个 HTTP 列表端点完全不分页且调用方无法自行限流。** 其中 `account-register` 直接读 `ledger_line`——在 10 万行总体下，单期间单科目的明细账可能返回数万行。

**第二发现**：页界不是单一政策。"limit > 200 被拒"只对约 21 处成立；**最常见的上限其实是 100（78 处）**，另有 19 处允许 500、2 处 1000、3 处 2000。

**第三发现**：P12 的 10 万行测试确实存在且质量很高，但它是**容量下的正确性契约，不是延迟基准**（文件自陈不断言时延），且**未接入任何 npm 脚本**。任何"我们有 10 万行性能门禁"的说法都属夸大。

## 2. 五个无界读（本项最高价值发现）

已逐一核验：SQL 函数签名**无 `p_limit`**、函数体**无 `LIMIT`**、HTTP 路由的 `requireExactQuery` 允许列表**不含任何分页键**——即调用方**无法**自愿限界。

| # | HTTP 路由 | 允许查询参数 | 内核 | SQL | 无界证据 |
|---|---|---|---|---|---|
| 1 | `GET .../source-documents` `:1113` | `[]` | `listSourceDocuments` `:2594` | `refs_list_source_documents` | `084:44` `ORDER BY ...` 无 LIMIT。**仅按 tenant+entity 限定——随实体生命周期无界增长** |
| 2 | `GET .../general-ledger/account-register` `:1426` | `['periodId','accountCode']` | `listAccountRegister` `:2572` | `refs_list_account_register` | `083:132` 无 LIMIT；且 `083:127` 用 `sum(...) OVER(PARTITION BY currency ORDER BY ... ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` 算运行余额。**这是 `ledger_line` 读，五者中风险最高** |
| 3 | `GET .../bank/transactions/{id}/match-candidates` `:1470` | `[]` | `listBankMatchCandidates` `:2771` | `refs_list_bank_match_candidates`（3 参，无 `p_limit`） | `381:88` 无 LIMIT。**不对称之处：同一文件里的姊妹函数 `refs_read_sales_receipt_bank_candidates`（`381:89`）有 `p_after`/`p_limit`、1–100 界（`381:94`）并回 `next_id`（`381:131`）——keyset 模式只应用到了其中一个** |
| 4 | `GET .../bank/reconciliations/{id}/worksheet` `:1517` | `[]` | `listReconciliationWorksheet` `:2895` | `refs_list_reconciliation_worksheet_v2` | `322:31` 无 LIMIT。返回该对账下全部银行行 |
| 5 | `GET .../general-ledger/chart-of-accounts` `:1386` | `['periodId']` | `listChartOfAccounts` `:2537` | `refs_list_chart_of_accounts` | `083:61` 无 LIMIT。**风险最低**——实际受 `account_master` × 币种规模约束，是运营可控的小集合，非交易量 |

内核层另有无界读（未追踪 HTTP 暴露，仅按内核层陈述）：`listAiAccrualCurrentSourceIds` `:1331`、`listAiAccrualPostedSourceIds` `:1343`、`listWbsPayableAttachmentUploads` `:1844`、`readJournalUploadRows` `:2370`、`readAiVendorMonthlySpendPopulation` `:1446`。

**适用的缓解与不适用的缓解**：10 秒运行时 `statement_timeout`（§4）限制**时长**而非**响应体积**；`54000` 有界总体守卫存在于部分函数（`300:86`、`300:185`）但**不在上述五个之中**（已核验其源文件无 `54000`）。

**无任何测试覆盖无界读。** 全库没有任何断言"列表端点响应有界"。P12 只覆盖 `listGeneralLedger` 与 `getFinancialStatements`。

## 3. 页界政策：不统一（已核验的分布）

125 个迁移文件定义 `p_limit`。对全部 `db/migrations/*.sql` 中的上界检查取值统计：

| 上限 | 出现次数 |
|---|---|
| **100** | **78** |
| **200** | **21** |
| 500 | 19 |
| 50 | 9 |
| 2000 | 3 |
| 501 | 2 |
| 1000 | 2 |
| 10 | 2 |

**因此"limit > 200 被拒"这句话对总账读及约 21 处成立，对约 106 处不成立。** 审计文档必须按面陈述，不可一概而论。

`>200` 族示例：`189:26`（总账页，`22023`，"General Ledger page is invalid"）、`300:17`（决策队列快照页）、`300:100`（总账快照页）、`109`（银行交易，且**唯一带 offset 上限**：`p_offset<0 OR p_offset>10000`）、`268`。

高上限离群（全部为 AI/分析读，全部 `22023`）：500 → `194:155`、`209:22`、`211:29`、`216:14`、`220:35`、`221:29`、`229:23`、`230:19`、`231:11`、`232:12`、`249:8`、`257:8`、`259:9`、`272:133`、`279:15`、`286:25`、`298:350`、`298:389`、`299:34`；501 → `282:14`、`284:49`；1000 → `222:9`、`223:11`；**2000 → `224:9`、`225:9`、`226:9`**。

错误码：越界一律 SQLSTATE **`22023`**（invalid_parameter_value），消息文本逐函数不同。

另一族守卫：SQLSTATE **`54000`**（program_limit_exceeded）用于整体总体界。`300:49`/`300:132` 取 `LIMIT 100001`，随后 `300:86`/`300:185` 在 `observed_count > 100000` 时抛 "snapshot exceeds the safe population bound" —— **>10 万的快照读被整体拒绝，而非静默截断**，这是好设计。

## 4. 运行时语句超时

`runtime/config.mjs:58`：`statementTimeoutMs` 默认 **10000 ms**（范围 100–600000），`lockTimeoutMs` 默认 **5000 ms**。在 `runtime/db.mjs:17-18` 施加到每个 `pg.Pool`。

例外：迁移运行器在迁移体期间置 `statement_timeout='0'`/`lock_timeout='0'` 并在之后恢复（`runtime/migrations.mjs:16-25`）；字典导出用 30000/5000/`max:1`（`export-database-dictionary.mjs:37`）；部分 WBS 事务用 `set_config(...,true)` 逐事务覆盖（`kernel-repository.mjs:338,638,2999…3049`）。

池卫生：`runtime/db.mjs:26-29` 注册池 `'error'` 监听发 `database_idle_client_error`，注释（`:20-25`）记录了真实事故（`refs-accounting-api-staging` 反复 "Instance failed: exited with status 1"，S32 读回 2026-09-17）。

## 5. 分页参数与三种并存风格

HTTP 层（`api/accounting-http.mjs`，按出现次数）：`limit` ×123、`offset` ×17、`afterId` ×13、`afterRef` ×5、`cursorId` ×4、`cursorAt` ×2、`afterDate` ×2、`after` ×2、`snapshotToken` ×2。

即**三种并存分页风格**：limit/offset、keyset（`afterId`/`after`/`cursorId`）、快照令牌（`snapshotToken`）。

每个读路由都调 `requireExactQuery(...)` 带显式白名单，未知参数被拒——这也意味着**不分页的路由会拒绝 `limit` 参数**（第 2 节的成因）。

内核层：`{limit, offset}` JS 参数，`listGeneralLedger` 默认 limit **50**（`:2578`）。SQL 层：`p_limit`、`p_offset`、`p_after`、`p_after_id`、`p_after_date`、`p_after_ordinal`、`p_after_transfer`。

## 6. 排序稳定性：已检视的读全部为全序

每个分页读的 ORDER BY 都以唯一列收尾，页间不会重叠或丢失：

| 读 | ORDER BY | 出处 |
|---|---|---|
| 总账页 | `journal_date, posted_at, ledger_line_id` | `189:48,57` |
| 科目明细账 | `currency, journal_date, posted_at, ledger_line_id` | `083:132` |
| 银行交易 | `transaction_date DESC, external_bank_line_id DESC, bank_source_id DESC` | `109` |
| WBS 应付提案 | `accounting_date, source_record_hash` | `268` |
| 财报快照提案 | `prepared_at DESC, proposal_id DESC` | `288` |
| 来源单据 | `accounting_date DESC, created_at DESC, source_document_id DESC` | `084:44` |
| 对账工作底稿 | `transaction_date DESC, external_bank_line_id DESC, bank_source_id DESC` | `322:31` |
| 销售收款银行候选（keyset） | `sales_receipt_id`，`LIMIT p_limit+1` 后回 `next_id` | `381:126-131` |
| 现金转移（keyset） | `(transfer_date,cash_transfer_id) < (p_after_date,p_after_transfer)` | `376` |

总账读另计 `count(*) OVER()::bigint AS total_count`（`189:47`），每页附带总体规模，免去单独计数往返。

## 7. 热表索引

### `ledger_line` — 5 个显式索引
| 索引 | 定义 | 出处 |
|---|---|---|
| `ledger_line_financial_statement_scope_idx` | `(tenant_id,entity_id,account_code,journal_entry_id)` | `062:1` |
| `fixed_asset_ledger_scope_dimension` | `(tenant_id,entity_id,(dimensions->>'fixed_asset_register_evidence_id'),journal_entry_id)` | `338:3` |
| `fixed_asset_movement_page` | `(tenant_id,entity_id,(dimensions->>'..._id'),ledger_line_id)` | `339:2` |
| `ledger_line_gl_snapshot_join_idx` | `(tenant_id,entity_id,journal_entry_id,posted_at,ledger_line_id)` | `383:8-9` |
| `ledger_line_custom_report_scope_idx` | `(tenant_id,entity_id,period_id,account_code,journal_entry_id)` | `391:35` |

另有 `CREATE TABLE`（`001:417-437`）带来的隐式唯一索引：PK + 4 个 UNIQUE 元组。

**值得点名的缺口：没有任何索引以 `(tenant_id, entity_id, journal_date)` 开头，也没有匹配总账读实际排序键 `(journal_date, posted_at, ledger_line_id)` 的索引** —— 该 ORDER BY 需要对限定集做排序。亦无单独 `period_id` 索引。

### `journal_entry` — 3 个显式索引
`journal_entry_one_reversal_uq`（`002:81`）、`journal_entry_posted_report_scope_idx (tenant_id,entity_id,journal_date,journal_entry_id) WHERE status='POSTED'`（`062:1`）、`journal_entry_period_read_idx`（`252:1`）。

### `audit_event` — 4 个显式索引
`audit_event_entity_timeline_idx`（`290:1`）、`audit_event_period_close_history_idx`（`292:1`，偏索引）、`audit_event_period_reopen_history_idx`（`294:1`，偏索引）、`audit_event_payment_occurrence_trace_idx`（`361:6-8`，偏索引）。

`CREATE TABLE audit_event`（001）**只声明 `audit_event_id uuid PRIMARY KEY`**，无其他 UNIQUE，**无 `correlation_id`/`request_id`/`actor_id`/`idempotency_key` 索引**——而这恰是审计追溯时最常用的入口。

### WBS staging
`wbs_h1_payable_mapping_source_stage_scope_idx`（`262:1`）、`..._page_idx`（`383:12-13`）、`wbs_inbound_row_tenant_entity_id_uq`（`094:1`）。

**`staging_item` 无显式索引**；**`journal_line` 无显式索引**（均只有 PK 与 001 带来的 UNIQUE 元组）。

`383_high_volume_read_indexes.sql` 是刻意的"按排序元组给热读建索引"迁移（14 行 5 索引，表头 `383:2-3`）。

## 8. P12 10 万行测试 —— 精确陈述

`tests/large-population-performance-postgres.test.mjs`（163 行，2026-09-18 提交）。

**表头 `:1-7` 自陈（这一点必须照实转述）**：墙钟时长被测量并作为证据打印，但**不被断言**，因为共享 CI 沙箱给不出有意义的时延阈值——"the durations belong in the receipt, not in a gate"。

**它是容量下的正确性契约，不是延迟基准。不得称其为性能门禁。**

准备：`POPULATION = process.env.P12_ROWS || 100000`（`:18`）。`seedPopulation()`（`:51-83`）经 admin 池批量插入——100 张分录 × 1000 行、6 个科目、1 个期间；先建 DRAFT、填充、每张分录一条语句翻 POSTED，再由 `journal_line` 灌 `ledger_line`，最后对三张表 `ANALYZE`（`:80`）。`:45-50` 说明这刻意绕过命令路径。

**P12-1**（`:85-129`）断言：`:88` 总体确为 100000；**`:94-96` `limit:201`→22023、`limit:0`→22023、`offset:-1`→22023**（这是"limit>200 被拒"对 `listGeneralLedger` 的确证）；`:99` limit 200 恰返 200 行；`:102-109` 走 5 页 ×200 且 `new Set(seen).size === seen.length`（无跨页重复）；`:111-114` 重读 offset 400 返回完全相同的 ID 与顺序；`:116-120` 深页（offset ≈ POPULATION-200）返 200 行且与前五页零交集；`:123-128` `getFinancialStatements` 对全总体聚合，`debits === POPULATION/2*10 === credits`，试算平衡收敛到 ≤6 行。

**P12-2**（`:131-163`）：
- **`:134-140` `EXPLAIN (FORMAT JSON)` —— 须精确理解**：它 EXPLAIN 的是一条**手写查询**（`SELECT l.ledger_line_id FROM ledger_line l WHERE tenant_id=$1 AND entity_id=$2 AND period_id=$3 AND account_code='111000' ORDER BY l.ledger_line_id LIMIT 200`），**不是** `refs_list_general_ledger`。该形状由 391 的 `ledger_line_custom_report_scope_idx` 服务。断言为 `assert.match(text,/Index (Scan|Only Scan)/)`。
  **因此不得写"总账读已证明走索引"，只能写"一个限定科目的 `ledger_line` 分页查询已证明走索引"。** 生产总账读的真实排序键 `(journal_date, posted_at, ledger_line_id)` 没有匹配索引（§7），也未被 EXPLAIN。
- `:144-151` 打桩 `runtime.query` 计数，断言单页 200 行的语句数 `<= 6`（"不得每行一次查询"）
- `:154-155` `SELECT count(*) FROM pg_proc WHERE prosrc LIKE '%54000%' > 0` —— 这是**弱存在性检查**，非行为检查
- `:158-162` 十个并发 `listGeneralLedger` 读者（offset 0,50,…,450）返回 500 个互异 ID

**关键限定（已核验）**：`grep 'large-population-performance' package.json` 命中 **0**。**P12 测试未接入 `npm test`、`pretest`、`posttest` 或任何具名脚本**，只能直接调用运行。若声称"CI 里有 10 万行性能测试"，属夸大。此外 Postgres 不可用时它会静默跳过（除非 `config.requirePostgres`，`:28,:43`）。

关于"运行时池保留生产 10s statement_timeout"：属实但是**以省略方式成立**——`:26` 创建运行时池时未覆盖 `statementTimeoutMs`，因此落到配置默认值；而 `:25` 的 admin（灌数）池覆盖为 300000 ms。

## 9. 索引契约测试 —— 是文本正则，不是行为测试

`tests/high-volume-read-indexes-contract.test.mjs`（38 行）对 `383` 的索引定义做 `assert.match` 字面匹配（`:14-18`），断言 down 逐一 drop（`:19`），再对五个读迁移的**文本**断言界值与 ORDER BY（`:22-33`），最后校 manifest 哈希（`:35-38`）。**它从不连接数据库、从不跑 EXPLAIN。** 同样 `grep high-volume-read-indexes package.json` 命中 **0**。

**即：即使这些索引在真实数据库上从未被创建，该测试仍会通过。**

## 10. 缺口清单

1. **五个 HTTP 列表端点返回无界行**，其一（`account-register`）直接读 `ledger_line`（§2）
2. **页界非单一政策**：模态是 100（78 处），200 次之（21 处），另有 500/1000/2000 离群
3. **只有一处 offset 上限**（`109` 的 `p_offset>10000`）。其余 offset 分页读接受任意深 offset；P12-1 `:116` 故意探到 offset ≈99800 并通过——既证明可用也证明无上限。深 OFFSET 在 Postgres 上是 O(n)
4. **无索引服务总账读的真实排序键**；P12 的 EXPLAIN 针对的是另一种查询形状
5. **两个性能相关测试均未接入任何 npm 脚本**
6. **`high-volume-read-indexes-contract` 是 SQL 源文本正则**，非行为测试
7. **全库无任何时延断言**（按明示设计）。无 SLO 门禁
8. `journal_line` 与 `staging_item` 除 PK/UNIQUE 外无显式索引
9. `audit_event` 有时间线索引，但 `correlation_id`/`request_id`/`idempotency_key` 无索引——审计追溯的主要入口未被索引

## 11. 可立即实施（低风险、纯新增）

- 把 `large-population-performance-postgres` 与 `high-volume-read-indexes-contract` 接入 CI 的 PG 阶段（仍不断言时延，只作为容量正确性门禁）
- 为五个无界读各加一个断言"响应有界"的测试——但这需要先**决定**它们的界，属 Owner 决策 D-N38-1

## 12. Owner 决策

- **D-N38-1（优先）无界读限界**。五个端点是否加 `limit`/keyset？这是**破坏性 API 变更**（现有调用方期望全量返回），须逐个决定默认界与是否保留"全量"模式。建议优先级：`account-register` > `source-documents` > `worksheet` > `match-candidates` > `chart-of-accounts`。
- **D-N38-2 页界政策统一**。是否收敛到一个标准上限（建议 200），并把 500/1000/2000 的 AI 读逐个复核？变更会使现有大页调用方收到 22023。
- **D-N38-3 深 offset 上限**。是否对所有 offset 分页读施加 offset 上限（如 10000，对齐 `109`），并引导深翻页改用 keyset。
- **D-N38-4 总账排序键索引**。是否新增 `(tenant_id, entity_id, journal_date, posted_at, ledger_line_id)` 索引以服务总账读的真实 ORDER BY。须先在 staging 以真实数据量评估建索引成本与写放大。
- **D-N38-5** `audit_event` 是否补 `correlation_id`/`request_id`/`idempotency_key` 索引。
- **D-N38-6** 两个性能测试是否接入 CI（若接入，需确认 CI 有可用 PG 且能承受 10 万行灌数时间）。
