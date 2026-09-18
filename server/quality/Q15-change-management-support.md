# Q15 — 线上支持与变更管理

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 变更管理框架（建议）

### 1.1 变更类型分级

| 变更类型 | 示例 | 审批要求 | 发布窗口 |
|---|---|---|---|
| 紧急修复（Hotfix） | 数据丢失/安全漏洞 | Owner 单人审批 | 任意时间 |
| 普通补丁（Patch） | Bug 修复、性能优化 | PR review + CI | 工作日白天 |
| 功能发布（Feature） | 新 API/新业务逻辑 | PR review + QA + CI | 计划窗口 |
| 迁移变更（DB migration） | 新 migration | 迁移门禁 + Owner 签字 | 维护窗口 |
| 配置变更 | 环境变量、连接数 | Owner 审批 | 维护窗口 |
| 基础设施变更 | PG 升级、服务器变更 | 架构师 + Owner | 计划维护 |

### 1.2 变更登记模板

```markdown
## 变更申请 [CHANGE-YYYY-MM-DD-NNN]

**变更类型**: Patch / Feature / Migration / Config / Infra
**计划时间**: YYYY-MM-DD HH:MM UTC+8
**影响实体**: 全部 / entity_id=xxx
**变更内容**:
  - 具体改了什么
  - 影响的表/函数/API

**验证步骤**:
  1. 迁移完整性检查
  2. 冒烟测试
  3. 期间健康检查

**回滚方案**:
  - 回滚触发条件
  - 具体步骤（见 RELEASE-GOVERNANCE-P15.md）
  - 预计回滚时间

**Owner 签字**: ___________
**工程师执行**: ___________
```

## 2. 功能旗标（Feature Flags）

### 2.1 建议实现

```javascript
// runtime/feature-flags.mjs
const FLAGS = {
  AI_JE_RISK_SCAN: process.env.FF_AI_JE_RISK_SCAN === 'true',  // default: false
  LOAN_INTEREST_DRAFT: process.env.FF_LOAN_INTEREST_DRAFT === 'true',
  UNIT_COGS_RELEASE: process.env.FF_UNIT_COGS_RELEASE === 'true',
};
export function isEnabled(flag) {
  return FLAGS[flag] ?? false;
}
```

```sql
-- 或在 DB 中管理（支持热更新）
CREATE TABLE feature_flag(
  flag_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  enabled_for_tenants uuid[],  -- NULL = 全局
  updated_by text,
  updated_at timestamptz DEFAULT now()
);
```

### 2.2 现有新功能推荐旗标

| 功能 | 建议旗标 | 当前状态 |
|---|---|---|
| 贷款利息草稿（P07） | `FF_LOAN_INTEREST_DRAFT` | 新功能 |
| 单元 COGS 释放（P06） | `FF_UNIT_COGS_RELEASE` | 新功能 |
| AI JE 风险扫描 | `FF_AI_JE_RISK_SCAN` | 新功能 |
| 固定资产减值（P09） | `FF_FIXED_ASSET_IMPAIRMENT` | 新功能 |

## 3. 发布说明模板

```markdown
## REFS 版本 vYYYY.MM.DD

### 新功能
- [P07] 贷款利息自动计算与草稿创建
- [P06] 项目单元 COGS 释放草稿

### 修复
- [S14] 修复 SoD 检查在并发场景下的竞争条件
- 修复 WBS 导入大批次时的超时问题

### 变更
- `refs_post_journal` 响应不再包含 `status` 字段（只含 `journal_entry_id` 和 `posting_batch_id`）

### 破坏性变更（Breaking Changes）
- ⚠️ API: `POST /entities/{id}/manual-journals` 现在必须提供至少一个 VERIFIED_CLEAN 附件

### 迁移
- 本版本包含迁移 434-439（无数据迁移，仅结构变更）

### 已知问题
- [D-Q07-1] 多币种折算尚未实现，所有金额按导入值直接入账

### 升级步骤
1. 备份数据库（见 BACKUP-PITR-RUNBOOK-P14.md）
2. 执行迁移：`node server/runtime/migrations.mjs up`
3. 验证迁移：检查 `refs_schema_migration` 最新条目
4. 重启 API 服务
5. 执行冒烟测试
```

## 4. 客户影响评估

每次功能发布前需评估：

| 问题 | 本版本答案 |
|---|---|
| 是否破坏现有 API 调用？ | 需按 Breaking Changes 列出 |
| 是否影响现有数据？ | 只有结构性迁移，数据不变 |
| 是否需要客户重新配置？ | 功能旗标默认关闭，无需重配 |
| 高峰时期是否避开发布？ | 建议月末关账期间不发布 |
| 是否需要通知财务团队？ | 破坏性变更时必须提前 3 天通知 |

## 5. 支持 SLA

| 问题严重级别 | 响应时间 | 解决时间 |
|---|---|---|
| P0（数据丢失/账目错误） | 15 分钟 | 4 小时 |
| P1（功能不可用） | 1 小时 | 24 小时 |
| P2（功能降级） | 4 小时 | 72 小时 |
| P3（非关键问题） | 24 小时 | 2 周 |

## 6. 生产故障升级流程

```
检测到问题
  ↓
工程师评估严重级别
  ↓
P0/P1: 立即通知 Owner + 技术负责人
  ↓
创建事件记录（incident_id = YYYY-MM-DD-NNN）
  ↓
执行故障恢复（见 PRODUCTION-RECOVERY-RUNBOOK.md）
  ↓
输出事后分析（postmortem，72h内）
  ↓
根因修复 + 预防措施
```

## 7. 已知问题页（建议维护）

```markdown
## REFS 已知问题清单

| 问题 ID | 描述 | 影响版本 | 状态 | 预计修复 |
|---|---|---|---|---|
| KI-001 | 多币种折算未实现（D-Q07-1） | 所有 | 设计中 | TBD |
| KI-002 | actor_id PII 脱敏未实现（D-Q04-1） | 所有 | 待 Owner 决策 | TBD |
| KI-003 | 无障碍访问（WCAG AA）未验证 | 所有 | 计划 | Q4 2026 |
```

## 8. 立即可落地

1. **功能旗标环境变量**: 在 `config.mjs` 中为所有新功能（P06, P07, P09）添加环境变量开关，默认 `false`。
2. **变更登记文件夹**: 在仓库根目录创建 `changes/` 目录，存放每次生产变更的登记文档。
3. **已知问题文件**: 创建 `server/KNOWN-ISSUES.md`。

## 9. Owner 决策缺口（D-Q15-x）

| ID | 问题 |
|---|---|
| D-Q15-1 | 功能旗标是在环境变量还是数据库中管理（支持热更新的需要 DB）？ |
| D-Q15-2 | 是否需要外部变更管理系统（Jira、ServiceNow）与代码仓库集成？ |
| D-Q15-3 | 支持 SLA 是否有服务协议约束？ |
