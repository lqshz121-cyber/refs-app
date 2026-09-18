# Q05 — 核心会计工作台 UX 审查

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 工作台页面清单（基于前端测试矩阵）

从 `/tmp/gw2/tests/` 中的 52 个授权 JSX 测试文件识别以下核心工作台：

| 工作台 | 测试文件 | 核心功能 |
|---|---|---|
| Journal 手工凭证 | authoritative-journal-evidence.test.jsx | 创建/审批/过账 JE + 附件 |
| AP/AR 工作流 | ap-ar-workflow.test.jsx | 发票、收付款、信用票据 |
| Banking | authoritative-bank-workspace.test.jsx | 银行对账、匹配 |
| 银行账户管理 | authoritative-bank-accounts-workspace.test.jsx | 账户注册/停用 |
| WBS 暂存 | authoritative-accounting-staging-workspace.test.jsx | WBS ingest 复核 |
| 期间关账 | authoritative-period-close-workspace.test.jsx | 关账流程 |
| 科目表 (COA) | authoritative-coa-register-workspace.test.jsx | 科目维护 |
| 报表 | authoritative-financial-statements.test.jsx | P&L, BS, CF |
| 总账 | authoritative-general-ledger-workspace.test.jsx | 明细/汇总查询 |
| 固定资产 | authoritative-fixed-assets-workspace.test.jsx | 资产卡片、折旧 |
| 贷款登记 | authoritative-loan-register-workspace.test.jsx | 贷款+支款管理 |
| AI 审计 | authoritative-ai-audit-workspace.test.jsx | AI 发现复核 |
| 账龄分析 | authoritative-aging-workspace.test.jsx | AR/AP 账龄 |
| 递延/摊销 | authoritative-accrual-workspace.test.jsx | 预提/摊销管理 |
| 操作待办 | authoritative-action-required-workspace.test.jsx | 待审批汇总 |
| 审计日志 | authoritative-audit-log-workspace.test.jsx | 审计查询 |

## 2. 系统性 UX 问题识别

### 2.1 导航与状态

**已知问题**（基于 E2E 矩阵 `/tmp/gw2/E2E-BROWSER-MATRIX.md` 和白屏排查历史）：

| 问题 | 位置 | 优先级 |
|---|---|---|
| 白屏（白画面）在 SSR/hydration 失败时 | 全局 shell | P0（已有历史修复） |
| JE 审批状态未实时刷新 | Journal 工作台 | P1 |
| AP/AR 状态流状态机映射不完整 | AP/AR 工作台 | P1 |
| 银行对账匹配完成后无确认提示 | Banking 工作台 | P2 |
| 大数据量期间下总账查询无分页 | 总账查询 | P1 |
| WBS 导入批次失败无下载链接 | WBS 暂存工作台 | P1 |
| 期间关账进度无实时反馈 | 期间关账 | P2 |

### 2.2 表单与保存

| 问题 | 位置 | 建议 |
|---|---|---|
| 手工 JE 创建表单提交后无明确成功/失败反馈 | Journal 创建 | 添加 toast + redirect to JE detail |
| 附件上传进度无状态显示 | 附件上传 | 添加 progress bar + scan status |
| 借贷平衡验证仅在提交时触发 | JE lines | 添加实时借贷合计和差额提示 |
| 删除操作无二次确认（如科目停用） | COA 工作台 | 添加确认对话框 |

### 2.3 错误处理

| 问题 | 期望行为 | 现状 |
|---|---|---|
| 422（业务拒绝）显示技术错误码 | 显示业务友好错误信息 | 可能直接显示 PG 错误 |
| 409（幂等重放）不提示重复操作 | 提示"操作已成功处理" | 未确认 |
| 网络超时后表单状态不清 | 恢复表单草稿 | 未实现 |
| 审批 SoD 冲突（42501）显示为通用错误 | 显示"操作者不得同时担任该角色" | 需映射 |

### 2.4 审批可见性

| 需求 | 现状 | 建议 |
|---|---|---|
| JE 审批链全貌（创建→提交→复核→审批→过账 + 操作者姓名） | JE detail 展示 | 确认 5 个 actor 字段均展示 |
| 附件扫描状态（PENDING/CLEAN/REJECTED） | 未确认 | 附件列表需显示 scan_status |
| 操作待办按优先级排序 | 未确认 | 按 deadline/severity 排序 |

## 3. 关键屏幕回归测试矩阵（建议）

| 屏幕 | 正常流 | 错误流 | 边界条件 |
|---|---|---|---|
| JE 创建 | 借贷平衡→附件→提交→成功 | 借贷不平/422/附件失败 | 空期间、关闭期间 |
| JE 审批 | SUBMIT→REVIEW→APPROVE→POST | 同一人多步骤拒绝（SoD） | 修订版本冲突（40001） |
| 期间关账 | 就绪检查→关账→确认 | PENDING 余额阻止关账 | 空期间关账 |
| 银行对账 | 导入→匹配→确认 | 余额不符 | 大量未匹配条目 |
| AP 发票 | 创建→审批→付款→匹配 | 超额付款拒绝 | 跨期发票 |

## 4. 立即可落地修复

1. **错误码映射表**: 在前端创建 `error-messages.ts`，将 `42501`, `55000`, `23514`, `40001`, `P0002` 等映射到中英双语用户友好描述。
2. **JE lines 实时余额显示**: 在 JE 表单底部添加"借方合计 / 贷方合计 / 差额"实时计算组件。
3. **WBS 导入失败下载**: 导入失败时返回可下载的错误明细 CSV。

## 5. Owner 决策缺口（D-Q05-x）

| ID | 问题 |
|---|---|
| D-Q05-1 | 前端技术栈是否已固定（React + Vite）？是否需要 SSR？ |
| D-Q05-2 | 用户权限粒度是否需要在 UI 中呈现（如按钮灰化 vs 整页隐藏）？ |
