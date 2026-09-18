# Q01 — 主数据全生命周期审查

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 主数据对象清单与现状

### 1.1 已实现（有 DRAFT→APPROVE→RETIRE 状态机）

| 对象 | 表 | 状态字段 | 版本 | 审计事件表 | SoD 检查 |
|---|---|---|---|---|---|
| 实体 (Entity) | `entity` | `active boolean` | — | `audit_event` | — |
| 会计科目 | `account_master` | `active boolean` | — | `audit_event` | — |
| 往来成员 | `member_master` | `active boolean` | — | `audit_event` | — |
| 会计期间 | `accounting_period` | `OPEN/CLOSED` | `version bigint` | `audit_event` | — |
| 项目主数据 | `project_master` | `DRAFT/APPROVED/RETIRED` | `revision int` | `project_master_event` | `approved_by<>created_by` |
| 成本代码 | `project_cost_code` | `DRAFT/APPROVED/RETIRED` | `revision int` | `project_master_event` | `approved_by<>created_by` |
| 项目单元 | `project_unit` | `DRAFT/APPROVED/RETIRED` | `revision int` | `project_master_event` | `approved_by<>created_by` |
| 贷款主数据 | `loan_master` | `DRAFT/APPROVED/RETIRED` | `revision int` | `loan_master_event` | `approved_by<>created_by` |
| 贷款支款 | `loan_draw` | `DRAFT/APPROVED/RETIRED` | `revision int` | `loan_master_event` | `approved_by<>created_by` |
| 固定资产(通过 source_link) | `fixed_asset_register_evidence` | 通过 `status` in binding | — | `audit_event` | — |
| 附件 | `attachment` | `finalization_status` | — | `audit_event` | scan/finalize SoD |
| 设置快照 | `setting_snapshot` | `DRAFT/APPROVED/RETIRED` | `priority` | `audit_event` | — |
| 映射快照 | `mapping_snapshot` | `DRAFT/APPROVED/RETIRED` | `priority` | `audit_event` | — |

### 1.2 部分实现（`active`布尔，无版本/审批链）

| 对象 | 表 | 缺口 |
|---|---|---|
| 实体 | `entity` | 无 DRAFT→APPROVE；停用仅翻 active；无审批 SoD；无版本号 |
| 科目 | `account_master` | 无 DRAFT→APPROVE；停用仅翻 active；无创建/停用 by 字段 |
| 往来成员 | `member_master` | 同上 |
| 税码 | 无专用表 | 完全缺失 |
| 币种 | 硬编码 char(3) | 无主数据表 |
| 付款条件 | 无专用表 | 完全缺失 |
| 银行账户 | 通过 `member_master(BANK)` | 无余额快照；无开/销户事件 |

## 2. 生命周期完整性检查（现有表约束）

`project_master` 系列执行最完整的约束：
```sql
CHECK((status='DRAFT' AND approved_by IS NULL) OR (status<>'DRAFT' AND approved_by IS NOT NULL AND approved_at IS NOT NULL))
CHECK((status='RETIRED')=(retired_by IS NOT NULL))
CHECK(approved_by IS NULL OR approved_by<>created_by)
```

`account_master` / `member_master` 仅有 `active boolean`，无生命周期约束，无版本号，停用不记录操作者和时间。

## 3. 审计覆盖分析

- **有 `project_master_event`（append-only）**: `project_master`, `project_cost_code`, `project_unit` 的每次 CREATE/APPROVE/RETIRE 都有快照 + sha256 hash + actor。
- **有 `loan_master_event`（append-only）**: `loan_master`, `loan_draw` 同上。
- **通过 `audit_event` 泛型**: `account_master`, `member_master`, `attachment`, `setting_snapshot`, `mapping_snapshot` 的变更写 audit_event，但无对象级快照 hash。
- **无审计**: `entity` 的 active 变更、`accounting_period` 的 status 变更（只有 `version` 累加，无 closed_by/reason 以外的审计）。

## 4. 引用完整性检查

- `account_master` 引用约束：`journal_line.account_code` 用文本引用，无 FK（设计意图：账务历史不随科目变化）。
- `member_master` 引用约束：`journal_line.member_ref` 同上，文本引用。
- **引用完整性例外**：停用科目/成员后，历史 JE 仍可合法引用；创建 JE 时检查 `account_master.active=true`（见 migration 002 的 `refs_create_manual_journal` 校验）。

## 5. Owner 决策缺口（D-Q01-x）

| ID | 问题 | 影响 |
|---|---|---|
| D-Q01-1 | `entity` 是否需要 DRAFT→APPROVE 状态机？目前任何有 DB 写权的人可创建实体。 | 内控风险 |
| D-Q01-2 | `account_master`/`member_master` 停用是否需要四眼（创建者不能自行停用）？ | SoD |
| D-Q01-3 | 是否需要独立的税码主数据表？还是通过 `account_master` 账户属性承载？ | 设计 |
| D-Q01-4 | 银行账户（`member_master` BANK 类型）是否需要开/销户事件及余额快照？ | 审计 |
| D-Q01-5 | 币种白名单是否需要可维护的主数据表，还是保持 ISO 4217 硬编码？ | 设计 |

## 6. 工程化修复计划（不含 Owner 决策项）

### 立即可落地（无 Owner 决策）

1. **`account_master` 停用审计**：`ALTER TABLE account_master ADD COLUMN deactivated_by text, ADD COLUMN deactivated_at timestamptz`；更新停用函数记录操作者。
2. **`member_master` 同上**。
3. **`accounting_period` close 审计**：`refs_close_period_v2` 已记录 `closed_by`——确认 `audit_event` 中有 `PERIOD_CLOSED` 事件（当前代码已有）。
4. **科目版本化**：引入 `account_master.revision bigint DEFAULT 0`，每次 activate/deactivate 递增，以乐观锁保护并发停用。

### 待 Owner 决策后落地

- D-Q01-1 → entity 审批流
- D-Q01-2 → account/member SoD 约束
- D-Q01-3~5 → 新主数据表

## 7. 现有测试覆盖

- `server/tests/` 中有 `project-cost-master*.test.mjs`, `loan-interest*.test.mjs` 覆盖项目/贷款主数据生命周期。
- `account_master`/`member_master` 停用路径无专用测试。

## 8. 结论

项目/贷款/单元主数据实现了完整的 DRAFT→APPROVE→RETIRE + SoD + append-only 事件链，是最强的主数据管控模式。科目和成员仅有布尔停用，缺版本、审批和操作者记录，是当前最大的主数据治理缺口。建议按上述修复计划填补，Owner 决策项等待确认后落地。
