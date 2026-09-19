# N08 — 银行与对账并发缺口

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证 + 一个新增回归钉定测试

## 0. 结论摘要

T10 提出的两个缺陷，在链头 433 的状态是：

| T10 缺陷 | 状态 |
|---|---|
| (a) `bank_source.version` 不递增 | **仍然存在**，且已确证是**死列** |
| (b) 同一银行行进入两表无互斥 | **部分修复**。`bank_source` 与 `bank_match` 两侧都有 DB 级唯一约束；但 `bank_match` × `reconciliation_adjustment_draft` 的互斥是**单向的** |

并且本次发现**一个 T10 未涵盖的实质回归**：**销售收款清算分支在链头被孤立**（§4），已写测试钉定。

## 1. 缺陷 (a)：`bank_source.version` 是死列

列存在：`001_wbs_accounting_core.sql:450` — `version bigint NOT NULL DEFAULT 0 CHECK (version >= 0)`。

**已核验（穷举）：全库 `db/`、`runtime/`、`api/` 中 `UPDATE bank_source SET` 命中数 = 0。** 不存在任何递增它的语句，也无触发器写它（`124:72` 的触发器只消费 `version`，不设置）。四处 `INSERT INTO bank_source`（`091:148`、`175:184`、`185:253`、`276:188`）均不提供 `version`，故所有行恒为 `0`。

**讽刺之处：乐观并发检查确实被执行了，只是永远只能匹配 `0`。** 四条命令读它并在不符时抛 **40001**：

| 命令 | 位置 |
|---|---|
| `refs_create_bank_payment_match` | `323:63` |
| `refs_create_sales_receipt_bank_match` | `321:34` |
| `refs_set_reconciliation_clearance` | `403:38` |
| `refs_set_reconciliation_adjustment_clearance` | `067:217` |

HTTP 侧把它当 If-Match 传递：`accounting-http.mjs:3301`、`:3309`（`expectedBankVersion: requireRevision(headers)`）、`:3372`、`:3378`。

佐证：**全库每一个测试都传 `expectedBankVersion: 0`**（`postgres-kernel.test.mjs:1920, 2003, 5356, 5368, 5370, 5441, 5470, 5547, 5673, 5765, 5781, 5862, 5876, 7394, 7396, 7398, 7646, 7677, 7679`）。**没有任何测试能发现这个死列，因为没有任何测试能构造出非零值。**

**该路径上真正起保护作用的是行锁（`FOR UPDATE`）与咨询锁，不是 version。** 所以这不是一个开放的并发漏洞，而是一个**失效的纵深防御层 + 一个误导性的 API 契约**（客户端被要求提供一个毫无意义的 If-Match）。

## 2. 缺陷 (b)：互斥的实际覆盖

### 2.1 已实现的部分

`bank_source` 侧：`001:451` `UNIQUE (tenant_id, entity_id, bank_account_ref, external_bank_line_id)`。由 `bank-to-book-tie-postgres.test.mjs:59-63`（P03-1）以 `23505` 断言。

`bank_match` 侧 —— **五个偏唯一索引，覆盖所有路径**：

| 索引 | 位置 | 含义 |
|---|---|---|
| `bank_match_one_active_bank_line_uq` | `001:478-479` | 一条银行行至多一个 ACTIVE 匹配 |
| `bank_match_one_active_business_source_uq` | `001:480-482` | |
| `bank_match_one_active_journal_line_uq` | `001:483-485` | |
| `bank_match_one_active_payment_occurrence_uq` | `061:24-26` | |
| `bank_match_one_active_sales_receipt_uq` | `320:9-10` | |

两个写入方另有事务内预检：`323:65-69`、`321:41-44`，抛 **23505**。`match_status` 枚举为 `('ACTIVE','UNMATCHED','REVERSED')`（`001:19`），偏索引覆盖唯一的"活"态。

**结论：一条银行行不能被匹配两次；一笔付款/收款不能匹配两条银行行。这部分 T10 已修复。**

### 2.2 仍未覆盖的一对：`bank_match`(ACTIVE) × `reconciliation_adjustment_draft`

**互斥是单向的（已核验）：**

- **草稿侧会检查匹配侧**：`067:100-105` —— 若该 bank source 已有 CLEARED 的 `reconciliation_item`、ACTIVE 的 `bank_match`、或在先的草稿，则抛 `'Statement bank source already has reconciliation treatment'` **23514**（`067:104`）
- **匹配侧不回查草稿侧**：已核验 `321`、`323`、`061` 三个文件中 `reconciliation_adjustment_draft` 命中数**均为 0**

