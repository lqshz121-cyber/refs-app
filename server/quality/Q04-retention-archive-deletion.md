# Q04 — 数据保留、归档与删除策略

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 数据类型分级

| 数据类型 | 表/系统 | 法定保留期（建议） | 可删除？ |
|---|---|---|---|
| 账务（JE/Ledger/Posting） | journal_entry, ledger_line, posting_batch | ≥10年（会计法要求） | 不可删除 |
| 审计事件 | audit_event | ≥10年 | 不可删除 |
| 溯源图谱 | source_link | ≥10年（与账务同寿命） | 不可删除 |
| 附件（财务凭证） | attachment + object store | ≥10年 | 不可删除 |
| WBS Raw 数据 | raw_event, source_document | ≥7年 | 只归档，不物理删 |
| 调度/系统日志 | 外部日志系统 | ≥1年 | 可按政策清理 |
| 幂等凭据 | idempotency_receipt | ≥命令关联审计周期 | 可按期清理（≥30天） |
| AI 发现 | ai_*_finding | ≥3年（可审查决策） | 不可随意删除 |
| 临时文件 | /tmp, import_batch | 操作完成后即删 | 可删 |
| Outbox 事件（已完成） | outbox_event(status=COMPLETED) | ≥1年（幂等窗口后） | 可归档 |
| 附件（上传失败/孤儿） | attachment(finalization_status=PENDING, expired) | 超 upload_expires_at 后 | 清理（cleanup_status） |

## 2. 现有不可变性保护

- `audit_event`, `project_master_event`, `loan_master_event`, `source_link` 有 `reject_mutation()` append-only 触发器。
- `ledger_line` 无触发器保护，但 `POSTED` 期间关闭后无法再写入（期间 status 保护）。
- `idempotency_receipt` SUCCEEDED 后无法修改（状态机约束）。

**当前缺口**: `ledger_line` 本身无 append-only 触发器，依赖业务逻辑而非数据库级别保护。

## 3. 合法删除（脱敏）边界

### 适用场景（GDPR / 数据主体删除请求）

对于包含 `actor_id`（可能是个人 ID）的记录：

| 方案 | 影响 | 建议 |
|---|---|---|
| 物理删除 | 破坏账务完整性，违反会计法 | 禁止 |
| 伪匿名化 | 将 actor_id 替换为 sha256(actor_id)；保留交易记录 | 建议采用 |
| 分离 PII | 将姓名/邮箱存于独立用户表，账务只引用 ID | 更佳设计，但需重构 |

当前 `audit_event.actor_id` 和 `journal_entry.created_by/submitted_by` 等字段是文本，直接存储 actor 标识符。若 actor 标识符含 PII，需制定伪匿名化策略。

## 4. 归档策略

### 阶段性归档（建议）

```
热数据（0-2年）：PostgreSQL 主库
温数据（2-7年）：PostgreSQL 分区表（按 accounting_period.period_code 分区）
冷数据（7-10年）：只读对象存储（Parquet + 校验 hash）
```

### 当前分区状态

现有表无分区。`ledger_line` 按期间归档是自然边界（`period_id` FK）。

**建议**: 为 `audit_event` 和 `ledger_line` 添加 RANGE 分区（按 recorded_at / posted_at 年份），最早的分区可 detach 后迁移到只读存储。

## 5. 存储成本观测

目前无存储成本监控。建议：
- 每次关账时记录 `pg_total_relation_size` 到可观测指标（Prometheus 指标或外部表）。
- 对象存储附件：按 tenant 统计 `sum(size_bytes)` FROM `attachment WHERE finalization_status='VERIFIED_CLEAN'`。

## 6. 删除请求流程（建议）

```
1. 法务/合规团队发起 "数据主体删除请求"
2. Owner 确认请求合法性
3. 工程师评估影响范围（哪些表、哪些字段含 PII）
4. 执行伪匿名化脚本（非物理删除）
5. 记录操作到专用 "data_subject_request" 审计表
6. 验证：确认原始值不可检索，交易记录完整
```

## 7. 恢复验证（已有）

P14 已建立 backup/PITR 演练程序（`BACKUP-PITR-RUNBOOK-P14.md`），包含恢复验证步骤。归档数据的恢复需补充：
- 从冷存储恢复 Parquet 到临时 PG 实例的步骤
- 恢复后的 hash 验证程序

## 8. 立即可落地

1. 为 `ledger_line` 添加 append-only 触发器（与 `audit_event` 同模式），消除物理删除风险。
2. 为 `outbox_event(status IN ('COMPLETED','FAILED'))` 超过 90 天的记录创建清理任务（Q13 调度任务）。
3. 为 `attachment` 超时未完成上传（`upload_expires_at < now() AND finalization_status='PENDING'`）添加自动标记为 `cleanup_status='PENDING'` 的调度任务。

## 9. Owner 决策缺口（D-Q04-x）

| ID | 问题 |
|---|---|
| D-Q04-1 | actor_id 是否含 PII？如是，伪匿名化策略如何实施？ |
| D-Q04-2 | 法定保留期是否有当地会计法规特别要求（如中华人民共和国会计法 §30 要求不少于30年）？ |
| D-Q04-3 | 是否采用分区表归档，还是迁移到独立冷存储系统？ |
| D-Q04-4 | 对象存储附件的长期保存服务商和加密方案是否已确定？ |
