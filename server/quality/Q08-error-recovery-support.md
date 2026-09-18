# Q08 — 错误恢复与用户支持面

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. API 错误分类体系（现状）

### 1.1 HTTP 状态码映射（已实现）

| PG 错误码 | HTTP 状态 | 语义 |
|---|---|---|
| 42501 | 403 | 权限拒绝 / SoD 违规 |
| P0002 | 404 | 对象不存在 |
| 23505 | 409 | 幂等键冲突（不同请求体） |
| 23514 | 422 | 业务规则拒绝（余额、会计约束） |
| 55000 | 423 | 期间锁定（CLOSED 期间） / 审批状态不符 |
| 40001 | 409 | 版本/修订冲突（并发乐观锁） |
| 22023 | 400 | 输入格式/有效性错误 |
| 23503 | 422 | 附件不存在/跨租户 |
| 网络超时 | 502/503 | 上游不可达 |

### 1.2 Error Response 格式（已实现 Problem JSON RFC 7807）

```json
{
  "type": "urn:refs:error:BUSINESS_RULE_VIOLATION",
  "title": "422 Unprocessable Entity",
  "status": 422,
  "detail": "Manual journal requires tenant-owned attachment evidence",
  "instance": "/api/v1/entities/{id}/manual-journals"
}
```

### 1.3 缺口

| 问题 | 位置 | 风险 |
|---|---|---|
| `detail` 是英文技术消息，面向用户不友好 | Problem JSON | 中 |
| 无 `request_id` / `correlation_id` 字段 | Problem JSON | 高（支持难以追踪） |
| 无错误码（code）字段 | Problem JSON | 中（前端无法程序化处理） |
| 503 时暴露内部异常消息 | kernel-repository.mjs | 高（安全风险） |

## 2. Request Correlation ID

**现状**: `idempotency_key` 被复用为 `correlation_id`（见 `audit_event`），但 HTTP 响应未暴露。

**建议**:
1. 在 HTTP 请求中添加 `X-Request-Id` 头（或用 `Idempotency-Key`）
2. 在所有 API 响应中返回 `X-Request-Id` 响应头
3. 在 Problem JSON 中添加 `"requestId": "..."` 字段

```typescript
// 在 accounting-http.mjs 路由中间件
const requestId = req.headers['idempotency-key'] ?? crypto.randomUUID();
res.setHeader('X-Request-Id', requestId);
// 传入 kernel 作为 correlation_id
```

## 3. 重试提示

| 错误类型 | 是否可重试 | 建议提示 |
|---|---|---|
| 409 版本冲突 | ✅ 自动重试 | "操作被另一会话修改，已自动重试" |
| 503 上游不可达 | ✅ 稍后重试 | "系统暂时不可用，请稍后重试" |
| 409 幂等冲突 | ❌ 不可重试 | "相同操作已提交，请勿重复提交" |
| 422 业务拒绝 | ❌ 不可重试 | 显示具体原因 |
| 423 期间锁定 | ❌ 不可重试 | "当前期间已关闭，请选择开放期间" |

**当前内核重试**(`withSerializableRetry`)已处理 `40001` 并发冲突，对用户透明。UI 层无需处理 40001。

## 4. 草稿恢复

JE 创建支持草稿（status=DRAFT），但：

- 网络中断时，已填写的 JE 表单数据是否保存到 `localStorage`？→ **未发现实现**
- 重新进入 JE 创建页是否提示"恢复草稿"？→ **未发现实现**

**建议**:
```typescript
// JE 表单组件
const DRAFT_KEY = `je-draft-${entityId}`;
useEffect(() => {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(formState));
}, [formState]);
// 进入时检测草稿
const savedDraft = localStorage.getItem(DRAFT_KEY);
if (savedDraft) showRestorePrompt();
```

## 5. 导入失败下载

WBS 导入失败时，用户需要知道哪些行失败及原因：

**现状**: `import_batch` 表存在，但无 "失败行下载 API"。

**建议**:
```
GET /entities/{entityId}/import-batches/{batchId}/errors
→ Content-Type: text/csv
→ 包含：row_number, raw_data, error_code, error_message
```

## 6. 支持包（Support Bundle）

**建议**: 提供 `POST /support/bundle` 端点，返回：
- 最近 100 条 audit_event（当前用户）
- 最近 10 条 outbox_event（失败）
- 当前 outbox health
- 当前期间状态

以上数据 **脱敏**（移除 PII，保留 actor_id hash）。

## 7. 技术异常隐藏

**现状**: 503 响应可能暴露 PostgreSQL 内部错误消息（如连接池错误信息）。

**修复**:
```javascript
// kernel-repository.mjs revokeOnFailure
} catch (error) {
  if (error.code === 'POOL_EXHAUSTED' || error.code === 'CONNECTION_REFUSED') {
    throw Object.assign(new Error('Service temporarily unavailable'), {code: '503', status: 503});
  }
  throw error; // 已知业务错误码原样抛出
}
```

## 8. 立即可落地

1. **Problem JSON 添加 requestId**: 所有 Problem JSON 响应增加 `"requestId"` 字段（来自 `Idempotency-Key` 头）。
2. **503 技术消息屏蔽**: HTTP 层统一捕获未知错误，返回通用 503 而非原始异常。
3. **错误码到用户友好消息映射表**: `src/constants/error-messages.ts`。

## 9. Owner 决策缺口（D-Q08-x）

| ID | 问题 |
|---|---|
| D-Q08-1 | 是否需要在 UI 提供"联系支持"功能并自动生成支持包？ |
| D-Q08-2 | 草稿是否应在服务端持久化（当前只有 DRAFT 状态的 JE，无"表单草稿"概念）？ |