**后果**：按"先建调整草稿，再建银行匹配"的顺序，同一条银行行会被消费两次——一次作为调整草稿/`reconciliation_item`（`bank_match_id IS NULL`），一次作为 ACTIVE `bank_match`。

**签核也不会捕获它**：`400:193` 的调整证据分支以 `i.bank_match_id IS NULL` 为门，因此那条游离的 ACTIVE 匹配从不被签核校验器检视。

**这是逻辑缺口而非锁竞争**：草稿创建取 `bank_source ... FOR SHARE`（`067:93-94`），匹配创建取 `FOR UPDATE`（`323:53`），两者确实在行上串行化——第二个只是没有规则可以失败。

**无任何测试覆盖任一方向**：`grep 'reconciliation treatment' tests/` 无命中；`grep 'already has an active match' tests/` 无命中。

## 3. 并发保护的实际构成

| 机制 | 位置 |
|---|---|
| 账户级咨询锁 `pg_advisory_xact_lock(hashtextextended(tenant:entity:bank_account_ref))` | `323:39`（建匹配）、`323:164`（解匹配）、`321:28`、`400:156`（复核/签核/重开） |
| `reconciliation ... FOR UPDATE` | `403:30`、`400:153`、`067:85`、`067:212` |
| `bank_source ... FOR UPDATE` | `323:53`、`323:159`、`321:31`、`403:34`；`FOR SHARE` `067:93` |
| 一账户至多一个开放工作底稿 | `063:56-58` `reconciliation_one_open_account_uq`（partial，`DRAFT/IN_REVIEW/REOPENED`） |
| 运行时重试 | SERIALIZABLE + 最多 7 次 40001/40P01 重试（`runtime/db.mjs:47-58`） |

`323:37-38`、`321:26-27` 的注释明确记录了**锁序规则**：签核先取 reconciliation 行锁，匹配方不得在咨询锁之后再取 reconciliation 行锁。

**两个未取咨询锁的命令**：`refs_set_reconciliation_clearance`（403）与 `refs_set_reconciliation_adjustment_clearance`（067）只依赖行锁。

**`FOR UPDATE ... SKIP LOCKED` 在银行/对账路径上不存在**（全部 SKIP LOCKED 用于 outbox/附件/循环调度：`002:1378`、`003:91`、`279:30`、`299:94`、`390:72`、`398:18`、`415:11`、`424:23`）。

## 4. 新发现：销售收款清算分支被孤立（实质回归）

**这是本项最重要的发现，已逐行核验并写测试钉定。**

`refs_set_reconciliation_clearance` 的定义链：

| 迁移 | 动作 |
|---|---|
| 385 | 把当时的实体改名为 `_385`，新建薄包装器调用它 |
| **400** | `CREATE OR REPLACE` **`_385` 的实体**，教会它同时接受 `EXACT_POSTED_PAYMENT`（`400:60`）**与 `EXACT_POSTED_SALES_RECEIPT`（`400:71`）** |
| **403** | `CREATE OR REPLACE` **包装器本身**，改为**完全内联的实体**，只接受 `m.candidate_rule_code='EXACT_POSTED_PAYMENT'`（`403:53`）。**包装器不再委派，400 的销售收款分支就此不可达** |
| 418 | 把 403 的实体改名为 `_418` 并重新包装（`418:41-50`）。孤立状态延续 |

已核验：`403` 与 `418` 中 `EXACT_POSTED_SALES_RECEIPT` 命中数**均为 0**；全库只有 `321` 与 `400` 提及该规则码。

**同时，400 安装的签核校验器仍然接受 `EXACT_POSTED_SALES_RECEIPT`**（`400:176`），而签核要求 `total_items = cleared_items`（`400:260,269`）。

**因此的可观察后果**：一条由 `321` 匹配到销售收款的银行行，
1. 可以被成功匹配（321 正常工作）
2. 会被签核的证据规则视为合法（`400:176`）
3. **但无法被清算** —— `403:69` 抛 `'Only exact actively matched bank evidence can be cleared'`（23514）
4. 而签核要求每一条项目都已清算 → **该对账单永远无法完成签核**

