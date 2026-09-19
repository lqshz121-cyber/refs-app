# N21 — 附件对象存储生命周期审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

附件链路设计扎实：租户隔离在**四处**独立强制（key 推导、ref 解析、扫描边界、行级 RLS），病毒扫描**确实 fail-closed**，内容哈希**三重独立校验**，证据行不可删除。

**一个实质安全缺口**：`refs_create_manual_journal` 的附件门禁只要求**租户自有**，**不要求 `VERIFIED_CLEAN`、不按 entity 限定**——即一个未扫描（PENDING）或已判毒（REJECTED）的附件，只要属于同一租户的任意实体，就能满足手工分录的"证据"要求。全库 41 个迁移都要求 `VERIFIED_CLEAN`，唯独最核心的两条命令不要求。

**一个实质运营缺口**：已定稿附件**无保留期、无过期、无清除路径**，且清理队列**无健康读**。

## 2. `attachment` 表与 VERIFIED_CLEAN 约束（逐条取证）

基表 `001:129-147`。`ALTER TABLE attachment` 全库只出现在 003（已核验）。

`VERIFIED_CLEAN` 由**两个迁移的四个条件**共同守卫：

```
-- 001:141
scan_status text NOT NULL DEFAULT 'PENDING' CHECK (scan_status IN ('PENDING','CLEAN','REJECTED','ERROR'))
-- 001:142
finalization_status text NOT NULL DEFAULT 'PENDING' CHECK (finalization_status IN ('PENDING','VERIFIED_CLEAN','REJECTED'))
-- 001:144（无名表级 CHECK）
CHECK ((finalization_status='VERIFIED_CLEAN' AND verified_at IS NOT NULL
        AND finalized_at IS NOT NULL AND scan_status='CLEAN')
       OR finalization_status <> 'VERIFIED_CLEAN')
-- 003:17
ADD CONSTRAINT attachment_verified_entity_ck
  CHECK (finalization_status<>'VERIFIED_CLEAN' OR entity_id IS NOT NULL)
```

即 `VERIFIED_CLEAN ⇒ verified_at ∧ finalized_at ∧ scan_status='CLEAN' ∧ entity_id`。

003 另加 `attachment_reservation_window_ck`（`003:16`）、`cleanup_*` 列族（`003:3-14`），并在迁移时对身份不明的历史 VERIFIED_CLEAN 行**硬失败**（`003:25-29`）。

注意 `001:144` 是**无名约束**，在控制叙述中不便引用——建议后续命名（D-N21-4）。

## 3. 租户隔离（四处独立强制）

1. **Key 推导** `runtime/attachment-storage.mjs:60`：`${prefix}/${safeSegment(tenantId)}/${safeSegment(entityId)}/${objectId}`；`objectId` 为 UUID，或在给定幂等键时为 `sha256(tenantId \0 entityId \0 idempotencyKey)`（`:58`）
2. **Ref 解析** `:40` `parseRef` 拒绝桶外、前缀外、含 `.`/`..`/空段的 ref
3. **扫描边界** `scanner-sidecar/bridge.mjs:9` 独立重算 `expectedPrefix=${prefix}/${tenant_id}/${entity_id}/`，不符 → HTTP **403 Evidence scope mismatch**
4. **行级** RLS `attachment_scope_policy`（`003:32-34`）+ `REVOKE SELECT ON attachment FROM refs_app`（`003:41`）

## 4. 上传流程：直传对象存储（预签名 PUT），非代理

