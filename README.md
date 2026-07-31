# REFS — Real Estate Financial System (WanBridge) · Functional Prototype

企业级房地产项目公司会计系统的**可运行原型**。React + esbuild 打包为纯静态站点，
可直接双击 `dist/index.html` 打开，或部署到任意静态托管（Render Static Site）。

## 功能覆盖
- 财务工作台 Dashboard（关账进度 / 待审批 / 同步状态 / 异常 / 待办）
- Journal Entry Workspace：复式借贷**实时平衡校验**、状态机审批（Draft→Review→Approve→Post）、
  **Maker≠Approver 职责分离拦截**、红字反冲、附件必填、已过账不可改
- Construction Loan：利息**资本化 vs 费用化**由 `construction_status` 驱动，一键生成 Draft JE
- Property Operations Pickup：Charge Code→GL 映射、**未映射转异常**、押金记负债、去重
- Closing Workspace：科目拆分 + **平衡检查带**
- Bank Reconciliation：匹配 / Suspense / **差异=0 才可 Sign-off**
- Exception Center：24 类异常、Drawer 处置、**关闭需证据**
- Month-End Close：任务依赖锁、Sign-off、锁定期间
- General Ledger：由已过账分录实时汇总 **Trial Balance / BS / IS**
- 其余模块（AP/AR/Cash/Loan Register/Project Cost/Assets/Intercompany/
  Integration Hub/Master Data/Mapping/Rule Center/Reports/Admin）列示与导航
- 顶栏切换**实体 / 角色**体验权限差异；⌘K 命令面板；明/暗模式

## 本地运行
```bash
npm install
npm run build      # 产出 dist/（index.html + bundle.js）
# 直接打开 dist/index.html
```
开发监听：`npm run dev`

## 部署到 Render
仓库含 `render.yaml`（Static Site 蓝图）。在 Render 中 **New → Blueprint**，
选择本仓库即可自动按 `render.yaml` 部署；构建命令 `npm install && npm run build`，
发布目录 `dist`。

## 说明
数据为演示种子数据（非真实账务）。这是产品原型，用于验证流程与交互；
生产实现请对接后端（PostgreSQL DDL、规则引擎、集成 Hub、API 见配套规格文档 REFS-00~06）。
