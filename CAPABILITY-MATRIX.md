# Current Capability Matrix (2026-08-01 · engine 13/13 场景 PASS · 见 contracts/E2E-SCENARIOS.md)
| # | Module | Status | Evidence | Workflow | Src→JE | GL | AI Judge | AI Audit | Remaining Gap | Pri |
|---|---|---|---|---|---|---|---|---|---|---|
|1| Account Setting | ✅ LIVE | module-setting/settings.js | ✅编辑/±/状态 | ✅S2/S6 | ✅ | ✅ | ✅ | effective date range·approval history | P1 |
|2| Cost Setting | ✅ | 同上 | ✅ | ✅S7/7b | ✅ | ✅ | ✅ | 单码级明细行(现为码组) | P1 |
|3| Payable Setting | ✅ | 同上 | ✅ | ✅291001双步 | ✅ | ✅ | ✅ | 按码逐行×公司全量 | P1 |
|4| Batch Setting | ✅ | 同上+Run Batch | ✅生成JE+自动冲回 | ✅ | ✅ | — | ✅ | 金额来源模板化 | P2 |
|5| Journal Code Config | ✅ | 编号YYYYMMDD+seq | ✅ | ✅ | ✅ | — | — | 前缀可配 | P3 |
|6| Company Rule Profile | ✅ | setting_{entity} | ✅ | ✅ | ✅ | ✅ | — | version history | P1 |
|7| Copy Wizard | ✅ | copySetting | ✅跨公司 | — | — | — | — | 跨年+history | P1 |
|8| Mapping Center | 🟡 | 十族索引+PM明细 | 索引✅ | via Setting | ✅ | ✅ | ✅ | 每族独立CRUD/审批/版本 | P1 |
|9| Source Documents | ✅ | module-sourcedocs | ✅ | ✅JE Trace列 | ✅ | — | ✅孤儿预警 | source line 级 | P2 |
|10| Accounting Staging | ✅ | module-staging(live E2E) | ✅五段+色 | ✅ | ✅ | ✅行级 | ✅ | 批量动作 | P2 |
|11| AI Judge | ✅ | ai.js(8项输出) | ✅ | ✅S1-S12 | — | ✅ | — | LLM增强(现规则型) | P4 |
|12| AI Audit | ✅ | module-aiaudit | ✅8Tab+Resolve+红冲 | — | ✅ | — | ✅ | reclass向导 | P4 |
|13| Auto Reconciliation | ✅ | module-wbs(真实数据) | ✅四步 | ✅Incur | ✅ | ✅ | ✅ | 真实feed | 后端 |
|14| Journal Entry | ✅ | QBO表单+审批+红冲+附件 | ✅ | ✅ | ✅ | — | ✅ | 行级批量编辑 | P3 |
|15| General Ledger | ✅ | TB/Detail/BS/IS/CF+期间 | ✅ | — | ✅drill | — | — | 预算对比列 | P3 |
|16| Construction Loan | ✅ | S2-S5全对 | ✅ | ✅ | ✅ | ✅ | ✅红冲闭环 | lender对账页 | P3 |
|17| AP | ✅ | 291001双步+账龄+dup | ✅ | ✅ | ✅ | ✅ | ✅ | Bill Lines/PO三单匹配 | P3 |
|18| AR | ✅ | Invoice→收款→账龄 | ✅ | ✅ | ✅ | — | — | credit memo | P3 |
|19| Intercompany | ✅ | 镜像+291按member+S10 | ✅ | ✅ | ✅ | ✅ | ✅ | elimination批次 | P3 |
|20| Unit Transfer | ✅ | 成本桥+Evidence+双JE(S11 live) | ✅ | ✅ | ✅ | — | ✅cutoff | 多Unit批量 | P3 |
|21| CWIP | ✅ | Rollforward报表 | ✅ | ✅ | ✅ | ✅ | ✅ | 与Unit页联动 | P3 |
|22| Inventory | 🟡 | Rollforward报表(163000未启用流转) | 报表✅ | 口径待启 | ✅ | — | — | CWIP→163000→COGS三段流转 | P3 |
|23| Reports | ✅ | 19张实报表+CSV | ✅ | — | ✅ | — | ✅报告 | PDF/Excel排版 | P3 |
|24| README/Docs | ✅ | README/V2/contracts/本表 | — | — | — | — | — | 持续同步机制 | P0常态 |
后端(Postgres/API/真实WBS同步)= Codex 车道,contracts/golden-fixtures 已备。
