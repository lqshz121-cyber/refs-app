# S34 — staging 会计 E2E（隔离测试 tenant）

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · commit e4c72c23

## 0. 执行环境与边界声明

- **未使用任何生产账、未连接任何 staging 或生产数据库。**
- 每次运行都在**全新的临时 PostgreSQL 16 实例**上进行：`initdb` → 建库 `refs_kernel_test` → 建平台角色（`refs_app`/`refs_migrator`/`refs_runtime`/`refs_context_issuer`/`refs_grant_sync`）→ `migrateUp` 全链 439 个迁移 → 跑测试 → **实例与数据目录在进程退出时销毁**。
- 每个测试文件独占一个实例（端口 55432，数据目录 `/tmp/pgdata_embed_$$`），文件之间无状态残留。
- tenant / entity / actor 全部为测试内生成的随机 UUID，与任何真实公司无关。

## 1. 执行结果总表（全部实跑，非静态断言）

| 面 | 测试文件 | 通过/总数 |
|---|---|---|
| JE 全生命周期 + SoD + 期间控制 | `tests/e2e-scenarios-p15.test.mjs` | **15 / 15** |
| 过账 SoD 与 actor 绑定 | `tests/posting-sod-contract-postgres.test.mjs` | **7 / 7** |
| AP 生命周期状态机 | `tests/ap-lifecycle-state-machine-postgres.test.mjs` | **5 / 5** |
| AR 生命周期状态机 | `tests/ar-lifecycle-state-machine-postgres.test.mjs` | **5 / 5** |
| 银行—账面对平与对账 | `tests/bank-to-book-tie-postgres.test.mjs` | **3 / 3** |
| 报表反向追溯（报表→台账→分录→证据） | `tests/report-ledger-reverse-trace-postgres.test.mjs` | **3 / 3** |
| 证据→报表分阶段追溯 | `tests/evidence-to-report-stage-trace-postgres.test.mjs` | **3 / 3** |
| 仅 POSTED 投影与诚实空态 | `tests/report-posted-only-projection-postgres.test.mjs` | **2 / 2** |
| 关闭期间写入矩阵 | `tests/closed-period-write-matrix-postgres.test.mjs` | **3 / 3** |
| **合计** | **9 个文件** | **46 / 46，0 失败，0 跳过** |

## 2. 逐面证据要点

### 2.1 JE（15/15）
Draft→Submit→Review→Approve→Post 全链在隔离 tenant 上跑通；SoD 违规（同一 actor 同时持 `GL.JE.CREATE` 与 `GL.JE.REVIEW` 权威类）以 **42501** 拒绝；关闭期间以 **55000** 拒绝；冲销经 `refs_create_journal_adjustment(REVERSAL)` 走同一四眼链；手工分录的附件证据门禁被实际触发（`23503`）。

### 2.2 过账 SoD（7/7）
- 正路径：独立 poster 过账一次，**ledger / batch / audit / outbox 各恰写一次**
- maker、reviewer、approver **分别**作为 poster 均被 42501 拒绝且**零写入**
- **会话 GUC 声明不是权威来源**：手工设置 `refs.*` claim 在任何写入前即被 42501 拒绝
- 跨租户 claim 无法过账进本租户；claim 集合外的实体被拒
- CLOSED 期间过账 55000，且**不留 receipt、不留 ledger 行**
- 幂等：同键重放返回同一结果、不产生第二个 batch；同键不同请求 **23505**

### 2.3 AP（5/5）
`OPEN → PARTIALLY_PAID → PAID → PARTIALLY_PAID` 状态走位与 **AP 账龄、两个控制合计、291001 三者同步**；单笔付款全额冲销使账单回到 **OPEN 而非 APPROVED**；已过账未核销的供应商贷项被账龄与实体控制合计冲抵但**不**被期间控制溯源冲抵；`PENDING_POST` 状态无写入方且恰三个读者排除它；**AP 核销注销（write-off）确认为未实现——被钉为缺口而非假定存在**。

