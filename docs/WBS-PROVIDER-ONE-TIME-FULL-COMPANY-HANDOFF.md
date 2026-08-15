# WBS → REFS 全公司一次性交付与上线清单

状态日期：2026-08-15
目标：一次性准备好全公司、全年度、全业务域的 Provider-Signed 交付能力；先完成一个公司样本验收，再按同一合同批量接收全部公司。本文不包含任何密钥值。

## 1. 当前已具备

- REFS 已实现 Provider-Signed Payable 准入、签名 Bank 准入、不可变来源/哈希/版本、重放防护和幂等。
- 已实现 Payable → Review → Draft JE → Submit → Review → Approve → Poster-only Post → GL/TB/财报/AP Aging。
- 已实现 Bank signed source → Match/Unmatch → Reconciliation → Adjustment Draft → Post → Clear → Review/Sign-off/Reopen → GL/TB/报表。
- PostgreSQL 15/16/18 的权威门禁已覆盖上述核心链路。
- Provider trust pin 已收到并通过 Ed25519 SPKI SHA-256 核验：`sha256:45a2d6dc752af0281ae64eb835b12bf2da9997cb3cc5167bffd35c71e22c1347`。
- 独立 Render integrations Blueprint 已进入主线；健康的 Stage1 API 保持只读/关闭 signed ingest，不作为真实签名准入服务。

上述内容证明代码合同已具备，不等于 Provider 生产数据已经入库或已过账。

## 2. 各方只需一次性提供的内容

### 2.1 WBS / Provider owner

#### A. 全公司目录

从 WBS 只读主数据生成一份版本化目录，每行至少包含：

- immutable `company_code`
- WBS company/accountbook ID
- company legal/display name
- active/inactive 状态
- active account count
- 2026 每个业务域的最早/最晚日期、行数、控制总额
- 目录生成时间、源表版本/快照标识、目录 SHA-256

该目录只是交付清单，不自动成为 REFS 授权映射。REFS business owner 必须逐公司批准 entity ↔ company_code。

#### B. 每个公司、每个业务域的签名交付

业务域至少覆盖：

1. Payables
2. Accounts Receivable
3. Bank Statements / Transactions
4. AutoRec
5. Journals
6. Cost / Construction / CWIP
7. Insurance / Prepaid
8. Property Operations / Rent

每个包必须是单一 tenant、单一 entity、单一 company_code；禁止混公司响应后由 REFS 前端过滤。

每个 Payable/通用 snapshot 交付四件原件：

- `receipt.json`
- `request.raw`
- `response.raw`
- `package.json`（含 detached Ed25519 signature）

Bank 使用 `WBS_SIGNED_BANK_ADMISSION_V1` 的签名 statement delivery/manifest，并绑定已准入的生产 snapshot；不能拿 Payable 四件套替代。

每个域还必须提供：

- `date_from` / `date_to` 的原生 server-side 范围与精确回显
- PRIMARY_KEY_SEEK、COMPLETE、snapshot consistency 证明
- row_count、first/last primary key、content hash
- 控制总额（数量、币种、借贷/金额合计）
- full snapshot、后续 delta、删除/作废 tombstone 语义
- 数据字典、主键、外键、关联基数和 nullable 约束
- 附件原件/对象版本/content hash（需要会计审核的行）

#### C. 运行身份与密钥生命周期

- dedicated OIDC M2M access token；其 `sub` 必须稳定并提供给 REFS 作为 `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID`
- token 的 issuer、audience 和 tenant claim 必须符合 REFS OIDC 合同
- key rotation 提前通知；旧 key 保留验签窗口
- revocation/compromise 联系人和生效时间
- receipt 有效期不超过 15 分钟；生产正向准入必须在过期前完成

### 2.2 REFS business owner

- 批准每个 REFS entity UUID ↔ 单一 WBS immutable company_code 映射；禁止仅靠名称匹配。
- 为每个公司确认 OPEN accounting period、币种、vendor/customer、member/dimension、AP/AR/control/cash/expense/CWIP/prepaid accounts。
- 批准 WBS Payable review setting 与唯一生效 mapping snapshot。
- 指定并分离 Provider importer、uploader、scanner、Payable reviewer、Maker、JE Reviewer、Approver、Poster、Bank matcher/reconciler/signer/reopener。

### 2.3 IAM owner

