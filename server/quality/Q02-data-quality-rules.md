# Q02 — 数据质量规则引擎审查

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 现有数据质量控制机制

### 1.1 数据库层约束（已实现）

| 规则类型 | 实现位置 | 覆盖对象 |
|---|---|---|
| 唯一性 | `UNIQUE` 约束 | loan_ref, project_ref, unit_ref, journal_number, idempotency_key 等 |
| 完整性 | `NOT NULL` + `CHECK` | 所有主数据表 |
| 合法性（格式） | `CHECK(field ~ pattern)` | ref 格式 ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$, 金额格式, sha256 hash |
| 借贷平衡 | `refs_create_manual_journal` 行级检查 | `sum(debit)=sum(credit)` + 两行最少 |
| 期间控制 | `refs_create_manual_journal`第1024行 | journal_date between starts_on and ends_on AND status='OPEN' |
| SoD | `refs_guard_runtime_context_sod()` 触发器 | 一个 actor 在一个 entity 只能有一个 authority_class |
| 引用完整性 | FK + 主动校验（附件 tenant 检查） | attachment, entity, tenant |
| 跨表一致 | `refs_close_period_v2` 就绪检查 | period 关账前验证 PENDING 余额 |
| 幂等 | `idempotency_receipt` 表 + request_hash | 所有写命令 |
| 来源哈希 | `snapshot_hash`, `computation_hash`, `evidence_hash` | 设置/映射/规则评估快照 |

### 1.2 应用层规则（kernel-repository.mjs）

| 规则 | 位置 | 行为 |
|---|---|---|
| 金额精度 4 位小数 | 所有 `amt` 字段 CHECK | 非静默：422 返回 |
| 附件必须 VERIFIED_CLEAN | `createManualJournal` FK 检查 + `attachment_verified_entity_ck` | 23514 / 23503 |
| 跨 tenant 隔离 | RLS 策略 `refs_current_tenant()` | 42501 |
| 贷款额度不超 facility | `createLoanDraw` approve 时检查 | 422 |
| COGS 不超剩余成本 | `createUnitCogsReleaseDraft` | 23514 |
| 利息仅在 APPROVED 贷款 | `readLoanInterestAccrual` | 404/422 |

### 1.3 AI 质量发现（已实现，只读）

| 发现类型 | 表 | 说明 |
|---|---|---|
| 银行重复付款 | `ai_bank_duplicate_payment_finding` | AI 标记，人工复核 |
| 发票金额异常 | `ai_vendor_invoice_amount_anomaly_finding` | |
| 发票频率异常 | `ai_vendor_invoice_frequency_anomaly_finding` | |
| 近重复发票 | `ai_vendor_invoice_near_duplicate_finding` | |
| 未匹配银行支付 | `ai_unmatched_bank_payment_finding` | |
| 手工 JE 风险 | `ai_manual_journal_risk.mjs` (内存，非持久化) | |

## 2. 数据质量规则缺口

### 2.1 缺失的系统级规则

| 规则 | 现状 | 风险级别 |
|---|---|---|
| 会计科目余额合理性检查 | 无 | 中 |
| 跨期间余额连续性（期末=次期初） | 无专用检查 | 高 |
| 银行余额与账务余额对账 SLA | 无自动触发 | 高 |
| 孤儿 source_document（无 staging_item）清理规则 | 无 | 中 |
| WBS ingest 积压 SLA（> N 行未处理报警） | outbox 有 stale 计数，无 SLA 规则 | 中 |
| 附件孤儿（finalization_status=PENDING 超时）清理 | `cleanup_status` 存在但无规则引擎触发 | 低 |

### 2.2 规则结果审计化

- 现有 AI 发现写入持久化表（`ai_*_finding`），有 lifecycle 表（`ai_bank_duplicate_payment_lifecycle`）。
- 手工 JE 风险（`ai_manual_journal_risk.mjs`）只在内存中产生，不写 `ai_finding` 或 `audit_event`——**是一个静默化缺口**。
- `accounting_exception` 表存在但未见规则引擎系统性写入。

## 3. 规则框架建议

### 3.1 异常分级（建议标准）

| 级别 | 定义 | 处理 SLA |
|---|---|---|
| BLOCKER | 阻止关账（如期间内未匹配银行对账） | 必须关账前解决 |
| WARNING | 建议处理（如 COGS_WITHOUT_REVENUE） | 关账前需人工确认 |
| INFO | 信息性（如大额手工 JE） | 记录，无强制 |

### 3.2 规则注册表设计（建议）

```sql
CREATE TABLE data_quality_rule(
  rule_id text PRIMARY KEY,           -- e.g. 'DQ.PERIOD.BALANCE_CONTINUITY'
  domain text NOT NULL,               -- 'GL', 'WBS', 'BANK', 'MASTER'
  severity text NOT NULL CHECK(severity IN('BLOCKER','WARNING','INFO')),
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  last_updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE data_quality_finding(
  finding_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  rule_id text NOT NULL REFERENCES data_quality_rule(rule_id),
  severity text NOT NULL,
  object_type text,
  object_id uuid,
  detail jsonb NOT NULL DEFAULT '{}',
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text
);
```

## 4. 立即可落地修复

1. **手工 JE 风险持久化**: `ai_manual_journal_risk.mjs` 产生的风险写入 `ai_finding` 而非仅内存返回。
2. **stale 附件清理规则**: `upload_expires_at <= now()` AND `finalization_status='PENDING'` 的附件标记 `cleanup_status='PENDING'`（已有列，缺触发器）。
3. **WBS 积压 SLA 告警**: outbox health 的 `stale_pending_count > 0` 写入 `accounting_exception`（BLOCKER 级）。

## 5. Owner 决策缺口（D-Q02-x）

| ID | 问题 |
|---|---|
| D-Q02-1 | 数据质量发现是否需要独立的复核流程（类似 WBS 的 review 步骤）？ |
| D-Q02-2 | 关账前哪些数据质量规则是强制 BLOCKER（阻止 close）？ |
| D-Q02-3 | 手工 JE 风险 AI 发现是否应作为可审计的财务记录保存？ |
