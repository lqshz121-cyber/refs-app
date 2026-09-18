# Q07 — 国际化、金额与日期精度

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 金额精度

### 1.1 数据库层（已实现）

所有金额字段使用 `numeric(20,4)`，精确到 0.0001 单位（分以下4位）。

```sql
-- migration 002 refs_create_manual_journal 中的格式约束
CHECK(debit_amount >= 0 AND credit_amount >= 0)
```

API 层金额用字符串传输（`pattern: '^(?:0|[1-9]\\d{0,15})\\.\\d{4}$'`），避免 JSON number 精度丢失。

| 层次 | 金额类型 | 精度 | 传输格式 |
|---|---|---|---|
| PostgreSQL | numeric(20,4) | 4位小数 | 精确 |
| API 请求 | string | 4位小数 regex | "100.0000" |
| API 响应 | string | 4位小数 | "100.0000" |
| UI 显示 | 待确认 | 待确认 | 待确认 |

**风险**: 若 UI 用 `parseFloat()` 解析 API 金额字符串，会丢失精度（JavaScript 浮点数）。应使用 `BigInt` 或专用 decimal 库（如 `big.js`）处理。

### 1.2 舍入规则

贷款利息计算（migration 431）明确声明：
```
-- capitalised and expensed amounts are each rounded to 4 decimal places,
-- their sum equals total (no penny difference)
```

利息拆分时两项各自独立四舍五入，两项之和等于总额。**建议**: 明确文档化所有金额计算的舍入规则（ROUND_HALF_UP vs ROUND_HALF_EVEN）。

### 1.3 负数处理

`loan_draw.amount` 允许负数（本金偿还）：`CHECK(amount<>0)`
`ledger_line` 的 `debit_amount`/`credit_amount` 均 ≥ 0（无负数）
JE 调整（REVERSAL/RECLASS）通过反转借贷方向表达，而非使用负数。

## 2. 日期处理

### 2.1 数据库层

所有日期字段使用 `date`（无时区，本地日期）或 `timestamptz`（含时区）：

| 字段类型 | 用途 | 时区处理 |
|---|---|---|
| `date` | 会计日期 (`journal_date`, `draw_date`) | 无时区，按业务所在地日历 |
| `timestamptz` | 操作时间戳 (`created_at`, `posted_at`) | UTC 存储，应用层转换 |

**风险**: `accounting_period.starts_on`/`ends_on` 是 `date` 类型。`journal_date BETWEEN starts_on AND ends_on` 的比较不涉及时区，但如果客户端传入的 `journalDate` 在 UTC 边界附近，可能因时区偏移导致期间校验失败。

### 2.2 API 日期格式

OpenAPI 定义中日期格式统一为 `format: date`（ISO 8601 YYYY-MM-DD）：
```yaml
journalDate: {type: string, format: date}
```

**建议**: 在文档中明确说明所有 date 字段使用业务实体所在地时区（不是服务器时区）解释。

### 2.3 银行日期

银行对账单日期从 `bank_source` 导入，格式由导入程序决定。

**风险**: 银行日期与会计日期可能存在时区差异（如香港银行 UTC+8 vs 美国账期 UTC-5）。建议在 import_batch 中记录 bank_source 的时区声明。

## 3. 货币

### 3.1 多币种支持

- 所有账务记录含 `currency char(3)` (ISO 4217)
- 每个实体有 `base_currency`
- 跨币种折算逻辑：**未发现专用汇率表**

**缺口**: 无 `exchange_rate` 主数据表，无多币种折算引擎。汇率相关处理全部依赖导入数据中的金额（按实际发生额导入，不做折算）。

### 3.2 千分位与显示

API 金额以字符串返回（如 "1000000.0000"），无千分位。UI 层需自行格式化：
- 中文环境：￥1,000,000.00
- 英文环境：USD 1,000,000.00

**建议**: 提供标准格式化函数库（`formatCurrency(amount, currency, locale)`）。

## 4. 中英文文案

### 4.1 现状

- 数据库错误消息为英文（如 "Manual journal requires tenant-owned attachment evidence"）
- API 错误响应为英文（Problem JSON）
- 前端文案未确认是否有中英文切换

### 4.2 建议

- 错误码（如 `23514`, `55000`）到用户友好消息的映射表应提供中英文版本
- 前端使用 i18n 框架（如 `react-i18next`）管理所有可见文本
- 数字/日期格式使用 `Intl.NumberFormat`/`Intl.DateTimeFormat` 适配 locale

## 5. 导入日期一致性

WBS 导入（`raw_event`, `source_document`）的 `accounting_date` 来自外部系统。

**已知检查**（migration 002 staging 逻辑）：
- `accounting_date` 必须在有效的 OPEN 会计期间内
- 否则 staging_item 标记为无效

**建议补充检查**:
- 未来日期导入（accounting_date > today）应发出 WARNING
- 历史数据导入超过 90 天应需要 Owner 确认

## 6. 立即可落地

1. **前端金额精度**: 用 `big.js` 或 `decimal.js` 替换 `parseFloat` 处理 API 金额。
2. **日期时区文档**: 在 `api/openapi-accounting.json` 的 `journalDate` description 中明确"本地日历日期，无时区转换"。
3. **货币显示函数**: 共享 `src/utils/formatCurrency.ts` 用 `Intl.NumberFormat` 格式化。

## 7. Owner 决策缺口（D-Q07-x）

| ID | 问题 |
|---|---|
| D-Q07-1 | 是否需要多币种折算？如是，汇率来源和汇率确认流程是什么？ |
| D-Q07-2 | 会计日期是否使用实体所在地时区还是 UTC？ |
| D-Q07-3 | 前端是否需要中英文切换？ |
