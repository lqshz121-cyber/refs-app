# REFS · AI Real Estate Accounting System (WanBridge)

**WBS Accounting Engine** — 在 WBS Auto Bank Reconciliation / Accounting System 基础上的升级版:
Setting-Driven 自动记账 + QuickBooks 级工作流 + Apple 风格 UI + AI Accounting Judge + AI Audit。

Live: https://lqshz121-cyber.github.io/refs-app/ (演示登录,角色=所选账号;顶栏 ⟲ 重置种子)

## 核心链路(禁止跳步)
Source → Classification → Company Setting(四大Setting) → Rule/AI Coding → Staging(人审) → Draft JE → Approval → Posted → GL → Recon → Reports → AI Audit

## 与 WBS 逐一对齐的机制
- 四大 Setting(Account/Cost/Payable/Batch,62行真实taxonomy,Copy跨公司/年,Test Rule,LIVE/INACTIVE)
- 双步过账:PAYABLE→Cr 291001_按Payee;银行Feed EXPA/AUTOC 自动清账;Not Match→Exception
- 辅助核算:科目×核算对象(Bank/Vendor/Customer/Affiliate/Loan),缺member禁过账[4020]
- Cost Code×Status 驱动分录(2HD在建→164400;完工→510000;利息资本化/费用化)
- Loan Draw = Dr 111000 Cash / Cr 270100(资金≠成本;成本来自AP/FAST发票)
- 766科目真实WBS COA(Header/Posting/Total);119家真实公司;辅助台账/Unit Cost/Unit Transfer(成本桥+Evidence)
- AI Judge(建议Dr/Cr+Confidence+Reason+Rule+Setting+Risk,不代过账);AI Audit Center 八Tab+Resolve

## 模块(30+,均可操作非展示)
Staging Center/Source Documents/四大Setting/AI Audit/AI Judge/JE(QBO表单+审批+红冲)/GL(期间范围+分组TB+BS/IS)/
辅助核算台账/Account Register/COA/Bank Transactions(For Review)/Bank Rec(标准模型)/Auto Bank Rec(四步流水线)/
Checks/AP(291001双步)/AR/Loan/Unit Cost/Unit Transfer/Project Cost/PM Pickup(Unit→Owner)/Closing/IC(镜像)/月结/16报表/Audit Log

## 工程
React18+esbuild 静态站(`node build.mjs`);状态 localStorage(src/repo.js=后端接入点);Chart.js CDN。
**双测试门**:SSR冒烟(mtest,27组件) + 账本审计(audit.cjs,fails=0)。种子改动→app.jsx SEED_V 递增。
协作规范见 COLLABORATION.md;路线图见 BLUEPRINT.md(P1: TypeScript+PostgreSQL+API,由 Codex 主导)。

> 注:当前为可运行的前端引擎+模拟数据(标注 demo);接真实 WBS 数据仅需替换 repo.js 数据源。
