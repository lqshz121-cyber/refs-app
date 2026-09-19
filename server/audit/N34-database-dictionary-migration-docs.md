# N34 — 数据库字典与迁移文档审计

会话 claude-9c9cd162 · 2026-09-19 · 链头 433 · 只读取证

## 1. 结论摘要

**核心发现（已亲自核验）：仓库中不存在已签入的表字典。**

`server/DATABASE-DICTIONARY.md` 共 **20 行**，是一份**字典导出 CLI 的操作手册**，不是数据字典本身。它记录的表数 = **0**；全文不出现任何一个表名（对 `ledger_line|journal_entry|audit_event|attachment|account_master` 的匹配数为 0）。而迁移中 `CREATE TABLE` 的去重表名数 = **248**。

因此本项的诚实表述不是"字典已漂移"，而是**"字典不存在，只有生成器"**。且**没有任何测试守护字典与迁移之间的漂移**——新增 50 张表也不会让任何测试失败。

相对地，**迁移清单机制本身相当扎实**：439 条 manifest 条目、439 个 up、439 个 down，双向对称完整，且有多层守卫。

## 2. `DATABASE-DICTIONARY.md` 实况

20 行内容为：标题（L1）、`runtime/database-dictionary.mjs` 的行为描述（L3）、清单绑定行为（L5）、应使用的 PG 角色 `refs_dictionary_reader` 与 `ops/database-dictionary-reader{,-revoke}.sql`（L7–L9）、PowerShell 调用示例（L11–L16）、错误只暴露稳定错误码（L18）、以及 L20 的一句 **"The production database could not be inspected from this workspace."**

最后更新：`92fdf0ba`，**2026-09-13 05:55:15 +0800**，提交标题 `fix(accounting): harden database dictionary reader boundary`。迁移链自该日起推进到链头 433（提交延续至 09-18），所以文档相对仓库滞后 5 天——**但因其不列任何表名，缺陷不是滞后而是缺失**。

## 3. 漂移测量

| 侧 | 计数 |
|---|---|
| 439 个迁移中 `CREATE TABLE` 去重表名 | **248** |
| `DATABASE-DICTIONARY.md` 中列出的表 | **0** |
| 缺失 | **248（100%）** |

提取方式：`grep -rhoiE "create table (if not exists )?[a-z0-9_]+" db/migrations/*.sql` 后规范化去重。

核心会计表同样缺席：`ledger_line`、`journal_entry`、`journal_line`、`audit_event`、`staging_item`、`accounting_period`、`posting_batch`、`source_document`、`source_link`。

## 4. 生成器（确实存在且相当严谨）

`runtime/database-dictionary.mjs`（83 行）：

- `readDatabaseDictionary()` — `:57`，以 `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` 开启（`:62`）
- `:64` 调 `exactAppliedMigrations()`（`:27-33`），把线上 `refs_schema_migration` 行与 `MIGRATION_MANIFEST` **逐名逐校验和**比对，任何差异抛 `DATABASE_DICTIONARY_MIGRATION_MISMATCH`（`:30`）。这是真正的 fail-closed
- `:65-73` 七条并行 `pg_catalog` 查询：relations / columns / constraints / indexes / functions / triggers / policies。**从不读会计数据行**；也**从不调用** `pg_get_functiondef`/`pg_get_constraintdef`/`pg_get_triggerdef`（因此索引**定义**不被捕获，只捕获 `tablename`/`indexname`，`:69`）
- `:35` `migrationManifestHash()` — 对 `{name,up,down}` 取 SHA-256；`:76` `catalog_sha256` — 对整个目录取 SHA-256
- `:5`、`:20-25` 凭据脱敏正则：`postgres://` URL、bearer token、PEM 私钥、`password=`/`secret=`/`token=`/`api_key=` 赋值；每个文本字段截断至 4000 字符
- `renderDatabaseDictionaryMarkdown()` — `:37-55`，这才是会产出逐表 markdown 的地方，运行时输出到**仓库外**路径

CLI：`runtime/export-database-dictionary.mjs`；npm 脚本 `db:dictionary`（`package.json:79`）。

## 5. 是否有测试守护字典漂移？—— NOT IMPLEMENTED

`tests/database-dictionary.test.mjs` 有 4 个测试，**全部关于导出工具自身对 fake pool 的行为，与文档覆盖率无关**：
- `:29` 快照只读、清单绑定、不含函数源码
- `:46` 迁移历史不符时 fail-closed
- `:53` 在每个文本字段脱敏连接串/bearer/私钥/赋值型凭据
- `:70` CLI 要求专用只读角色且只产出安全证据

加上 `tests/database-dictionary-reader-role.test.mjs`（最小权限角色）。

**没有一个断言任何表被记录，也没有一个把迁移中的 `CREATE TABLE` 名与任何集合比对。新增 50 张表不会导致任何失败。** 这是一个干净、无需含糊其辞的缺口。（该文件已接入 `pretest`，`package.json:65`。）

## 6. 迁移清单机制 —— 确认，且比预期更严

`runtime/migration-manifest.mjs`（441 行）导出 `MIGRATION_MANIFEST`：冻结数组套冻结对象，形如

