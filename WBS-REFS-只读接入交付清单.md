# WBS → REFS 只读数据接入交付清单

日期：2026-08-03  
目的：REFS 只读取 WBS 财务数据，在 REFS 内建立不可变 receipt、账务、审计与双向 trace；**绝不反向写入 WBS**。

## 优先方案：WBS MCP

已知 MCP 地址：`https://db-mcp.wbm3.com/mcp`。REFS 已验证 HTTPS 可达，但当前 `initialize` 返回 `401`，因此尚未读取数据。

请提供以下任一可用认证方式，并书面确认仅允许只读工具：

1. Cloudflare Access service token：`CF-Access-Client-Id` 与 `CF-Access-Client-Secret`；或
2. OAuth 登录流程：授权地址、token 颁发方式、client registration/redirect URI 要求、scope；或
3. VPN/IP 白名单与 MCP 服务账号认证头格式。

MCP 工具必须满足：

- 仅暴露固定视图读取工具，不接受任意 SQL、存储过程或写命令；
- 每个工具声明 `readOnlyHint: true`；
- 返回 `captured_at`、视图/导出版本、记录数、内容 SHA-256、company/entity 范围；
- 支持按 GuId 稳定排序分页；不以 JournalNo/BillNo 作主键；
- 先提供 `tools/list` 和一条脱敏样本，供 REFS 核验后才开放批量读取。

## 备用方案 A：VPN/IP 白名单下的数据库视图

若 MCP/OAuth 短期不能可用，请交付最小权限只读 service account、VPN 或出口 IP 白名单、TLS/证书要求和视图数据字典。账户仅可 `SELECT` 指定视图，不得访问原始表或执行过程。

首批视图范围：

| 数据库 | 视图用途 | 必需稳定键 |
| --- | --- | --- |
| SQLServer BGDATA | 应付、银行流水、AUTOC 明细、AUTOC 银行主档 | `apGuId`、`pdGuId`、`pbGuId`，以及公司/银行账户范围 |
| MySQL accounting | `accounting_info` 分录、余额/损益控制汇总 | `cb_id` / `sys_id` / `come_from` 与公司范围 |

每个视图需随行提供：company/entity key、业务日期、会计日期、状态、金额、方向、币种（若单币种请明确）、来源/trace 字段；并说明 ETL 重灌窗口。

## 备用方案 B：定期签名快照包

如暂时不能开视图，请按固定周期交付加密传输的 JSON/CSV 快照包及 manifest。manifest 必须包含：

- `snapshot_id`、`captured_at`、环境、视图名、公司范围、记录数；
- 每个文件和整包的 SHA-256；
- GuId 主键排序规则与数据字典版本；
- 生成期间/ETL 窗口说明。

REFS 将把每包作为不可变 raw receipt；缺少哈希、GuId、时间或范围信息的包一律隔离，不进入 Draft/JE。

## 数据与会计红线

- WBS 无 revision/CDC/tombstone/replay；REFS 采用完整快照、内容哈希和差异隔离，不把近似增量当作完整历史。
- 全量重灌期间可能读到半空数据；请提供 ETL 时间表，或在导出侧提供一致性快照。
- JournalNo 与 BillNo 不可信，所有关联必须使用 GuId/复合稳定键。
- AUTOC 的 Incur 是 WBS 业务事实；REFS 会自行生成 append-only 账本、反转 JE、守恒和审计，不能采用 WBS 原地删除/状态回写语义。
- Control totals 仅标 `OBSERVED`，作为双方数据质量验收，不用于自动平账。

## 首次联调验收

1. REFS 完成认证后只调用工具清单/视图元数据和一条脱敏样本；
2. IT 与 REFS 共同确认字段、GuId、公司范围、金额方向和 ETL 窗口；
3. 导入一份 Sandbox 快照，验证 Raw → Normalized → Staging receipt 与双向 trace；
4. 通过 12 个脱敏黄金样本及 control-total 差异报告后，才允许扩大范围；
5. 未达到上述条件，不连接生产数据、不自动生成或过账任何 JE。
