# N06 — SOFT_CLOSED 期间语义收口

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 0. 与既有 R09 工件的关系

本项与 R09（`docs/PERIOD-STATUS-SOFT-CLOSED-CONTRACT.md`、`server/runtime/period-status-contract.mjs`、`server/tests/period-status-contract.test.mjs`）**高度重叠**。R09 的结论与本次独立复核一致，但其证据基线是**迁移 001..425**，而当前链头是 **433**；本文在 433 上重新核验，并补两点 R09 未覆盖的内容：**SOFT_CLOSED 的终局性**与**测试未接线**。

## 1. 结论（一句话）

**SOFT_CLOSED 是一个声明了但无法到达、且一旦到达就无法离开的状态。** 它在写入面上与 CLOSED 完全等价；唯一的实质差异出现在三个不构成门禁的地方（设置快照的 soft_lock/hard_lock 标签、AI 切期风险分级、以及重开路径——而重开恰恰**拒绝** SOFT_CLOSED，使它比 CLOSED 更糟）。

## 2. 它是 ENUM，不是 CHECK（措辞纠正）

```sql
-- 001_wbs_accounting_core.sql:6
CREATE TYPE period_status AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED');
```

已核验：全库 `ALTER TYPE period_status` 命中 **0**，故链头允许值恰为这三个。表定义 `001:45-62`，含 `version bigint DEFAULT 0`、`closed_by`、`closed_at`，以及 `CHECK ((status='OPEN' AND closed_at IS NULL) OR status<>'OPEN')`。

**注意该 CHECK 的弱点**：它只约束 OPEN 必须无 `closed_at`，反向不约束——因此一行 `SOFT_CLOSED` 且 `closed_by IS NULL, closed_at IS NULL` 是**可存储的**。这正是 `closed-period-write-matrix-postgres.test.mjs` 夹具所构造的形态。

## 3. 没有任何命令能写入 SOFT_CLOSED（已核验）

全库 439 个迁移中，`UPDATE accounting_period` 只有 **3** 处：

| 位置 | 写入 |
|---|---|
| `002_accounting_runtime.sql:1199`（legacy `refs_close_period`，已 revoke） | `status='CLOSED'` |
| `289_period_close_readiness.sql:99`（`refs_close_period_v2`） | `status='CLOSED'` |
| `293_period_reopen_control.sql:92`（`refs_reopen_period_v1`） | `status='OPEN'` |

另 `INSERT INTO accounting_period` 在迁移中只有 `179:27-28`，写入 `'OPEN'`。

**因此：无 `GL.PERIOD.SOFT_CLOSE` 权限（权限目录只有 `GL.PERIOD.CLOSE` 与 `GL.PERIOD.REOPEN`）、无软关闭命令、无软关闭 HTTP 路由。SOFT_CLOSED 只能由具备直接 DB 写权的人手工 UPDATE 产生。**

## 4. 写入面：与 CLOSED 完全等价

全部期间守卫都写成 `status='OPEN'`（正向选择，148 处）或 `status<>'OPEN'`（36 处）。**不存在任何 SQL 守卫把 SOFT_CLOSED 列为许可状态。**

代表性守卫：

| 位置 | 谓词 |
|---|---|
| `002:1025-1027`（`refs_create_manual_journal`） | `... AND status='OPEN' AND journal_date BETWEEN ...` → 未命中即 **55000** |
| `002:1233`（过账） | `IF period_row.status<>'OPEN' THEN RAISE 'Period is not open' 55000` |
| `289:92`（`refs_close_period_v2`） | `IF v_period.status<>'OPEN' THEN 55000` |
| `289:16/23`（就绪读） | 非 OPEN → blocker `PERIOD_NOT_OPEN` |
| `048:68-70`（AP/AR 原生单据） | `status='OPEN'` → 55000 |
| `355:260`/`359:188`/`360:67`（固定资产） | `status<>'OPEN'` → `BLOCKED_PERIOD_NOT_OPEN` |
| `374:871,903`；`422:30,62`（会计设置） | `IF p.status<>'OPEN'` |
| `384:51`（合并配置） | `period_row.status<>'OPEN'` |

另有约 25 处 `55000`「…must be OPEN…」站点（005/007/011/013/015/017/020/022/043/044/067/094/096/139/151/152/156/168/175/185/186/275/276/305/311）。

前端同理：所有 UI 门禁都是 `period_status === 'OPEN'` / `!== 'OPEN'`（`src/native-document-entry.js:34,52`、`src/authoritative-workspace.jsx:57,208,209`、`src/period-control.js:58` 等）。