**钉定测试**：新增 `tests/reconciliation-clearance-sales-receipt-regression.test.mjs`，4/4 通过。它按 `ap-lifecycle` R03-5 的"钉住缺口而非假定已实现"范式书写——若有人修复孤立（或移除销售收款匹配路径），断言会失败并强制有意识地更新钉定。

**本会话未修复它**：修复需要在 403/418 的实体中恢复销售收款分支，属前向迁移，会改变一个已发布命令的接受面，需 Owner 决策（D-N08-1）。

## 5. 匹配、签核、重开

### 匹配
三个写入方：`refs_create_bank_payment_match`（`323:3`，`BANK.MATCH.CREATE`）、`refs_create_sales_receipt_bank_match`（`321:7`，同权限）、`refs_unmatch_bank_payment`（`323:127`，`BANK.MATCH.UNMATCH`）。

冲突码 **23505** → HTTP **409**。其余拒绝：`40001`（版本）、`23514`（已签核封锁、金额/币种/日期不符、>31 天窗口、现金行歧义）、`P0002`、`22023`、`42501`。

反向互锁：触发器 `business_adjustment_active_bank_match_guard`（`061:44-46`）在存在 ACTIVE 匹配时拒绝 AP/AR 冲销草稿（23514）。

### 签核锁定
头部实现 `refs_transition_reconciliation_adjustment_aware` → `_418`（`418:56-66`）→ `_385` 实体在 `400:125-310`。

- 权限按动作：`BANK.RECONCILIATION.REVIEW` / `.SIGN_OFF` / `.REOPEN`（`400:135-137`）
- 签核门（`400:268-271`）：须 `IN_REVIEW`、对账单=账面、对账单=期初+已清算发生额、`scoped_bank_items>0`、无外币项、`total_items=scoped_bank_items=cleared_items`、`invalid_evidence=0`，否则 **23514**
- **SoD**（`400:272`）：`reviewed_by=actor` → `'Reviewer cannot sign off the same reconciliation'` **42501**
- 成功后写不可变 `reconciliation_snapshot`（`400:273-281`）

**签核后防改动的三层**：
1. 应用层：`323:57-60`、`323:170-173`、`321:35-38` → 23514
2. DB 触发器 `bank_match_signed_reconciliation_guard`（`063:91-93`）→ 23514。**注意它是 `BEFORE UPDATE OF status ON bank_match`，不在 INSERT 上触发** —— 签核后新建匹配的阻断**仅靠应用层，无 DB 后盾**
3. 清算封闭：`403:33`、`067:215` → 23514

### 受控重开
无独立 `refs_reopen_reconciliation`；重开是转换函数的 `REOPEN` 动作（`400:282-294`）。权限 `BANK.RECONCILIATION.REOPEN`（`063:8`，`BANK`/**CRITICAL**/`BANK_RECONCILIATION_REOPENER`）。

前置：须 `RECONCILED`（`400:283`）；**SoD** `reconciled_by=actor` → `'Signer cannot reopen the same reconciliation'` **42501**（`400:284`）；只有该账户最新的已签核对账单可重开（`400:285-289`）；账户上不得有其他开放对账单（`400:290-292`）。

WBS 准入对账单另有更强 SoD：触发器 `signed_reconciliation_lifecycle_sod_guard`（`098:65-67`）要求 actor 不得是发起人、任何清算/反清算人、任何匹配/解匹配人、调整草稿创建人、复核人（RECONCILED/REOPENED）、签核人（REOPENED）→ 42501。

## 6. 审计事件

| event_type | 位置 |
|---|---|
| `BANK_PAYMENT_MATCH_CREATED` / `_UNMATCHED` | `323:112-115` / `323:183-186` |
| `SALES_RECEIPT_BANK_MATCH_CREATED` | `321` |
| `RECONCILIATION_STARTED` | `063`、`092` |
| `RECONCILIATION_ITEM_CLEARED` / `_UNCLEARED` | `403:100-105` |
| `RECONCILIATION_ADJUSTMENT_ITEM_CLEARED` / `_UNCLEARED` | `067:262-264` |
| `RECONCILIATION_ADJUSTMENT_DRAFT_CREATED` | `067:161-165` |
| `RECONCILIATION_REVIEW` / `_SIGN_OFF` / `_REOPEN` | `400:296-300` |

全部配对 `outbox_event`，含 `before_hash`/`after_hash` 与强制 8–2000 字符 `reason`。

