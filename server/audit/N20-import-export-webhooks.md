# N20 — 导入 / 导出 / Webhooks 审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

导入侧（幂等、异常队列、历史）基本完备；**导出侧与 webhook 投递侧存在实质缺口**：

- 真正吐字节的两个导出面不受导出权限管辖，也不留历史行
- webhook **无 HMAC 签名**，只有静态 bearer；`webhook_subscription` 控制面**从不被调度器读取**；`webhook_delivery_history` **零写入方**
- outbox `FAILED` 是终态，**无重投路径**

## 2. 导入管线

### 2.1 通用连接器管线（001）

| 表 | 行 | 阶段 |
|---|---|---|
| `sync_cursor` | `001:64-75` | 游标 |
| `import_batch` | `001:77-99` | **导入运行表**。`idempotency_key`、`request_hash`、`status(import_status)`、`row_count`、`retry_count`、`error_code`。`entity_id` 由 `002:583` 加入、`002:601` 置 NOT NULL |
| `raw_event` | `001:101-127` | RAW。`payload_hash ~ '^sha256:[0-9a-f]{64}$'`、`payload_ref ~ '^(object\|s3)://'`、`is_current` |
| `source_document`/`_line` | `001:149`/`001:179` | NORMALIZED |
| `staging_item` | `001:299-318` | STAGING，19 态 `source_status` 枚举（`001:9-15`） |

`import_status` 枚举 `001:7`：`RECEIVED, RUNNING, SUCCEEDED, FAILED, PARTIAL`。

### 2.2 WBS Raw→Normalized→Staging（058/061/062）

**不是三张表，而是一张逐行 trace 表上的三个 jsonb 列**：`wbs_inbound_row` — `058:7-12`，含 `raw jsonb NOT NULL CHECK(jsonb_typeof='object')`、`normalized jsonb`、`outcome jsonb`，加 `outcome_kind CHECK(IN('STAGING','EXCEPTION'))`（`058:9-10`）。`UNIQUE(tenant_id,entity_id,receipt_id,source_record_id,source_version)`（`058:11`）。

写入 `refs_persist_wbs_inbound_rows` — `058:18-35`；`062:18` 收紧（normalized 必须回声 `receipt_hash`/`receipt_ref`/`source_record_id`/`source_version`）。下游门禁要求 `outcome_kind='STAGING' AND outcome->>'stage'='STAGING_REVIEW_REQUIRED'`（094:182、099:61、100:149、101:58、132:76、156:90）。

两表均以 `reject_mutation()` 追加写（`058:16-17`），RLS `058:13-15`。

### 2.3 导入幂等 — 三重独立机制（已核验）

1. `import_batch UNIQUE(tenant_id,connector_code,source_module,source_entity_id,idempotency_key)` — `001:97`；`request_hash` NOT NULL 正则校验 `001:82`
2. `raw_event UNIQUE(...source_record_id,source_version)` — `001:121`；偏唯一 `raw_event_one_current_uq ... WHERE is_current` — `001:126-128`
3. `idempotency_receipt`（`001:592`）。WBS 路径在 `058:24-26` 预留 scope `'WBS_INBOUND:'||p_entity`，哈希不符抛 **23505**；重放返回 `response_body || {'idempotent':true}`

## 3. 导入历史与异常队列

### 3.1 `import_export_history_job` — `389:14-25`

`job_type CHECK IN('IMPORT','EXPORT')`、`status CHECK IN('SUCCEEDED','FAILED','PARTIAL')`、`content_hash`、`failure_code`。跨字段 CHECK `389:24`：SUCCEEDED ⇒ `failure_code IS NULL`；FAILED/PARTIAL ⇒ NOT NULL。追加写 `389:30`，RLS `389:28`。

读：`refs_read_import_export_history`（`389:41`，`IMPORT_EXPORT_HISTORY_PAGE_V1`，keyset，`action_flags{can_import:false,can_export:false,can_post:false}` 于 `389:49`）。HTTP `GET .../import-export-history` — `accounting-http.mjs:517-527`。

