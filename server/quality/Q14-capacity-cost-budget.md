# Q14 — 容量、成本与资源预算

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 系统组件与资源需求

### 1.1 服务拓扑（基于 `PRODUCTION-RENDER-TOPOLOGY.md` 和 compose.yaml）

| 服务 | 角色 | 预估资源（小规模生产）|
|---|---|---|
| refs-api | HTTP API 服务 | 512MB RAM, 0.5 vCPU |
| refs-migrator | 迁移运行器（启动时一次性） | 256MB RAM, 0.25 vCPU |
| refs-scheduler | 调度任务（折旧、摊销等） | 256MB RAM, 0.25 vCPU |
| refs-static | 前端静态文件 | 128MB RAM, 0.1 vCPU |
| PostgreSQL 16 | 主数据库 | 2GB RAM, 1 vCPU（最小） |
| Outbox Consumer | 事件派发 | 256MB RAM, 0.25 vCPU |
| Scanner Sidecar | 附件扫描 | 256MB RAM, 0.25 vCPU |
| Object Storage | 附件存储 | 按量（S3 兼容） |

### 1.2 数据库连接预算

| 角色 | 最大连接数（建议） |
|---|---|
| refs_app（API） | 20（pool_max=20） |
| refs_migrator（迁移） | 2（一次性） |
| refs_issuer（上下文） | 10 |
| refs_outbox（消费者） | 5 |
| 总计 | ≤ 37 |

PostgreSQL 默认 `max_connections = 100`，上述配置有充足余量。

**警告**: 若 API 多实例部署（水平扩展），每实例 pool_max=20，3 个实例 = 60 连接，超过安全线时需引入 PgBouncer。

## 2. 容量模型（小规模生产）

### 2.1 数据量估算（1年）

| 表 | 行数（估计）| 存储（估计）|
|---|---|---|
| journal_entry | 10,000/年 | ~10 MB |
| journal_line | 50,000/年 | ~50 MB |
| ledger_line | 50,000/年 | ~50 MB |
| audit_event | 200,000/年 | ~200 MB |
| source_link | 500,000/年 | ~200 MB |
| outbox_event | 100,000/年 | ~100 MB |
| attachment（元数据） | 50,000/年 | ~50 MB |
| 附件文件（对象存储） | 5,000 文件 × 平均 1MB | ~5 GB/年 |
| **合计（PG）** | | **~660 MB/年** |
| **合计（对象存储）** | | **~5 GB/年** |

**结论**: 对于单一中型房地产公司，1年数据量在 PostgreSQL 中远未达到分区阈值（通常 10GB+）。

### 2.2 高峰负载估算（WBS ingest 批次）

WBS 单次导入最大批次（从 pilot 数据）：~1000 行，预计：
- DB insert 吞吐：~1000 TPS（PG16 + SSD）
- 实际 WBS 行处理时间：约 1-2 秒/批次（含 AI 决策）
- 并发 WBS 导入数：建议 ≤ 3 并发

**风险**: 大型项目（>10,000 WBS 行/月）导入时，AI 分析批处理可能成为瓶颈（每行一次 LLM 调用）。

## 3. 成本观测指标（建议）

### 3.1 数据库成本

```sql
-- 每周运行：记录各表大小
SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS size
FROM pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 20;
```

### 3.2 对象存储成本

```sql
-- 每月统计：活跃附件存储用量
SELECT 
  tenant_id,
  count(*) AS attachment_count,
  pg_size_pretty(sum(size_bytes)) AS total_size
FROM attachment
WHERE finalization_status = 'VERIFIED_CLEAN'
GROUP BY tenant_id;
```

### 3.3 LLM API 调用成本（AI 模块）

- 每次 WBS 行分析调用 LLM API：约 $0.001-0.01/次
- 每月 1000 行 WBS → $1-10/月（可接受）
- 如果启用 AI JE 风险扫描（所有 JE）：需更精确估算

**建议**: 在 `ai-accounting-skill-registry.mjs` 中添加调用计数器，记录到 `audit_event` 或专用指标表。

## 4. 阈值与告警

| 指标 | 正常 | 警告阈值 | 告警阈值 |
|---|---|---|---|
| PG 连接使用率 | < 50% | > 70% | > 90% |
| PG 活跃事务 | < 20 | > 50 | > 80 |
| outbox 积压 | 0 | > 100 | > 1000 |
| outbox stale (>30分钟) | 0 | > 0 | > 10 |
| 附件上传队列 (PENDING>24h) | 0 | > 10 | > 100 |
| 对象存储单月增量 | < 1GB | > 5GB | > 20GB |

## 5. 部署建议（无实际操作）

| 场景 | 建议配置 | 成本估算（云月费）|
|---|---|---|
| 开发/测试 | 1x API + shared PG（1vCPU 2GB） | ~$30-50/月 |
| 小规模生产（单实体） | 2x API + PG（2vCPU 4GB） + 对象存储 | ~$100-150/月 |
| 中规模生产（多实体） | 3x API + PG（4vCPU 8GB） + PgBouncer + 对象存储 | ~$300-500/月 |

**注**: 以上为参考估算，不含税费，不含 LLM API 费用，实际以云服务商报价为准。

## 6. 立即可落地

1. **连接数告警**: 在 outbox consumer 启动时检查 `pg_stat_activity` 连接数，超 80% 时写入 `accounting_exception`。
2. **附件用量统计 API**: `GET /entities/{entityId}/storage-usage` 返回附件数量和总字节数。

## 7. Owner 决策缺口（D-Q14-x）

| ID | 问题 |
|---|---|
| D-Q14-1 | 是否计划多实体（多租户）部署？同一 PG 实例还是独立实例？ |
| D-Q14-2 | LLM API 调用是否有月度成本预算？超限时是否降级为无 AI 模式？ |
| D-Q14-3 | 是否需要 PgBouncer 或连接池代理（PgCat 等）？ |