1. `POST .../attachments/reservations` — `accounting-http.mjs:3175-3184`，体字段封闭为 `['name','mediaType','sizeBytes','contentHash']`（`:3177`）
2. `AttachmentEvidenceService.reserve` — `attachment-storage.mjs:194-211`。先幂等恢复（`:197`），再 `storage.reserveUpload`（`:206`）铸造**预签名 PUT URL**（必带 `content-type` 与 `x-amz-meta-sha256` 头，`:61`），最后写行（`:207`）
3. `refs_reserve_attachment` — `003:136-164`。作用域 `ATTACHMENT.CREATE`（`:142`）；元数据门禁 `003:145-148` → **22023**：`size_bytes` 1..**52428800**（50 MiB）、`content_hash` 正则、`storage_ref` 正则、name 1..255 且无 `/` `\`、媒体类型 ∈ {`application/pdf`,`image/png`,`image/jpeg`,`text/csv`}。**上传窗口 15 分钟**（`003:140`）
4. **客户端直接 PUT 字节到 S3/MinIO——内核从不接触字节**
5. `POST .../attachments/{id}/finalize` — `:3191-3195`，空体
6. `refs_request_attachment_finalize` — `003:48-79`。非 pending 或窗口过期 → **55000**（`:67`）
7. `refs_finalize_attachment` — `003:173-206`。**SoD：`actor = uploaded_by` → 'Attachment scanner SoD violation' ERRCODE 42501**（`003:190`）。存储 ref 不符 → **23514**（`:191`）。接受条件 `003:192-193` 要求 `p_scan_clean` ∧ 非空 `scan_ref` ∧ size/hash/media_type 全等 ∧ `storage_version` 非 `pending:*`

基础设施：MinIO `mc mb --with-lock` + `mc version enable`，桶 `refs-evidence`（`compose.attachments.yaml`）。

## 5. 病毒扫描 fail-closed（已核验为结构性保证）

- 侧车 `scanner-sidecar/main.mjs`（仅 HTTPS，要求 TLS key/cert + bearer）、`bridge.mjs`（ClamAV `zINSTREAM`，50 MiB 上限，30s 超时）
- 客户端 `HttpVirusScanner`（`attachment-storage.mjs:186-190`）：构造时即要求 HTTPS + bearer + 私有 CA pinning（`:187`）；有界重试，仅 5xx/429/超时可重试（`:189`）
- **fail-closed 路径**：扫描器不可用 → bridge 返 503 `SCAN_FAILED` → `HttpVirusScanner.scan` 重试后抛 → `finalize`（`:219`）在到达 `kernel.finalizeAttachment` 前即抛。行停留在 `PENDING`
- **不存在**未扫描附件变成 VERIFIED_CLEAN 的路径：`003:192` 要求 `p_scan_clean=true` 且 `p_scan_ref` 非空，`001:144` 要求 `scan_status='CLEAN'`。这是**结构性**而非测试性保证
- PENDING 行 15 分钟后过期，由清理扫掠

## 6. 内容哈希三重校验

1. **bridge 元数据**：`storage.inspect` 比对 `storageVersion`/`sizeBytes`/`contentHash`/`mediaType` → 409 `Evidence metadata mismatch`
2. **bridge 字节**：重新流式读取，边喂 ClamAV 边 `createHash('sha256')`，不符 → 409 `Evidence content hash mismatch`；大小变化 → 409 `Evidence changed during scan`
3. **内核**：`003:192` 比对 hash + size + media_type，不符 ⇒ `REJECTED`

另：`presignPut` 把 `x-amz-meta-sha256` 绑为必需上传头（`:61`）。

## 7. 删除 / 保留 / 过期

**行删除：完全阻断。** `refs_protect_attachment_evidence()`（`003:208-217`）+ 触发器 `attachment_evidence_immutable BEFORE UPDATE OR DELETE`（`003:218`）：`TG_OP='DELETE' OR OLD.finalization_status<>'PENDING'` → **55000**「Attachment evidence is immutable」（`:210`）；任何更新须 `current_setting('refs.attachment_finalize')='authorized'` 否则 **42501**（`:211`）。

**预留过期：已实现**（且是**唯一存在的**生命周期过期）：
- `refs_claim_expired_attachments`（`003:81-103`），权限 `ATTACHMENT.CLEANUP`，limit 1..100
- **候选条件（已核验 `003:89-90`）**：`finalization_status='PENDING' AND upload_expires_at<=clock_timestamp()` 且 `cleanup_status IN('NONE','FAILED','RETAINED')` 或 PENDING 认领超 5 分钟。`FOR UPDATE SKIP LOCKED`（`:91`）
- `refs_complete_attachment_cleanup`（`003:105-127`）：租约缺失/陈旧/他人持有 → **40001**；失败分类须 `error_category IN('STORAGE','RETENTION','INTERNAL')` 否则 22023。成功 → `cleanup_status='COMPLETE'`, `finalization_status='REJECTED'`, `scan_status='ERROR'`；`RETENTION` 失败 → `RETAINED`（对象锁无法清除）
- 对象清除 `purgeAllVersions`（`:81`）：列全部版本含删除标记、逐个删除、**重新列举验证为空**，否则 `STORAGE_PARTIAL_DELETE`；对象锁 403/409/423 → `STORAGE_RETENTION`

**NOT IMPLEMENTED（已核验）：已定稿（VERIFIED_CLEAN）附件的保留/过期/清除。** 清理候选被限制在 `finalization_status='PENDING'`（`003:89`）。无 TTL、无保留排程、无法务保留（legal hold）模型、无已验证证据的清除路径。VERIFIED_CLEAN 的行与其 S3 对象**永久存在**。

## 8. 审计事件

全部进 `audit_event`（`001:608`）并配 `outbox_event`：

| 事件 | 迁移:行 | actor_type | permission_used |
|---|---|---|---|
| `ATTACHMENT_RESERVED` | `003:157-158`（outbox `:160`） | USER | ATTACHMENT.CREATE |
| `ATTACHMENT_FINALIZE_REQUESTED` | `003:71-73`（`:75`） | USER | ATTACHMENT.CREATE |
| `ATTACHMENT_FINALIZED` | `003:199-200`（`:202`） | SERVICE_ACCOUNT | ATTACHMENT.FINALIZE |
| `ATTACHMENT_CLEANUP_CLAIMED` | `003:97-99`（`:100`） | SERVICE_ACCOUNT | ATTACHMENT.CLEANUP |
| `ATTACHMENT_CLEANED` / `_CLEANUP_FAILED` | `003:121-123`（`:124`） | SERVICE_ACCOUNT | ATTACHMENT.CLEANUP |

清理审计/outbox 载荷剥离 `storage_ref` 与 `storage_version`（`003:99,101`）。权限种子 `003:36-39`：`ATTACHMENT.CREATE`(MEDIUM/`ATTACHMENT_UPLOADER`)、`.FINALIZE`(HIGH/`ATTACHMENT_SCANNER`)、`.CLEANUP`(HIGH/`ATTACHMENT_CLEANER`)。

## 9. 中途失败的补偿与恢复

- **预签名/写行次序**：按设计安全——预签名不创建对象。`attachment-storage.mjs:208-209` 注释明示"失败重试绝不可删除更早一次成功使用同一 key 后上传的证据"
- **预留恢复**：`303_attachment_reservation_recovery.sql` 的 `refs_find_attachment_reservation`（`303:3`）。他人 receipt → 42501（`:23`）；未完成 receipt → 55000（`:26`）；同键不同元数据 → **23505**（`:38`）。服务在 `reserve` 中先用它（`:196-204`）：已 VERIFIED_CLEAN → 幂等返回；PENDING 且 `cleanup_status='NONE'` → `resumeUpload` 重发预签名；其他 → `ATTACHMENT_RESERVATION_CLOSED` → HTTP 409
- **孤儿对象/孤儿行**：均由过期清理扫掠；`cleanup_attempts` 有界；陈旧租约 5 分钟回收
- **对象锁不可删**：终态 `RETAINED` + `cleanup_error_category='RETENTION'`，记录而非无限重试
- **WBS Final-1 孤儿标记**：`putOrphanLifecycleMarker`（`:150-162`）在 `_ops/` 写 `WBS_FINAL1_ORPHAN_RETAINED_V1` JSON 标记，带 COMPLIANCE 对象锁与保留期，并逐头 HEAD 校验。这是唯一的显式补偿记录机制

**缺口**：清理 worker 是独立长驻进程（`runtime/start-attachment-cleanup-worker.mjs`）。若未运行，过期预留与孤儿对象会静默堆积——且与 outbox 不同，**附件清理没有任何健康/积压读**（无 433 的对应物）。

## 10. 附件证据门禁的强弱不一（核心安全发现）

**已核验计数**：全库断言 `finalization_status='VERIFIED_CLEAN'` 的迁移 **41 个**（048、067、092、094、096、097、100、101、118、139、174、180、181、209、210、223、254、269 等）。

而**只有两处**使用弱门禁，且恰是最核心的两条：

```
-- 002_accounting_runtime.sql:1041-1043（refs_create_manual_journal）
IF COALESCE(cardinality(p_attachment_ids),0)=0 OR COALESCE(cardinality(p_attachment_ids),0)<>(
  SELECT count(DISTINCT a.attachment_id) FROM attachment a
   WHERE a.tenant_id=p_tenant AND a.attachment_id=ANY(p_attachment_ids)
) THEN RAISE EXCEPTION 'Manual journal requires tenant-owned attachment evidence' USING ERRCODE='23503'; END IF;