**缺口**：389 自陈"History is evidence only"（`389:3-4`）。`refs_project_import_batch_history`（`389:76-89`）须**手动调用**且受 `DATA.EXCHANGE.HISTORY.VIEW`（一个**读**权限）把守。全库对 `import_export_history_job` 的写入只有 `389:66`（导出）与 `389:85`（手动投影）——**没有任何触发器或调用点在 batch 完成时自动投影**。

### 3.2 `accounting_exception` — `001:320-342`

`status (exception_status: OPEN/IN_REVIEW/RESOLVED/WAIVED)`、`severity CHECK IN('LOW','MEDIUM','HIGH','CRITICAL')`。CHECK `001:338` 要求 `num_nonnulls(raw_event_id, source_document_id, staging_item_id) >= 1`；`001:339` 要求 RESOLVED 必须有 `resolved_by`+`resolved_at`。去重偏唯一索引 `accounting_exception_active_uq` — `001:341-343`（`WHERE status IN('OPEN','IN_REVIEW')`）。

**失败行可检视：是。重新驱动：基本没有。**
- 写入方仅 `149:321`、`156:122`
- 唯一的解决器是单一领域专用的：`157:84`，只对 `exception_code='PROPERTY_RENT_PRODUCER_UNAVAILABLE'` 置 RESOLVED，缺失/变更抛 40001
- **NOT IMPLEMENTED**：通用的 resolve / waive / reprocess 命令，以及任何通用"重驱失败行"路径。`wbs_inbound_row` 追加写（`058:17`），重驱必须是**新 receipt + 新 `source_version`**

## 4. 导出 — 权限与出口脱钩（实质缺口）

全库仅有**一个**导出权限：**`DATA.EXCHANGE.POSTED_LEDGER.EXPORT`**（`389:7`，INTEGRATION/MEDIUM/`POSTED_LEDGER_EXPORT`；authority class `EXPORT` 于 `389:11`）。

| 导出面 | 权限 | 吐字节 | 留历史 |
|---|---|---|---|
| 已过账台账导出历史 `refs_record_posted_ledger_export_history` `389:54-72`，HTTP `:528-535` | ✅ `DATA.EXCHANGE.POSTED_LEDGER.EXPORT`（`389:58`） | ❌ **仅记录元数据，不返回台账行** | ✅ |
| 分录上传 CSV `397` + `accounting-http.mjs:940-949` | ❌ 仅 `kernel.readJournalUploadRows` 自身断言 | ✅ `content-disposition: attachment` | ❌ |
| 财报快照 CSV `accounting-http.mjs:1730-1741` | ❌ | ✅ | ❌ |

**结论：受权限管辖的命令不吐字节；吐字节的两个面不受导出权限管辖且不留历史行。**

### 4.1 水印与脱敏 — NOT IMPLEMENTED

- **水印**：全库 `watermark` 命中仅为会计语义（`296:82,191,210-211` 的 `posted_watermark`/`population_watermark`）。无文档/导出水印
- **脱敏存在但不在导出路径上**：`refs_rule_redact_text` 用于 `369:64-80`；凭据形 actor 脱敏用于 `294:167,171`。`buildJournalUploadCsv`（`:947`）与 `buildFinancialStatementCsv`（`:1740`）**均不做脱敏**

## 5. Webhooks

### 5.1 outbox 表

`outbox_event` — `001:630-645`。`status outbox_status (PENDING/PUBLISHED/FAILED)`、`payload_hash`、`attempt_count`、`available_at`、`last_error`，`UNIQUE(tenant_id,aggregate_type,aggregate_id,event_type,payload_hash)`（`001:644`，去重键）。`002:578-580` 加 `entity_id`；`002:652-655` 加 `locked_by/locked_at` + `outbox_lock_pair_ck`。

### 5.2 调度器位置（纠正常见误解）

`/tmp/gw2/server/outbox-consumer/` 是**接收端**——独立 HTTP 服务，自带隔离数据库（`server.mjs:9-34`；`contract.mjs:24-33` 的 `readConfig` 在检测到任何会计库 URL 环境变量时拒绝启动）。

