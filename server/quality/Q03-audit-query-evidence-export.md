# Q03 — 审计查询与证据导出

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 现有审计数据结构

### 1.1 核心审计表

| 表 | 用途 | 关键字段 | 不可篡改保证 |
|---|---|---|---|
| `audit_event` | 所有写操作记录 | tenant_id, entity_id, event_type, object_type, object_id, action, actor_id, permission_used, request_id, after_hash | append-only 触发器 `reject_mutation()` |
| `project_master_event` | 项目主数据版本链 | object_type, object_id, event_type, snapshot (jsonb), snapshot_hash (sha256) | append-only 触发器 |
| `loan_master_event` | 贷款主数据版本链 | 同上 | append-only 触发器 |
| `ledger_line` | 已过账会计分录 | journal_entry_id, account_code, debit_amount, credit_amount, posted_at | POSTED后通过 SoD 和期间保护 |
| `idempotency_receipt` | 命令幂等证明 | tenant_id, scope, key, request_hash, response_body, actor_id | 不可回滚（SUCCEEDED状态不可更新） |
| `source_link` | 溯源图谱 | link_type, journal_entry_id, attachment_id, source_document_id 等 | append-only 触发器 |
| `outbox_event` | 已发出事件 | aggregate_type, aggregate_id, event_type, payload_hash | 不可篡改（完成后状态固定） |

### 1.2 查询维度覆盖

| 审计维度 | 支持 | 字段/途径 |
|---|---|---|
| 按对象 | ✅ | `audit_event(object_type, object_id)` |
| 按用户/Actor | ✅ | `audit_event(actor_id)` |
| 按时间 | ✅ | `audit_event` 有 `recorded_at`（实际列名：无，检查下方） |
| 按动作 | ✅ | `audit_event(action)` |
| 按来源 | ✅ | `source_link` 溯源图谱 |
| 按审批人 | ✅ | `journal_entry(reviewed_by, approved_by, posted_by)` |
| 按账务影响 | ✅ | `ledger_line` JOIN `journal_entry` JOIN `source_link` |
| 按权限 | ✅ | `audit_event(permission_used)` |

## 2. audit_event 实际列结构（从migration 002）

```sql
audit_event(
  audit_event_id uuid PK,
  tenant_id uuid, entity_id uuid,
  event_type text,            -- e.g. 'JOURNAL_CREATED', 'JOURNAL_POSTED'
  object_type text,           -- 'JOURNAL_ENTRY', 'PERIOD', 'GRANT'...
  object_id uuid,
  action text,                -- 'CREATE', 'SUBMIT', 'POST', 'APPROVE'...
  actor_id text,
  actor_type text,            -- 'USER', 'SYSTEM'
  permission_used text,
  request_id text,            -- correlates to idempotency_key
  correlation_id text,
  idempotency_key text,
  after_hash text,            -- sha256 of post-action state
  recorded_at timestamptz DEFAULT now()
)
```

## 3. 证据导出能力分析

### 3.1 已支持的证据包组件

- JE 完整轨迹: `journal_entry` + `journal_line` + `audit_event(object_id=je_id)` + `source_link(journal_entry_id)`
- Posting 证明: `posting_batch` + `ledger_line` + `idempotency_receipt`
- 附件链: `attachment` + `source_link(attachment_id)` + `audit_event`
- WBS 溯源: `source_document` → `staging_item` → `journal_entry` → `ledger_line`（通过 `source_link`）

### 3.2 缺口

| 缺口 | 说明 | 风险 |
|---|---|---|
| 无导出 API | 无 `/audit/export` 端点；证据导出需直接 DB 查询 | 中 |
| 无证据包 hash | 无法对一组 audit_event 产生不可篡改的汇总摘要 | 中 |
| 隐私屏蔽 | `actor_id`/`reason` 中可能含 PII；无导出时的自动屏蔽 | 高 |
| 分页 | 大 tenant 下 `audit_event` 无光标分页 API | 中 |
| 性能 | `audit_event(object_id)` 索引存在；跨 entity 查询需全扫 | 中 |
| 关账后不可变 | 无 period-scoped 证据快照（关账后 audit_event 仍可追加） | 低 |

## 4. 建议的审计查询 API 路由

```
GET /entities/{entityId}/audit-events
  ?objectType=JOURNAL_ENTRY&objectId={uuid}
  &actorId={actor}&action=POST
  &from={date}&to={date}
  &cursor={opaque}&limit=100
→ {schema_version:'AUDIT_EVENTS_V1', events:[], next_cursor, total_count, hash}

GET /entities/{entityId}/audit-events/{auditEventId}/evidence-bundle
→ {schema_version:'EVIDENCE_BUNDLE_V1', event, object_snapshot, related_links, bundle_hash}
```

## 5. 隐私屏蔽规范（建议）

导出时对以下字段执行 SHA-256 伪匿名化（保留可关联性但隐藏原始值）：
- `actor_id` → `sha256('ACTOR:' || actor_id)` truncate to 16 chars
- `reason` 字段中的 PII — 依赖应用层屏蔽策略

## 6. 立即可落地

1. 为 `audit_event` 补充光标分页查询函数 `refs_list_audit_events(tenant, entity, filters, after_cursor, limit)`。
2. 为 JE 完整证据包添加 `refs_read_journal_evidence_bundle(tenant, entity, je_id)` 读函数（返回 JE + lines + audit + source_link + attachment hash 汇总）。

## 7. Owner 决策缺口（D-Q03-x）

| ID | 问题 |
|---|---|
| D-Q03-1 | 证据导出是否需要加密签名（如 HSM 或证书签名）以满足法规要求？ |
| D-Q03-2 | `actor_id` 是内部系统 ID，是否需要映射到用户真实姓名以供审计员阅读？ |
| D-Q03-3 | 是否需要基于期间的证据快照（关账时固化当期所有 audit_event 为一个 Merkle 根）？ |
