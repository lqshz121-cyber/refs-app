# REFS × WBS 只读视图／快照交付请求（V1）

## 目标与边界

REFS 只从 WBS 读取数据；不会写回 BGDATA、MySQL `accounting`、WBS 页面或任务。WBS 的报表行不是 REFS 的过账指令：REFS 会独立保存不可变快照、审计、反转分录和控制总额。`AUTOC` 仅在 **Incur** 事实与已过账 REFS 会计链均可追溯时才能进入会计闭环。

## 建议交付顺序

1. **Sandbox 最小权限视图**（首选）：VPN／IP 白名单内的只读 service account，只授予下列视图的 `SELECT`。
2. **定期签名快照包**（备用）：若视图尚未就绪，每个公司、每个抽取窗口输出一份只读 JSON/CSV 包及 detached Ed25519 签名。
3. 首期历史窗口建议为最近 **12 个已结期间 + 当前开放期间**；更早数据先作为独立回填项目评估质量。
4. 附件不属于首期必需项。若一期不能交付附件，相关 REFS 手工／业务单据仍保持其自身附件门，不以 WBS 报表替代。

## 最小视图与稳定主键

| 逻辑来源 | WBS 交付对象 | 必填稳定键 | 必填范围／事实 |
| --- | --- | --- | --- |
| 应付 | `BGDATA.payable` | `AP_GuId` | company key、币种、金额、状态、付款/清账状态、业务/过账日期、可见 Journal No.（仅 trace） |
| 银行流水 | `BGDATA.bank_transaction` | `CashOrBankBookId`；若缺失则 `RefNo + ComeFrom`，并含 company/account-book scope | 银行账户、日期、金额、币种、方向、`ComeFrom`、Ref No. |
| Auto Payment 明细 | `BGDATA.autoc_detail` | `PD_GuId` | `PB_GuId`、状态、金额、vendor/project/cost/coding、Incur 事实 |
| Auto Bank 控制 | `BGDATA.autoc_bank` | `PB_GuId` | company、银行账户、来源/allocated/released/incurred 控制额 |
| 会计分录 | `accounting.accounting_info` | 不可变行 GuId；若无则由 IT 提供稳定组合键 | company、日期、科目、借/贷、金额、币种、`ComeFrom`、`AUTOC` 关联键 |
| 控制报表 | `accounting.balance_cell`、`accounting.income_cell` | cell／期间／公司稳定键 | period、currency、指标、数值、生成时间 |

`JournalNo`、`BillNo`、显示名称和页面行号不得作为去重、同步或会计关联键；所有关联以 GuId 和明确公司／账户范围为准。

## 抽取一致性与安全

- 不要求 CDC、revision、tombstone 或 replay；REFS 会把每次拉取作为独立 immutable observation。
- 请提供 ETL 时刻表。REFS 避开全量 delete+insert 窗口；若无法保证一致读，请输出完成标记的 **`WBS_READONLY_SNAPSHOT_V2`** 快照包（含 `snapshot_id`、captured_at、dictionary_version、每视图 content hash、`delivery.extract_started_at`／`extract_completed_at`、`consistency=COMPLETE`、`pagination=PRIMARY_KEY_SEEK`）。
- 每页按稳定主键升序；提供固定 page size 与最后主键续传方式，禁止 OFFSET 分页。
- 生产访问只允许 VPN/IP 白名单、TLS、最小权限账号；不得提供公网数据库、表级写权限或共享管理员账号。
- 视图／包不得含 cookie、会话 URL、密码、AK/SK、附件对象路径或可复用访问令牌。

## REFS 验收回执

每次导入 REFS 将返回：source/response hash、retrieval time、公司范围、accepted/quarantined 行数、每行 immutable receipt、Raw→Normalized→Staging trace roots，以及 observed control-total 差异。控制总额仅标记 `OBSERVED`，绝不用于自动平账。

## 请 IT 确认

1. Sandbox 视图交付日期、VPN/IP 白名单流程、只读账号发放方式；若不能，请确认快照包频率与签名公钥。
2. 每个逻辑来源的数据字典、GuId 字段、公司/账户范围字段、币种和金额精度。
3. ETL/重灌时间窗、最近可用历史日期、已知回补或删除语义。
4. `AUTOC` Incur、`PD_GuId`／`PB_GuId` 与会计 `accounting_info` 的可验证关联字段。
