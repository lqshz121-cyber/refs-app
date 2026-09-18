# Q13 — 任务调度与批处理可观测性

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 现有调度任务清单

### 1.1 从代码中识别的调度相关组件

| 任务 | 文件/表 | 调度方式 | 状态 |
|---|---|---|---|
| Outbox 事件派发 | `outbox-consumer/` | 持续轮询 | ✅ 独立服务 |
| 附件清理 | `attachment(cleanup_*)` | 未确认调度器 | ⚠️ 列存在，无调度 |
| WBS 自动对账 | `ai-wbs-payable-draft-proposal` | 未确认 | ⚠️ |
| AI 分析批处理 | `ai-accounting-decision-controller-scan.mjs` | 未确认 | ⚠️ |
| 固定资产折旧 | `fixed_asset_depreciation_binding` | 未确认 | ⚠️ |
| 保险预付摊销 | `insurance_prepaid_amortization_*` | 未确认 | ⚠️ |
| 报表生成 | `financial_statement_snapshot_*` | 按需 | ⚠️ |
| PITR 备份 | 外部（P14 Runbook） | Cron（建议每小时） | 未集成 |

### 1.2 Outbox 消费者（最完整的调度实现）

Outbox consumer 是独立进程，设计原则：
- 幂等：每个 outbox_event 有唯一 `outbox_event_id`，处理后标记 `COMPLETED`
- 重试：`retry_count` 字段，最大重试次数后标记 `FAILED`
- 死信：`status='FAILED'` 的事件为死信队列
- 锁：`refs_claim_outbox` 函数使用 `FOR UPDATE SKIP LOCKED` 避免并发竞争

**已有监控**: `readOutboxHealth` 返回 `{backlog_state, totals:{pending_count, failed_count, stale_pending_count}}`

## 2. 调度任务可观测性缺口

| 任务 | 锁机制 | 幂等 | 重试 | 死信 | 历史记录 | 告警 | 人工重跑 |
|---|---|---|---|---|---|---|---|
| Outbox 派发 | ✅ SKIP LOCKED | ✅ | ✅ retry_count | ✅ FAILED | ✅ outbox_event | ⚠️ outbox health | ⚠️ 无 UI |
| 附件清理 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 折旧计算 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| AI 批处理 | ❌ | 部分(decision_id) | ❌ | ❌ | `ai_accounting_decision` | ❌ | ❌ |

## 3. 调度任务设计规范（建议）

### 3.1 幂等锁模式

```sql
-- 所有批处理任务使用此模式
SELECT * FROM scheduled_task_lock
WHERE task_name = 'DEPRECIATION_RUN'
  AND period_id = $1
  AND status NOT IN ('SUCCEEDED', 'FAILED')
FOR UPDATE SKIP LOCKED;
-- 无行：安全执行
-- 有行：跳过（另一进程在处理）
```

### 3.2 执行历史表（建议）

```sql
CREATE TABLE scheduled_task_run(
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_name text NOT NULL,
  tenant_id uuid,
  entity_id uuid,
  period_id uuid,
  status text NOT NULL DEFAULT 'RUNNING' CHECK(status IN('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  items_processed integer,
  items_failed integer,
  error_detail text,
  triggered_by text NOT NULL  -- 'CRON', 'MANUAL', 'OUTBOX'
);
```

### 3.3 告警规则（建议）

| 条件 | 告警级别 | 通知渠道 |
|---|---|---|
| outbox `STALE_BACKLOG` (stale_pending_count > 0) | WARNING | Slack/Email |
| outbox `FAILED_EVENTS_PRESENT` (failed_count > 0) | CRITICAL | PagerDuty |
| 折旧任务未在期间关账前完成 | WARNING | Email |
| 附件清理失败超过 N 次 | INFO | Slack |
| scheduled_task_run 连续 FAILED 3 次 | CRITICAL | PagerDuty |

## 4. 人工重跑界面（建议）

```
POST /admin/tasks/{taskName}/run
  Authorization: Bearer {admin_token}
  Body: {tenantId, entityId, periodId, reason}
→ {run_id, status: 'RUNNING', started_at}

GET /admin/tasks/{taskName}/runs?limit=20
→ {runs: [{run_id, status, started_at, completed_at, items_processed}]}
```

## 5. Outbox 死信复处理

```
POST /admin/outbox/retry-failed
  Body: {tenantId, entityId, maxItems: 100}
→ {requeued: 5, errors: []}
```

当前 `refs_complete_outbox` 函数可将 FAILED 标记回 PENDING 以重试，但无 API 端点。

## 6. 立即可落地

1. **Outbox 死信复处理 API**: 添加 `POST /entities/{entityId}/outbox/retry-failed` 端点（需 `OPS.OUTBOX.VIEW` 权限）。
2. **折旧/摊销任务锁**: 为 `fixed_asset_depreciation_binding` 创建流程锁（类似 outbox claim 模式），防止同一期间重复执行。
3. **附件清理任务调度**: 每天 UTC 02:00 运行 `UPDATE attachment SET cleanup_status='PENDING' WHERE finalization_status='PENDING' AND upload_expires_at < now() - interval '1 day'`。

## 7. Owner 决策缺口（D-Q13-x）

| ID | 问题 |
|---|---|
| D-Q13-1 | 调度器使用 cron（OS 级）还是应用内调度器（如 `node-cron`）？还是外部调度服务？ |
| D-Q13-2 | 折旧/摊销任务是否需要在期间关账前强制完成（作为关账就绪检查）？ |
| D-Q13-3 | 人工重跑界面是否需要 UI，还是仅 API 即可？ |