## 7. 测试覆盖与其准确边界

### 真正的并发测试（存在且质量高）
- **`postgres-kernel.test.mjs:7627-7728`** `exerciseReconciliationRace(forceRetry)`，两个命名测试在 `:7729`/`:7730`。真双连接竞态：把签核者暂停在持有账户咨询锁的状态（`:7659-7662`），再启动 `unmatchBankPayment`，并**轮询 `pg_stat_activity` 确认后者确实阻塞在 advisory 锁上**（`:7692-7695`）。断言恰一方提交、失败方零幂等收据、零审计/outbox、`ledgerHash()` 前后一致
- **`postgres-kernel.test.mjs:5337-5413`** 同类竞态 + 完整生命周期门禁（复核者不得签核 42501；乱序重开两次被拒；重开后解匹配成功）
- **`postgres-kernel.test.mjs:5533-5540`** 两个并发 `startReconciliation` → 恰一个成功，另一个 `23505`
- **`postgres-kernel.test.mjs:7320-7325`** 同幂等键并发销售收款匹配 → `[200,201]` 同一 `bank_match_id`；异 actor 重放 → 403

### `bank-to-book-tie-postgres.test.mjs` 的准确范围
三个用例**全部严格串行，无任何并发**；夹具经 admin 池直写 `bank_source`，绕过内核。P03-1 测的是表级唯一约束；P03-2 测账面—对账单对平与反向追溯，并断言已存储的 `book_ending_balance` 在新增分录后**不变**（测试自陈"重新复核才会重算"）；P03-3 测未绑定已过账证据时复核被拒 23514。

**不得引用本文件来支撑**：并发、锁、`bank_source.version`、匹配互斥、或签核行为。它自己的测试名就声明了"锁/签核/重开路径由 postgres-kernel 'reconciliation lifecycle' 覆盖"。

### 可positively陈述的覆盖缺口
- 无测试并发竞争同一银行行的**两个匹配创建**
- 无测试让匹配创建与清算竞争
- 无测试覆盖 `067:104` 的跨表互斥（任一方向）
- 无测试能发现死掉的 `bank_source.version`（全部传 0）

## 8. 缺口清单

1. **`bank_source.version` 是死列**：无写入方，乐观并发检查恒对 0 成立，API 要求客户端提供一个无意义的 If-Match
2. **`bank_match` × `reconciliation_adjustment_draft` 互斥单向**：匹配侧不回查草稿侧，且签核校验器因 `bank_match_id IS NULL` 门而看不见游离匹配
3. **销售收款清算分支被孤立**（§4）——可匹配、签核规则认可、但无法清算，导致整张对账单无法签核
4. `bank_match_signed_reconciliation_guard` 只在 `UPDATE OF status` 触发，**不在 INSERT** —— 签核后新建匹配无 DB 后盾
5. 403/067 两个清算命令不取账户咨询锁
6. 应用层抛出的 `40001`"version conflict"会被运行时重试 7 次后才呈现为 412 —— 浪费往返，非正确性问题

## 9. Owner 决策

- **D-N08-1（优先）销售收款清算孤立**。这是一个**可观察的功能中断**：用了销售收款银行匹配的对账单无法签核。三选一：(a) 在 403/418 实体中恢复销售收款分支（前向迁移 + 真库回归）；(b) 若销售收款匹配路径本就不应启用，则移除 `321` 的匹配能力，使两侧一致；(c) 明确接受并记录为已知限制。**需先确认生产/staging 中是否已有 `EXACT_POSTED_SALES_RECEIPT` 匹配存量——本会话不查真实账。**
- **D-N08-2 `bank_source.version` 的去留**。(a) 让它真正递增（需确定哪些操作算"银行行变更"）；(b) 移除该列与对应的 If-Match 契约，避免误导；(c) 保留现状并在 API 文档标注"该值恒为 0"。
- **D-N08-3 跨表互斥补齐**：是否在 `321`/`323` 中增加对 `reconciliation_adjustment_draft` 的回查，使互斥双向。属前向迁移，会让当前可成功的"先草稿后匹配"序列开始失败——**需先评估存量是否已有这种双重消费**。
- **D-N08-4** 是否为 `bank_match` 的 INSERT 补 DB 级签核后阻断触发器（当前仅应用层）。
- **D-N08-5** 是否为上述四个覆盖缺口补真库测试。