```js
Object.freeze({name:"001_wbs_accounting_core.sql", up:"131bc101…0c93", down:"709c0548…f255"})
```

- 形状 `{name, up, down}`；**`up` 与 `down` 都是**文件体规范化（CRLF→LF）后的 SHA-256
- **439 条条目**，与 439 个 up 文件、439 个 down 文件精确对应

`runtime/migrations.mjs` 中的强制：
- `assertManifest(files)` `:76-79` —— `JSON.stringify` 全序列表比对，不符抛 `MIGRATION_MANIFEST_MISMATCH`。这是**精确有序列表**比对，磁盘上多一个或少一个文件都会被拒。在 `migrateUp` 中于 `:122` 调用
- `assertChecksum(migration,direction)` `:81-84` → `MIGRATION_CHECKSUM_MISMATCH`
- 已应用迁移篡改检查 `:160`：同名不同校验和 → `MIGRATION_CHECKSUM_MISMATCH`（"Applied migration changed"）
- 台账表 `refs_schema_migration(migration_name PK, checksum char(64), applied_at)` `:87-91`
- **额外守卫 `MIGRATION_LEDGER_AHEAD`** `:150` —— 拒绝用**较旧**发布启动一个已被更新版本迁移过的数据库（Render"回滚到上一次部署"的典型风险）。details 含 `schema_head`、`release_head`、`unknown_migrations`、`recovery`
- `MIGRATION_IDENTITY_REJECTED` `:99`、`MIGRATION_DATABASE_REJECTED` `:102` —— 迁移登录名与库名须匹配 `MIGRATION_DATABASE_URL`；`refs_runtime`/`refs_context_issuer`/`refs_app` 被明确禁止

可观测安全码白名单：`runtime/migration-observability.mjs:5`，13 个码。

**覆盖测试**：`tests/postgres-runtime-contract.test.mjs:110-124` 遍历**每一条** manifest 条目，读 `db/migrations/<name>` 与 `db/migrations/down/<name>`，以 CRLF 规范化重算 SHA-256 并双向断言相等（`:115-122`），另断言名称唯一（`:113`）。已接入 `npm test`。

**须精确的限定**：该测试走的是 **manifest → 文件** 方向。它证明每条 manifest 条目都有匹配且未被修改的 up 与 down 文件。它**不走 文件 → manifest** 方向，因此目录里多一个未登记的 `.sql` 只会在运行时被 `assertManifest`（`migrations.mjs:78`）拦下，而不会被单测拦下。已核验：`grep MIGRATION_MANIFEST_MISMATCH tests/*.mjs` 无命中。

## 7. 上下迁移对称性 —— 完整

直接测量：`db/migrations/*.sql` = **439**；`db/migrations/down/*.sql` = **439**；`comm -23`（有 up 无 down）= 空；`comm -13`（有 down 无 up）= 空。**每个上迁移都有匹配的下迁移，无缺口。**

**对称性测试** `tests/migration-down-symmetry.test.mjs`（125 行）—— 注意它强制的是**对象级**对称，不是文件存在性对称：
1. `:60` 没有下迁移会 drop 或 restore 一个上迁移从未创建的函数（收集全部 `CREATE [OR REPLACE] FUNCTION` 名与 `'public.<name>(` 字面量，`:47,:55`）
2. `:75` 没有下迁移会 drop 一张上迁移从未创建的表或触发器
3. `:88` 上迁移新增的每个触发器都被它自己的下迁移移除（含三种正当拆除豁免与 `:116` 的屏障豁免）

`:1-27` 的表头注释记录了它针对的真实缺陷：`down/371_unit_transfer_paired_reversal.sql` 曾恢复并 drop 了一个无上迁移创建的影子函数 `refs_guard_unit_transfer_journal_transition_370()`，导致下迁移体以 42883 死亡，并泄漏了 `journal_entry` 上的触发器。`:24-27` 明确规则："The rule enforced here is symmetry, not reversibility."

**文件计数对称（439 == 439）本身无任何测试断言**，只由 `postgres-runtime-contract.test.mjs` 逐条目读两个文件隐含。已接入 `posttest`（`package.json:67`）。

## 8. 不可逆迁移屏障 —— 两个都确认

### 8.1 `MIGRATION_RESET_BLOCKED`（屏障在 401）

- 抛出点 **`runtime/migrations.mjs:186`**，在 `migrateDown(pool,{all:true})` 内
- **fail-fast 设计**（`:177-188`）：在跑**任何**下迁移体之前，自最新向旧遍历已应用列表，调 `downMigrationRefusesUnconditionally(down.sql)`，首次命中即发 `migration_reset_blocked` 事件并抛出。`:178-181` 注释说明理由：中途拒绝会留下拆到一半的 schema
- details：`{schema_head, applied_count, first_irreversible_migration, recovery}`（`:183-184`）
- 检测器 **`runtime/migrations.mjs:41-56`**：解析 `DO $$…$$` 块，剥注释与字符串字面量，跟踪 `IF`/`CASE`/`END IF`/`END CASE` 嵌套深度，**仅当 `RAISE EXCEPTION` 处于深度 0 时**返回 true（`:54`）
- 屏障文件 `db/migrations/down/401_native_settlement_bank_account_control.sql` —— 两处 raise，第二处无条件："Native settlement function replacement cannot be rolled back because migration 305 is retained as immutable historical evidence"