## 5. 三处实质差异（均不构成门禁）

### 5.1 设置快照的 soft_lock / hard_lock 标签
`251:130`、`374:207,465,680` 断言快照中 `settings.period_status` 与锁标志的对应：

| period_status | allow_post | posting_lock | hard_lock | soft_lock |
|---|---|---|---|---|
| OPEN | true | false | false | false |
| **SOFT_CLOSED** | **false** | **true** | **false** | **true** |
| **CLOSED** | **false** | **true** | **true** | **false** |

**关键：`allow_post` 与 `posting_lock` 对 SOFT_CLOSED 与 CLOSED 完全相同**；只有 `soft_lock`/`hard_lock` 两个标签不同，**而内核没有任何地方把这两个布尔当作门禁消费**——它们被校验，不被执行。

### 5.2 保留证据的单调性
`374:207`（及 465、680）：SOFT_CLOSED 期间可保留 OPEN 或 SOFT_CLOSED 时批准的快照；CLOSED 期间三者皆可。这是陈旧性/单调性规则，**不授予任何过账能力**。

### 5.3 AI 切期风险分级
`runtime/ai-ap-invoice-cutoff-review.mjs:19-20`：落在 SOFT_CLOSED 期间的 AP 发票产出 MEDIUM/0.92 的切期发现，CLOSED 产出 HIGH/0.99。**这是咨询性风险评分，不是门禁。** HTTP 侧 `accounting-http.mjs:167` 把它固化为响应契约断言。

## 6. SOFT_CLOSED 是终局状态（R09 未突出的一点）

`refs_reopen_period_v1` — `293:54-55`：

```sql
IF v_period.status<>'CLOSED' OR v_period.closed_by IS NULL OR v_period.closed_at IS NULL THEN
  RAISE EXCEPTION 'Only a retained CLOSED period can be reopened' USING ERRCODE='55000';
```

第一个析取项单独就拒绝了 SOFT_CLOSED —— **即使它带着 `closed_by`/`closed_at` 也无法重开**。

因此一个 SOFT_CLOSED 期间：不能被写入（§4）、不能被关闭（`289:92` 要求 OPEN）、不能被重开（`293:54`）。**它在系统中是死局，只能靠直接 DB UPDATE 脱困——而那属于改账。**

UI 与之一致：`src/authoritative-period-close-workspace.jsx:18` 只在 `period_status==='CLOSED'` 时渲染「独立期间重开」区块，**SOFT_CLOSED 期间连重开入口都不显示**。

## 7. 重开路径（对照：CLOSED 的完整出口）

`refs_reopen_period_v1`（`293:26-112`）证据绑定极严：作用域 `GL.PERIOD.REOPEN`（`:37`）→ 参数校验（`:39-42`）→ 规范请求哈希（`:43-48`，22023）→ 幂等预留 scope `REOPEN_PERIOD:<entity>`（`:49`）→ 状态门（`:54-55`，55000）→ `version` CAS（`:56`，40001）→ **最新关闭证据钉定**（`:58-68`，要求具名 `PERIOD_CLOSED_V2` 审计事件且为最新，40001）→ 保留完整性校验（`:70-86`，要求 `permission_used='GL.PERIOD.CLOSE'`、`actor_id=period.closed_by`、`after_hash=expected_readiness_hash`、恰 17 个 metadata 键、恰一条匹配 outbox 行，23514）→ **SoD**（`:88-89`：`'The period closer cannot reopen the same retained close'`，42501）→ 写回 OPEN（`:92-93`）→ 审计 + outbox（`:94-109`）。

关闭侧 `refs_close_period_v2`（`289:71`）用 `GL.PERIOD.CLOSE`（`:80`），**函数内无异人检查**——关闭不是四眼，重开才是。两个权限风险等级均为 `CRITICAL`（`002:358`、`293:3-6`）。

## 8. 读面与 UI 可辨识性

状态被暴露：`289:57` 把 `period_status` 放进关闭就绪载荷；authoritative scope 读也返回它（`postgres-kernel.test.mjs:1163-1178` 设为 SOFT_CLOSED 并断言读回原值）。

**用户能否区分 SOFT_CLOSED 与 CLOSED？能，但只是原始字符串，无任何样式或标签映射：**
- `src/authoritative-period-close-workspace.jsx:16` 直接渲染字面量
- `src/authoritative-accounting-settings-workspace.jsx:28` 用**同一个 danger 色调**提示 `The target period is {period_status}`
- `src/period-control.js:75-78` `periodStatusLabel` 直接 `String(period.status)`，无映射表