### 2.4 AR（5/5）
AR 状态走位与账龄、两个控制合计、120200 同步；**AR 发票无 void 也无 cancel 对象**，因此 `AR_INVOICE` 永远无法到达 VOID（而 AP 账单可以）；已过账销售收款无 void/cancel/refund 对象，其状态不因自身分录冲销而改变；**AR 退款是终态**——无冲销或 void 对象消费已过账退款（而 AP 付款与 AR 收款有）。

### 2.5 银行 / 对账（3/3）
同一外部银行行不能对同一账户二次进入 `bank_source`；**银行—账面对平**：账面余额 = 截至对账单日该银行成员的 POSTED 台账，差额 = 对账单 − 账面，且可反向追溯到确切分录；**复核在每一条对账单行都绑定到确切已过账证据之前被拒绝**。

### 2.6 报表追溯（3+3+2 = 8/8）
- 每个试算平衡行都能**从它所引用的 `ledger_line` id 精确重算**，且每条引用行都属该期间的 POSTED 分录
- BS 与 IS 是同一批台账行的重新分节，**不出现 TB 未引用的行**
- 报表行 → `ledger_line` → `journal_entry` → `source_link` → **已验证附件**，且分页总账引用同一行
- 阶段 0：未导入实体为 `NO_EVIDENCE_IMPORTED`，报表不引用任何台账行
- 阶段 1：raw → 来源单据 → staging → **DRAFT 分录**为 `EVIDENCE_WITHOUT_POSTINGS`，对任何报表与总账**零贡献**
- 阶段 2：经内核过账后，每个报表行都能回溯到**确切的原始 WBS 事件与金额**
- TB/BS/IS/CF 与总账**全部只投影 POSTED 台账**且彼此对平；空实体返回 `[]` 而非伪造零行

### 2.7 期间控制矩阵（3/3）
CLOSED 与 SOFT_CLOSED 期间下，**每一个写入族**都以期间/前置条件 SQLSTATE 被拒绝且**不产生任何会计行**；同一批 actor、同一张分录草稿在 OPEN 期间被接受——**证明上述拒绝确由期间状态单独造成**，而非权限或数据问题。

## 3. 本项不能证明什么（诚实边界）

按任务书"不得以页面能打开或健康检查通过替代业务验收"，明确声明：

1. **这不是 staging 环境的验收。** 上述全部在本会话的临时 PG 实例上执行。它证明的是**内核在链头 433 上的行为正确**，不证明任何已部署环境的状态。
2. **未使用真实公司数据。** 因此不构成对任何真实公司账务的验收。
3. **未覆盖 HTTP 层与前端。** 上述均为内核/SQL 层真库测试；HTTP 契约测试多为 stub kernel（见 N18/N19/N23 各文"测试性质"节）。
4. **未覆盖合并与抵销**——这两者全库无真 PG 测试（见 N23 §10），是已知保证缺口。
5. 46 项全绿**不等于**生产就绪。生产就绪需 S37 的 GO/NO-GO 包与 Owner 授权。

## 4. 复现命令

```
# 每个文件独占一个临时 PG16 实例，退出即销毁
TT=480 bash /tmp/onefile-gw.sh tests/e2e-scenarios-p15.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/posting-sod-contract-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/ap-lifecycle-state-machine-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/ar-lifecycle-state-machine-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/bank-to-book-tie-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/report-ledger-reverse-trace-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/evidence-to-report-stage-trace-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/report-posted-only-projection-postgres.test.mjs
TT=480 bash /tmp/onefile-gw.sh tests/closed-period-write-matrix-postgres.test.mjs
```

退出码全部 0；各文件 TAP 汇总均为 `# fail 0`、`# skipped 0`。

## 5. Owner 决策

- **D-S34-1** 是否要求在**真实 staging 环境**（而非临时实例）上重跑本矩阵作为发布前门禁？若是，需要 staging 的隔离测试 tenant、六个互异 actor 的角色授予（同 D-O02-2），以及确认这些写入不会污染 staging 的真实导入数据。**本会话不自授权限、不写 staging。**
- **D-S34-2** AP write-off（`ap-lifecycle` R03-5 钉住的缺口）与 AR 的 void/cancel 缺失（R04-2/3/4）是否进入路线图。当前一笔开错的 AR 发票没有干净的撤销路径。