- Provider M2M subject：Payable 授予 `WBS.SNAPSHOT.IMPORT`；Bank 另授予 `WBS.BANK.ADMIT`，均限定 exact tenant/entity。
- Payable reviewer：`AP.VIEW` + `WBS.PAYABLE.REVIEW`。
- 附件：`ATTACHMENT.CREATE`、`ATTACHMENT.FINALIZE`、`ATTACHMENT.CLEANUP` 分离。
- JE 生命周期：`AP.BILL.CREATE`、`GL.JE.SUBMIT`、`GL.JE.REVIEW`、`GL.JE.APPROVE`、`GL.JE.POST` 分离。
- Bank：`BANK.MATCH.CREATE`、`BANK.MATCH.UNMATCH`、`BANK.RECONCILIATION.START/CLEAR/REVIEW/SIGN_OFF/REOPEN/ADJUSTMENT_DRAFT`。
- 权限必须通过权威 grant sync/CAS/idempotency/audit 流程下发，不能用浏览器自助授权替代。

### 2.4 Render / infrastructure owner

单独 provision `render.integrations.yaml` 中的：

- `refs-accounting-api-integrations-staging`
- `refs-attachment-cleanup-staging`

Integrations API 必填变量名称：

- `DATABASE_URL`
- `MIGRATION_DATABASE_URL`
- `CONTEXT_ISSUER_DATABASE_URL`
- `GRANT_SYNC_DATABASE_URL`
- `OIDC_ISSUER`
- `OIDC_AUDIENCE`
- `OIDC_JWKS_URI`
- `REFS_HTTP_ALLOWED_ORIGINS`
- `WBS_SNAPSHOT_ED25519_PUBLIC_KEYS`
- `WBS_PROVIDER_SIGNED_TRUST`
- `WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID`
- `S3_ENDPOINT`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- optional `S3_SESSION_TOKEN`
- `VIRUS_SCANNER_ENDPOINT`
- `VIRUS_SCANNER_TOKEN`
- `VIRUS_SCANNER_CA_PEM` 或 `VIRUS_SCANNER_CA_FILE`（二选一）
- `VIRUS_SCANNER_SERVER_NAME`
- `ATTACHMENT_SCANNER_ACTOR_ID`
- `REFS_HTTP_MAX_BODY_BYTES=10485760`

Cleanup worker 另需：

- `ATTACHMENT_CLEANUP_ACTOR_ID`
- `ATTACHMENT_CLEANUP_SCOPES`

不得把 secret 放入 static `refs-app`；不得把 unsigned pilot 的 Cloudflare/WBS 登录变量复制到 signed integrations 服务；不得修改健康 Stage1 的 disabled 模式。

## 3. 首个公司样本的执行顺序

首样本固定：

- tenant: `6fb25daf-0799-4805-bede-be54230da33c`
- entity: `ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3`
- company: `WBPA`

### Gate 1 — Render readiness

1. integrations predeploy migration 成功。
2. 日志出现 `accounting_server_started`。
3. `/health/live` 与 `/health/ready` 均为 HTTP 200、`Cache-Control: no-store`。
4. health release SHA 与 GitHub main/static build SHA 完全一致。
5. S3/scanner 探针成功；signed ingest 与 attachment mode 均为 REQUIRED。

### Gate 2 — 离线验签（零 API 写入）

```powershell
npm.cmd --prefix server run wbs:signed-delivery:verify -- `
  --provider-trust <secure\wbs-provider-trust.json> `
  --receipt <secure\WBPA\receipt.json> `
  --request-raw <secure\WBPA\request.raw> `
  --response-raw <secure\WBPA\response.raw> `
  --package-raw <secure\WBPA\package.json> `
  --capture-dir <secure\verified-capture>
```

必须验证 issuer、key_id、SPKI fingerprint、双重签名、raw hashes、canonical package hash、nonce、TTL、tenant/entity/company/date scope。失败即零网络请求、零数据库写入。

### Gate 3 — Payable admission

```powershell
$env:REFS_PROVIDER_M2M_ACCESS_TOKEN='<provider-m2m-token>'
$env:REFS_PAYABLE_REVIEW_ACCESS_TOKEN='<different-reviewer-token>'

npm.cmd --prefix server run wbs:provider-signed-payables:admit -- `
  --api-base-url https://refs-accounting-api-integrations-staging.onrender.com `
  --provider-trust <secure\wbs-provider-trust.json> `
  --receipt <secure\WBPA\receipt.json> `
  --request-raw <secure\WBPA\request.raw> `
  --response-raw <secure\WBPA\response.raw> `
  --package-raw <secure\WBPA\package.json> `
  --tenant-id 6fb25daf-0799-4805-bede-be54230da33c `
  --entity-id ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3 `
  --company-code WBPA
```

先执行无认证、错误 actor、错误 entity、篡改 raw、缺签名、nonce replay 等负测并证明下游零写入；再执行一次正向 admission 和一次相同 idempotency replay。