**真正的调度器是 `runtime/outbox-dispatcher.mjs`**（101 行）：`HttpOutboxPublisher.publish`（`:33`）POST 时带 `authorization: Bearer <token>`、`idempotency-key: <outbox_event_id>`、`x-refs-payload-hash: <payload_hash>`（**`:41`**）；`redirect:'error'`；生产必须是无凭据 HTTPS（`:28`）。`OutboxDispatchService.runOnce`（`:73-99`）经 `claimOutboxV3`→publish→`completeOutboxV2`。

### 5.3 重试与死信（279）

- `refs_claim_outbox_v2(...p_limit DEFAULT 100, p_lease_seconds DEFAULT 300)` — `279:3-39`。作用域 42501（`:12-14`）；参数校验 22023（`:15-18`，limit 1..500、lease 5..3600）。租约回收 `279:28`；`FOR UPDATE SKIP LOCKED`（`:30`）；claim 时 `attempt_count+1`（`:34`）
- **退避公式 `279:85`**：`clock_timestamp() + make_interval(secs => LEAST(86400, p_retry_base_seconds * (2^LEAST(claimed.attempt_count-1,14))::integer))` —— 指数底 2、指数封顶 14、延迟封顶 86400 秒
- **死信 `279:86-88`**：不可重试、或 `attempt_count >= p_max_attempts`（默认 8）→ `status='FAILED'`
- 传输层可重试分类 `runtime/outbox-dispatcher.mjs:43`：HTTP 408/425/429/≥500 → `OUTBOX_PUBLISH_RETRYABLE`，其余 → `OUTBOX_PUBLISH_REJECTED`（不可重试，直入 FAILED）
- `299` 以 `refs_claim_outbox_v3` 取代（精确 `p_entity_ids` + `p_expected_grant_versions`，claim 前 `FOR SHARE OF grant_set`），并回收 v2 对 `refs_app` 的授权

**缺口 — 无死信重投（已核验）**：全库 `UPDATE outbox_event` 共 5 处（002:1380、002:1392、279:33、279:91、299:97），**无任何函数把 FAILED 移回 PENDING**，无重排/重放路由。`FAILED` 是终态。

### 5.4 投递签名 — 无 HMAC（实质缺口）

认证只有**静态共享 bearer**：`runtime/outbox-dispatcher.mjs:41` 发送 `authorization: Bearer ${token}`；消费端以 `timingSafeEqual(sha256(header), sha256('Bearer '+token))` 校验（`outbox-consumer/contract.mjs:34-38`）。**无 HMAC、无签名头、无时间戳/防重放头。**

唯一的完整性头是 `idempotency-key` 与 `x-refs-payload-hash`，在 `outbox-consumer/contract.mjs:17` 交叉校验（`OUTBOX_HEADER_MISMATCH`），且 payload 哈希在 SQL 侧按规范 jsonb 重算（`repository.mjs:11-15`）。

**脱节**：`webhook_subscription.signing_key_reference` 与 `signing_key_fingerprint`（`387:25-26`）、`event_types text[]`（`387:24`）**无任何消费方**。`runtime/outbox-dispatcher.mjs` 只有一个硬编码 endpoint/token，从不读 `webhook_subscription`。387 自陈（`387:3-5`）"this migration never sends a network request"。

### 5.5 webhook 订阅控制面（387）

权限 `387:6-12`：`INTEGRATION.WEBHOOK.{VIEW,CREATE,SUBMIT,APPROVE,SUSPEND}`。`webhook_subscription` `387:17-37`，含 **SSRF 防护** `387:22`（要求 DNS 名，拒绝数字/IPv6 形、`localhost`、`.local`/`.internal`/`.test`）。状态机 `DRAFT(0)→PENDING_APPROVAL(1)→ACTIVE(2)→SUSPENDED(3)`，SoD CHECK `387:32`。转换冲突/SoD 违规 → **40001**（`387:89`）。

