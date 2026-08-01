# refs-app · AI Real Estate Accounting System — 总纲 (v1, 2026-08-01)
定位: WBS 的会计引擎(非ERP/非物业/非施工系统)。QuickBooks Advanced 通用会计体验 + 房地产项目会计深度 + AI Controller。
数据流铁律: Source(WBS/FAST/FasterPO/PM/Bank/Closing) → Integration Hub → Source Document → Staging → Mapping → Rule Engine → AI Coding → Review → Draft JE → Approval → Posted JE → GL → Reports/Recon/Audit。禁止直写GL;Posted不可改;更正走Reverse/Reclass;每行带全维度(entity/project/phase/unit/wbs_node/cost_code/vendor/loan/source_doc/ic_pair...)。
关键记账规则: Draw=Dr Cash/Cr Loan Payable(已修): 成本来自Invoice(Dr CWIP/Cr AP); 利息按construction_status资本化(164500)或费用化(795000); 押金进负债; CWIP→Inventory→COGS 随Unit状态流转; 跨entity付款自动生成 Due from/to 镜像对; Unit Transfer 需 A/B 双JE + cost bridge + evidence checklist。
Phase 0 代码审计/TS化/抽mock → Phase 1 Postgres+JE/GL/RBAC/PeriodLock → Phase 2 IntegrationHub+Staging+Mapping+Rule+Exception → Phase 3 Loan/AP/BankRec/CWIP/UnitCost/IC/Closing → Phase 4 Unit Transfer+CostGL Recon → Phase 5 AI(建议不自动过账)+Close Package。
验收硬标准20条(见会话全文): 平衡/期间/维度/来源/映射/锁账/审计日志全覆盖。
DB/API 设计: 见会话中的完整 schema 与 endpoint 清单(30节全文以本 commit 对应会话为准)。
