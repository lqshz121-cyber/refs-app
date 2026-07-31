# REFS QBO-Advanced 重构方案 v7
## 1 审计
Routes 23 / Components 26 / State: app.jsx useState+localStorage / 复用: ui.jsx Grid/Drawer/Tabs/Badge/Field
技术债: 数据硬编码于组件、无Service层、无AuditLog、AR空壳、无Register、Cash种子-554k、JE筛选chips无间距、Admin文案过时
## 2 QBO→REFS 页面映射(核心)
Dashboard→dashboard(改4层) | Bank Transactions→banktx(新) | COA→coa | Account Register→register(新) | Bills→ap(QBO表单) | Vendors→ap:vendors | Payments→ap:payments | Reconcile→bankrec | JE→je | Reports→reports(参数栏) | Audit Log→audit(新) | Sales/Customers→ar(重建)
## 3 新IA(12组·二级·可折叠·角色隐藏·全英文)
Home / Transactions / Sales & Receivables / Expenses & Payables / Projects & Properties / Construction Finance / Property Operations / Closings / Accounting / Reports / Controls / System(admin)
## 4 Route Map: +banktx +register +ar(重建) +audit +approvals; 其余沿用
## 5 Component Map: ui.jsx(Grid升级:列显隐/行选/批量) + repo.js(新Service层: load/save/audit) + module-banktx/-register/-ar(新)
## 6 Design System: QB绿#2CA01C主 + 墨#282828侧栏 + 三宽度(Focused960/Standard1440/Full) + 统一Badge/Empty/Toast
## 7 数据模型影响: bank.txns+status(for_review/categorized/excluded), audit[], ar.invoices[], je种子+注资分录
## 8 API需求(Phase后端): /auth /je /bills /invoices /bank/feed /recon /audit — 见API规格文档
## 9 阶段: P1 Shell+Grid+Repo → P2 BankTx/Register/Bill/AR → P3 专业模块融合+修复清单 → P4 部署验收
## 10 P1文件: repo.js ui.jsx app.jsx index.html module-banktx.jsx module-register.jsx module-ar.jsx modules-*.jsx(修复)
