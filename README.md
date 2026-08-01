# REFS · AI Real Estate Accounting System (WanBridge)

**WBS Accounting Engine** — 在 WBS Auto Bank Reconciliation / Accounting System 基础上的升级版:
Setting-Driven 自动记账 + QuickBooks 级工作流 + Apple 风格 UI + AI Accounting Judge + AI Audit。

Live: https://lqshz121-cyber.github.io/refs-app/ (演示登录,角色=所选账号;顶栏 ⟲ 重置种子)

## 核心链路(禁止跳步)
Source → Classification → Company Setting(四大Setting) → Rule/AI Coding → Staging(人审) → Draft JE → Approval → Posted → GL → Recon → Reports → AI Audit

## 与 WBS 逐一对齐的机制
- 四大 Setting(Account/Cost/Payable/Batch,62行 WBS reference snapshot taxonomy,Copy跨公司/年,Test Rule,LIVE/INACTIVE)
- 双步过账:PAYABLE→Cr 291001_按Payee;银行Feed EXPA/AUTOC 自动清账;Not Match→Exception
- 辅助核算:科目×核算对象(Bank/Vendor/Customer/Affiliate/Loan),缺member禁过账[4020]
- Cost Code×Status 驱动分录(2HD在建→164400;完工→510000;利息资本化/费用化)
- Loan Draw = Dr 111000 Cash / Cr 270100(资金≠成本;成本来自AP/FAST发票)
- 766科目 WBS reference snapshot COA(Header/Posting/Total);119家 WBS reference snapshot公司;辅助台账/Unit Cost/Unit Transfer(成本桥+Evidence)
- AI Judge(建议Dr/Cr+Confidence+Reason+Rule+Setting+Risk,不代过账);AI Audit Center 八Tab+Resolve

## 十组导航与模块

| 导航组 | 模块 |
|---|---|
| Control Center | Dashboard · Action Required · AI Audit Center |
| Accounting Settings | 四大 Setting · Rule Center · Mapping Center |
| Source & Staging | Accounting Staging · Source Documents · Integration Hub · Mapping Exceptions |
| Auto Reconciliation | Bank Batch Pipeline · Bank Transaction Matching · Reconciliation Worksheet · Checks & Payments |
| Journal Entry | Journal Entries（QBO 表单、复核、审批、过账、红冲） |
| General Ledger | GL / TB / BS / IS · Account Inquiry · 辅助核算 · Chart of Accounts |
| Real Estate Accounting | Project Cost & CWIP · Unit Cost · Unit Transfer · Construction Loan · Loan Register · PM Pickup · Closing · Intercompany · Fixed Assets |
| Close | Month-End Close |
| Reports | Reports Center（16 张报表） |
| Admin | Master Data · AP · AR · Bank Accounts · Audit Log · Users & Settings |

模块存在不等于已达到生产完备度；产品完成口径见 `PRODUCT-NORTHSTAR.md`，WBS 实际路由/API 摸排与同步契约见 `WBS-SOURCE-CONTRACT.md`，当前能力与缺口以验收矩阵和 `REFS-ARCHITECTURE-V2.md` 为准。

## 工程
React18+esbuild 静态站(`node build.mjs`);状态 localStorage(src/repo.js=后端接入点);Chart.js CDN。
**双测试门**：SSR 冒烟（`mtest.jsx`，27 组件）+ 账本审计（`audit.js`，119 实体、fails=0）。种子改动→app.jsx SEED_V 递增。

```powershell
npx esbuild mtest.jsx --bundle --platform=node --format=cjs --jsx=automatic --loader:.js=jsx --loader:.jsx=jsx --outfile=mtest.cjs; node mtest.cjs
npx esbuild audit.js --bundle --platform=node --format=cjs --jsx=automatic --loader:.js=jsx --loader:.jsx=jsx --outfile=audit.cjs; node audit.cjs
```
协作规范见 COLLABORATION.md；路线图见 BLUEPRINT.md。当前 owner：Codex 主负责 QuickBooks 风格前端与 E2E，Claude 主负责 PostgreSQL/API/WBS ingestion；双方交叉复核。

> 注：当前是可运行的前端引擎与 demo 数据，不是 WBS 生产账簿。真实接入需要只读 WBS API、PostgreSQL 原始/规范化/Staging 数据层、幂等同步、附件存储、事务 Posting、备份恢复和生产 E2E；不能只替换 `repo.js`。