**已核验：任何 `.jsx` 文件中都不含 `SOFT_CLOSED` 字面量**，无徽章/色调/i18n 区分。

## 9. 测试覆盖与其准确边界

### `closed-period-write-matrix-postgres.test.mjs`
测试体是 `for(const status of ['CLOSED','SOFT_CLOSED'])` 的**同一段循环**（`:46`），对两者跑完全相同的断言——本身就是"二者等价"的证据。每种状态尝试 `manual_journal`、`ap_bill`、`ar_invoice`、`wbs_test_retain`、`post_open_draft_under_closed_period` 五个写入族。

**引用时必须精确**：它断言 `code !== 'ACCEPTED'` 且 `PERIOD_CODES.has(code) || /PERIOD|CLOSED/.test(code)`，其中 `PERIOD_CODES = {55000, 23514, 22023, P0001, P0002}`（`:44`）。**它不断言具体是 55000，也不断言 SOFT_CLOSED 的 SQLSTATE 等于 CLOSED 的。** 它覆盖的是"SOFT_CLOSED 与 CLOSED 一样阻断写入"，**不覆盖**转换矩阵。

最紧的单点断言在别处：`postgres-kernel.test.mjs:1678-1679` 把期间设为 SOFT_CLOSED 后 `createWbsPayableApDraft` 以 **55000** 拒绝；`:3965-3970` 走 HTTP，SOFT_CLOSED 下新建 AP/AR 单据返回 **HTTP 423** 且不落行。

### `period-status-contract.test.mjs`（R09，静态）
七个测试，全部是对迁移 SQL 的文本分析加 `runtime/period-status-contract.mjs` 的钉定常量。**引用注意**：其最后一个测试断言的是**硬编码常量** `PERIOD_STATUS_OPERATION_MATRIX`，该常量自身的注释说明它记录的是"live PG16, migrations 001..425, synthetic tenant"的一次观测。**应引用为"仓库钉定的契约/漂移告警"，不可引用为"一个执行该矩阵的测试"。**

### 已核验的接线缺口
`grep -c 'period-status-contract' package.json` = **0** —— 该契约测试**未接入任何 npm 脚本**，因此 SOFT_CLOSED 语义的漂移告警实际上不会在 CI 中触发。

## 10. 缺口清单

1. **SOFT_CLOSED 不可达**：无命令、无权限、无路由可产生它
2. **SOFT_CLOSED 不可逃逸**：不能写入、不能关闭、不能重开——死局
3. **语义为空**：soft_lock/hard_lock 标签被校验但无消费方；唯一真实差异是一个 AI 风险评分
4. **UI 不区分**：同色调、同措辞，只有原始字符串不同
5. **`period-status-contract.test.mjs` 未接入 CI**，漂移告警形同虚设
6. 表级 CHECK 允许 `SOFT_CLOSED` 带空 `closed_by/closed_at`，即无关闭证据的"软关闭"是可存储的

## 11. 可立即实施（零风险）

把 `tests/period-status-contract.test.mjs` 接入 `posttest`——纯新增接线，不改任何运行时行为，使第 5 项缺口关闭。（需 Owner 批准 D-N06-3。）

## 12. Owner 决策

- **D-N06-1（首要）SOFT_CLOSED 的去留**。三选一：
  **(a) 移除** —— 从 ENUM 中删除（需前向迁移 + 确认无存量行）。理由：当前它是一个不可达、不可逃逸、无语义的状态，留着只会误导读 schema 的人。
  **(b) 实现** —— 补 `GL.PERIOD.SOFT_CLOSE` 权限、软关闭命令、以及**真正区别于 CLOSED 的写入规则**（例如允许调整分录但禁止新业务单据）。这需要 Owner 先给出业务定义："软关闭期间到底允许做什么？"——代码中没有任何依据可供推断，我不会代为设计。
  **(c) 保留为纯文档状态** —— 明确记录它只能由 DBA 手工设置、且是终局，并在 UI 上以不同色调标注。
  **在此决策前，任何把 SOFT_CLOSED 当作"可用的软关账"来验收的行为都是错的。**
- **D-N06-2** 若选 (b)/(c)，是否需要一条从 SOFT_CLOSED 出去的受控路径（当前是死局）。
- **D-N06-3** 是否批准把 `period-status-contract.test.mjs` 接入 posttest（零风险）。
- **D-N06-4** 关闭（`refs_close_period_v2`）无异人检查而重开有，是否为有意不对称。