### Gate 4 — 同一真实来源的完整会计链

只从本次 admission 精确 receipt/source hash 选取一行：

1. verified-clean row-bound attachment
2. independent Payable Review
3. Maker 创建 balanced Draft JE
4. Submit
5. 独立 JE Reviewer
6. 独立 Approver
7. Poster-only Post
8. 同一 JE/source 回读 GL、TB、P&L、BS、Cash Flow、AP Aging
9. Report row → GL → JE → Source → Back

所有金额保持 PostgreSQL numeric/定点字符串，不使用 JavaScript 浮点汇总。

### Gate 5 — 同一真实 Bank source 的完整对账链

1. signed Bank admission
2. exact provider-created `bank_source`
3. Match → Unmatch（职责分离）
4. receipt-bound reconciliation worksheet
5. Adjustment Draft（需要时）→ Submit/Review/Approve/Post
6. Clear → Review → Sign-off → immutable snapshot → Reopen
7. 同一 source 回读 GL/TB/IS/BS/Cash Flow 与审计链

## 4. 扩展到全公司的批量规则

- 首个 WBPA 样本全部 Gate 通过后，按批准目录逐公司生成独立 delivery plan。
- 每个 company/domain/date range 都有唯一 manifest entry、四工件哈希、row/control totals 和状态。
- 不允许一个包覆盖多个公司；不允许客户端过滤混合包；不允许用 company name 推导权限。
- 每公司先负测，再 admission，再 readback；任何 scope/hash/count/total 不一致，该公司该域停止，其他公司不受污染。
- full snapshot 完成后才启用 delta；delta 必须有连续 cursor/version 和 tombstone。
- 全量完成定义：目录中的每个 active company、每个必需域、2026 完整日期覆盖均为 VERIFIED/ADMITTED，并能从 REFS 查询到 immutable receipt/source lineage。

## 5. 必须保留的生产证据

- GitHub main、static build、integrations API health 的同一 SHA
- Render deploy ID、migration log、`accounting_server_started` 时间
- 每个 Provider package 的 issuer/key_id/fingerprint/nonce/TTL 与四个 hash（不保存私钥/token）
- admission/import/snapshot/receipt/row/source/version/evidence/attachment IDs
- 每个命令的 actor、role、timestamp、Idempotency-Key、If-Match revision、HTTP status/problem code
- audit_event 与 outbox_event IDs
- posting_batch、ledger_line、GL/TB/statement/AP-aging/reconciliation snapshot IDs
- 跨 entity、错公司、错币种、错账户、错 hash、重放、过期、stale revision 的零写入证明

## 6. Go / No-Go

只有以下条件同时满足才可把 static 的唯一 API base 切到 integrations API：

- integrations API 同 SHA ready
- Provider 四件套或 Bank signed package 已离线验签
- M2M 与人工角色授权已验证
- S3/scanner/attachment 链健康
- 至少一条真实 source 已走完对应完整链
- 负测证明零写入
- authenticated 浏览器可读取同一来源、JE、GL、报表并正确 Back

任何条件缺失：保留健康 Stage1；不切流、不自动过账、不把 unsigned 页面/MCP读取冒充正式 admission。

## 7. 当前实际缺口（截至 2026-08-15）

- Render integrations Blueprint 结构与代码已准备，但独立服务仍需完成批准配置并成功启动。
- Provider trust pin 已收到并验证；首个 WBPA 的 `receipt.json/request.raw/response.raw/package.json` 尚未出现在已交付目录。
- Bank signed manifest/package 尚未交付。
- dedicated Provider M2M subject、S3/scanner/cleanup actor 的生产值与 grants 尚未形成可验证运行证据。
- 因此目前不能声称真实 WBS 数据已准入、已形成 Draft、已过账或已进入正式财报。

## 8. 现有权威参考

- `server/WBS-PROVIDER-SIGNED-PAYABLE-ADMISSION-RUNBOOK.md`
- `contracts/WBS-READONLY-VIEW-DELIVERY-REQUEST.md`
- `server/runtime/wbs-full-company-delivery-plan.mjs`
- `server/tools/build-wbs-full-company-delivery-plan.mjs`
- `server/tools/verify-wbs-full-company-delivery-plan.mjs`
- `render.integrations.yaml`
- `staging-secrets-required.md`
- `docs/PHASE-1-DEPLOYMENT-RUNBOOK.md`

`server/WBS-SIGNED-DELIVERY-ADMISSION.md` 中旧 `/wbs/snapshots` 路径仅作历史参考；当前 Payable 正式 endpoint 是 `/api/v1/entities/{entityId}/wbs/provider-signed/payables/admissions`。