### 8.2 `DB_DOWN_FORBIDDEN`

- 抛出点 **`runtime/migrations.mjs:107`**，在 `assertMigrationConnection(client,{destructive:true})` 内
- 条件 `:106`：`destructive && !config.allowDown && !database_name.endsWith('_test')`。即 `db:down` / `db:reset` 对任何非 `_test` 库均拒绝，除非 `REFS_ALLOW_DB_DOWN=1`（`runtime/config.mjs:57`）
- **准确性提示**：该守卫在 `runtime/migrations.mjs`，**不在** `runtime/migrate.mjs`。`migrate.mjs:17` 只校验命令名。有两个测试的断言消息写成"migrate.mjs must contain…"但实际读的是 `migrations.mjs`（`tests/backup-pitr-drill-p14.test.mjs:107-109`、`tests/e2e-scenarios-p15.test.mjs:204-206`）——是消息误导，不是缺陷

### 8.3 屏障覆盖测试

- **`tests/migration-barrier-contract-postgres.test.mjs`** 是最强的一个。`:61` 断言 401 在零结算证据时仍无条件拒绝（`P0001` + "migration 305 is retained" 消息），并断言 305 函数仍在位。**`:70-75`** 断言静态检测器与实库一致：对全部 439 跑 `downMigrationRefusesUnconditionally` 并 `deepEqual(flagged, ['401_native_settlement_bank_account_control.sql'])` —— **全链恰有一个无条件屏障**。`:77` 断言 414 仅在存在未撤销上下文时以 `55006` 拒绝。脚本 `test:postgres:barriers`（`package.json:136`）
- `tests/migration-reset-preflight.test.mjs:76`（断言 `MIGRATION_RESET_BLOCKED`）、`:93`（该码经脱敏后仍存活）、`:101/:108`（屏障之下不触发）
- `tests/postgres-kernel.test.mjs:2428`（`first_irreversible_migration` 精确值）
- `tests/migrations-safety.test.mjs:34`（`DB_DOWN_FORBIDDEN`）
- `MIGRATION-BARRIER-TEST-DESIGN.md` 记录了 S18 的绕行方案（`migrateUp(pool,{until})`，仅 `_test`，由 `MIGRATION_UNTIL_FORBIDDEN`/`MIGRATION_UNTIL_UNKNOWN` 守卫，`migrations.mjs:129-130`），使历史链头测试永不跨越屏障

另有 **43 个条件性屏障**：在其保护的证据存在时拒绝（`migration-down-symmetry.test.mjs:26` 注释）。

## 9. 缺口清单

1. **无已签入的表字典**：248 张表，0 张有文档。对审计文档而言是 P0
2. **无漂移测试**：没有任何东西把迁移的 `CREATE TABLE` 输出与任何已文档集合比对
3. **生成器无法在本工作区运行**（文档自陈 L20），因此连证据产物都没有
4. 生成器刻意省略索引定义、约束定义、函数签名、触发器定义与策略谓词（`:3` 与 `:66-73` 的查询只返回名称/种类）——即便运行，产出也是**目录普查，不是带列语义的描述性字典**
5. 无测试断言 `MIGRATION_MANIFEST_MISMATCH`（文件→清单方向仅运行时保护）
6. `migration-barrier-contract-postgres`、`e2e-scenarios-p15`、`backup-pitr-drill-p14` **不在** `npm test`/`posttest` 中，分散在独立脚本或完全未接线

## 10. 可立即实施（低风险、纯新增）

- 增加一个**漂移测试**：从全部迁移提取 `CREATE TABLE` 名集合，与一份签入的期望清单（例如 `server/db/TABLE-CENSUS.json`）比对，不符即失败。这样新增表必须同步更新普查文件，漂移不再可能静默发生。不触碰任何迁移、不触碰生产
- 增加一个**文件→清单**方向的测试：列举 `db/migrations/*.sql` 与 `down/*.sql`，断言与 `MIGRATION_MANIFEST` 的名称集合完全相等。补上第 5 项缺口
- 把 `test:postgres:barriers` 接入 CI 的 PG 阶段（第 6 项）

以上三项均为新增测试，不改运行时、不改迁移、不动生产，建议作为 N34 的后续实施项由 Owner 批准（D-N34-1）。

## 11. Owner 决策

- **D-N34-1** 是否批准上述三个新增测试（表普查漂移测试、文件↔清单双向测试、屏障测试接入 CI）。纯新增，零运行时影响。
- **D-N34-2 字典产出策略**。数据字典是（a）由 CI 对 staging 库定期生成并存档为证据、（b）签入仓库并由漂移测试守护、还是（c）维持现状仅保留生成器？现状下任何人问"系统有哪些表、每列什么含义"都无法从仓库回答。
- **D-N34-3** 生成器是否扩展为捕获列注释、约束定义与索引定义（当前只有名称，不足以作为描述性字典）。