-- 067_reconciliation_adjustment_draft.sql:121（refs_create_reconciliation_adjustment）
... 'Reconciliation adjustment requires tenant-owned attachment evidence' ... ERRCODE='23503'
```

**该检查只要求租户自有**：
- 不要求 `finalization_status='VERIFIED_CLEAN'` → 未扫描（PENDING）或已判毒（REJECTED）的附件可通过
- 不按 `entity_id` 限定 → 租户内**任意实体**的附件可通过

对照：`280_ai_manual_journal_verified_attachment_support.sql` 把**侦测性**控制收紧到了 verified-clean（`280:11-14`，理由串明示"no verified-clean retained attachment; source-document lineage alone is not supporting attachment evidence"，`280:30` fail-closed），但 `002:1043` 的**预防性**控制未同步收紧。

HTTP 侧只做形状校验：`requireAttachmentIds`（`accounting-http.mjs:290`）1..25 个唯一 UUID，`INVALID_ATTACHMENT_IDS`(400)。

## 11. 缺口清单

1. **`refs_create_manual_journal`（`002:1041-1043`）与 `refs_create_reconciliation_adjustment`（`067:121`）的附件门禁不要求 VERIFIED_CLEAN、不按 entity 限定**
2. 已定稿附件无保留/过期/清除路径（`003:89` 只覆盖 PENDING）
3. 附件清理队列无健康/积压读（无 433 对应物）
4. 媒体类型白名单硬编码在三处须同步（`003:146`、`303:13`、`attachment-storage.mjs` 的预留校验），无共享目录表
5. `001:144` 是无名约束，控制叙述中不便引用

## 12. 测试覆盖

`attachment-storage.test.mjs`、`attachment-cleanup-worker.test.mjs`、`attachment-containers.test.mjs`（用 `compose.attachments.yaml` 起真容器）、`wbs-payable-exact-attachment-binding-contract`、`wbs-payable-row-bound-attachment-contract`、`credit-adjustment-attachment-evidence`、`cash-transfer-attachment-candidates{,-pagination}-contract`、`postgres-kernel.test.mjs`、`secret-scan.test.mjs`。

**诚实边界**：不存在以"扫描器 fail-closed"命名的专用测试。该性质是**结构性的**（`003:192` + `001:144` 联合保证），而非由某个测试断言。本文档据此表述，不得写成"已有测试覆盖 fail-closed"。

## 13. Owner 决策

- **D-N21-1（优先）附件证据门禁收紧**。是否前向修改 `002:1041-1043` 与 `067:121`，要求 `finalization_status='VERIFIED_CLEAN'` 且 `entity_id=p_entity`？**影响评估必须先做**：需查询现存 POSTED 手工分录中引用了非 VERIFIED_CLEAN 或跨实体附件的数量；若存量非零，收紧会使这些分录的历史证据链在新规则下不成立，须决定是追认还是补证。**本会话不改账、不查真实账，故此项停在方案。**
- **D-N21-2 已定稿附件保留策略**。是否引入保留期 + 法务保留 + 到期清除？须先由 Owner 给出各证据类别的法定保留年限。
- **D-N21-3** 是否为附件清理队列补健康读（对齐 433 的形状）。
- **D-N21-4** 是否为 `001:144` 的无名 CHECK 命名（纯前向、零行为变更）。
- **D-N21-5** 媒体类型白名单是否抽为共享目录表，消除三处同步风险。