**`webhook_delivery_history`（`387:44-48`）零写入方（已核验：全库 `.sql`/`.mjs` 中 `INSERT INTO webhook_delivery_history` 命中 0）。** 387:42-43 自陈"written only by a future dedicated service command"。**逐次投递审计链在当前构建中永久为空。**

### 5.6 outbox 健康读（433）

权限 `OPS.OUTBOX.VIEW`（`433:19-21`，OPS/LOW/READ）；索引 `outbox_event_health_idx(tenant_id,entity_id,status,available_at)`（`433:23`）。`refs_read_outbox_health(p_tenant,p_entity,p_stale_minutes DEFAULT 15)` — `433:25`，STABLE SECURITY DEFINER，`stale_minutes` 1..10080 否则 22023。

返回 `schema_version='OUTBOX_HEALTH_V1'`（**`433:70`**）、`accounting_authority:'NONE'`、`can_dispatch:false`、`can_delete:false`；`totals`（`433:34-49`）；`by_event_type`（`433:51-60`）；`oldest_unpublished` LIMIT 20（`433:63-68`，**只含身份 + payload_hash + `left(last_error,200)`，从不含 payload**）；`backlog_state` `433:76-80`（`DRAINED`/`FAILED_EVENTS_PRESENT`/`STALE_BACKLOG`/`PENDING_WITHIN_WINDOW`）。

HTTP `GET .../ops/outbox-health?staleMinutes=` — `:2630-2640`，含字面 `JSON.stringify(result).includes('"payload":')` 检查（`:2638`）→ 502。

迁移表头 `433:3-13` 记录：staging worker 自 2026-09-02 起处于 Suspended，积压无人观测——这是本项的审计背景。

## 6. 缺口清单

1. webhook 投递无 HMAC/签名，仅静态 bearer
2. `webhook_subscription` 从不被调度器读取；`event_types`/`endpoint_*`/`signing_key_*` 对实际投递是装饰性的
3. `webhook_delivery_history` 无写入方 → 无逐次投递审计
4. outbox `FAILED` 终态，无重投函数或路由
5. 无通用异常 resolve/waive/reprocess 命令，仅 `157:84` 一个硬编码领域解决器
6. `import_export_history_job` 不会从 `import_batch` 自动投影
7. 吐字节的两个导出面在 `DATA.EXCHANGE.POSTED_LEDGER.EXPORT` 之外，且不留历史行
8. 无导出水印；导出路径不做脱敏

## 7. 测试覆盖

`outbox-health-{postgres,http}`、`outbox-dispatch-retry-279-contract`、`outbox-dispatch-scope-299-contract`、`outbox-dispatcher`、`outbox-consumer`、`outbox-dispatch-worker-hang-recovery`、`webhook-subscription-{migration-contract,http}`、`import-export-history-{contract,http}`、`journal-upload-export`、`financial-statement-export`、`wbs-test-import-*`、`wbs-import-leak-guard`、`accounting-startup:61`（就绪门禁）。

注意 `webhook-subscription-migration-contract.test.mjs:7` 是**对迁移文件的文本匹配**测试，非行为测试。

## 8. Owner 决策

- **D-N20-1 webhook 签名**。是否为投递增加 HMAC-SHA256 签名头 + 时间戳防重放，并让调度器真正读取 `webhook_subscription`（endpoint、event_types、signing_key）？当前静态 bearer 意味着任何拿到该 token 的一方都能冒充 REFS 向消费端投递。
- **D-N20-2 死信重投**。是否新增受控 requeue 命令（FAILED→PENDING，需权限 + 审计 + 次数上限）？
- **D-N20-3 导出治理**。分录上传 CSV 与财报快照 CSV 是否纳入 `DATA.EXCHANGE.POSTED_LEDGER.EXPORT`（或新建导出权限）并强制写 `import_export_history_job`？这会改变现有调用方的权限要求。
- **D-N20-4** 是否需要通用异常处置命令（resolve/waive/重驱）。重驱须明确：新 receipt + 新 source_version 的语义由谁承担。
- **D-N20-5** `webhook_delivery_history` 是补写入方还是先移除（当前是永远为空的审计表，比没有更具误导性）。
