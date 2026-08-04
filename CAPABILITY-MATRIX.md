# Capability Matrix — evidence status, not release status

> **Release boundary (2026-08-03):** UI/SSR scenarios and local PostgreSQL gates are not production or live evidence. `src/repo.js`/`src/app.jsx` retain browser-local persistence; WBS live immutable receipts, authenticated production IAM, shared-session browser E2E, and deployment recovery evidence remain unverified. No row below authorizes production deployment or claims QuickBooks/WBS functional equivalence.
| # | Module | Status | Evidence | Workflow | Src→JE | GL | AI Judge | AI Audit | Remaining Gap | Pri |
|---|---|---|---|---|---|---|---|---|---|---|
|1| Account Setting | PARTIAL (UI/local) | module-setting/settings.js | ✅编辑/±/状态 | ✅S2/S6 | ✅ | ✅ | ✅ | server persistence, effective-date history, independent E2E | P1 |
|2| Cost Setting | ✅ | 同上 | ✅ | ✅S7/7b | ✅ | ✅ | ✅ | 单码级明细行(现为码组) | P1 |
|3| Payable Setting | ✅ | 同上 | ✅ | ✅291001双步 | ✅ | ✅ | ✅ | 按码逐行×公司全量 | P1 |
|4| Batch Setting | ✅ | 同上+Run Batch | ✅生成JE+自动冲回 | ✅ | ✅ | — | ✅ | 金额来源模板化 | P2 |
|5| Journal Code Config | ✅ | 编号YYYYMMDD+seq | ✅ | ✅ | ✅ | — | — | 前缀可配 | P3 |
|6| Company Rule Profile | ✅ | setting_{entity} | ✅ | ✅ | ✅ | ✅ | — | version history | P1 |
|7| Copy Wizard | ✅ | copySetting | ✅跨公司 | — | — | — | — | 跨年+history | P1 |
|8| Mapping Center | 🟡 | 十族索引+PM明细 | 索引✅ | via Setting | ✅ | ✅ | ✅ | 每族独立CRUD/审批/版本 | P1 |
|9| Source Documents | ✅ | module-sourcedocs | ✅ | ✅JE Trace列 | ✅ | — | ✅孤儿预警 | source line 级 | P2 |
|10| Accounting Staging | PARTIAL (UI/local) | module-staging | ✅五段+色 | ✅ | ✅ | ✅行级 | ✅ | server persistence and browser E2E | P1 |
|11| AI Judge | ✅ | ai.js(8项输出) | ✅ | ✅S1-S12 | — | ✅ | — | LLM增强(现规则型) | P4 |
|12| AI Audit | ✅ | module-aiaudit | ✅8Tab+Resolve+红冲 | — | ✅ | — | ✅ | reclass向导 | P4 |
|13| Auto Reconciliation | FAIL for live use | module-wbs (documented/demo data) | UI flow only | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | NOT VERIFIED | authenticated read-only WBS connector, immutable receipts, source control totals, server workflow and browser E2E | P0 |
|14| Journal Entry | PARTIAL | QBO form + server kernel candidates | ✅ | PG-VERIFIED only | PG-VERIFIED only | — | ✅ | production IAM, deployment/live E2E | P1 |
|15| General Ledger | ✅ | TB/Detail/BS/IS/CF+期间 | ✅ | — | ✅drill | — | — | 预算对比列 | P3 |
|16| Construction Loan | ✅ | S2-S5全对 | ✅ | ✅ | ✅ | ✅ | ✅红冲闭环 | lender对账页 | P3 |
|17| AP | PARTIAL | 291001 workflow candidates | ✅ | PG-VERIFIED only | PG-VERIFIED only | ✅ | ✅ | native object persistence, reversals/partial payment, live E2E | P0 |
|18| AR | PARTIAL | Invoice/receipt workflow candidates | ✅ | PG-VERIFIED only | PG-VERIFIED only | — | — | credit memo/refund/partial receipt, live E2E | P0 |
|19| Intercompany | ✅ | 镜像+291按member+S10 | ✅ | ✅ | ✅ | ✅ | ✅ | elimination批次 | P3 |
|20| Unit Transfer | ✅ | 成本桥+Evidence+双JE(S11 live) | ✅ | ✅ | ✅ | — | ✅cutoff | 多Unit批量 | P3 |
|21| CWIP | ✅ | Rollforward报表 | ✅ | ✅ | ✅ | ✅ | ✅ | 与Unit页联动 | P3 |
|22| Inventory | 🟡 | Rollforward报表(163000未启用流转) | 报表✅ | 口径待启 | ✅ | — | — | CWIP→163000→COGS三段流转 | P3 |
|23| Reports | ✅ | 19张实报表+CSV | ✅ | — | ✅ | — | ✅报告 | PDF/Excel排版 | P3 |
|24| README/Docs | PARTIAL | README/V2/contracts/本表 | — | — | — | — | — | keep release claims synchronized with independent evidence | P0 |
Backend PostgreSQL/API candidates and golden fixtures exist; they do not prove real WBS synchronization or a production release.
