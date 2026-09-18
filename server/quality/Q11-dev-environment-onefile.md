# Q11 — 开发环境与一键验证

Session: claude-9c9cd162 · 2026-09-18 · No production writes

## 1. 现有开发流程

### 1.1 已知组件（基于工作树审查）

| 组件 | 文件 | 状态 |
|---|---|---|
| Embedded PG16 | `@embedded-postgres/linux-x64` | ✅ 已集成 |
| 测试运行器 | `/tmp/onefile-gw.sh` | ✅ 已存在 |
| 迁移运行器 | `runtime/migrations.mjs` | ✅ 已存在 |
| Docker Compose | `compose.yaml`, `compose.attachments.yaml` | ✅ 已存在 |
| OpenAPI lint | `@redocly/cli` | ✅ 在 CI 门禁中 |
| 配置文件 | `runtime/config.mjs` (环境变量) | ✅ 已存在 |

### 1.2 测试运行方式

```bash
# 单文件测试（当前主要方式）
/tmp/onefile-gw.sh tests/<file>.test.mjs

# 全套测试（未确认命令）
cd /tmp/gw2/server && npm test
```

## 2. 完整开发流程（建议文档化）

### 2.1 一键启动脚本（建议 `dev-setup.sh`）

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== REFS 开发环境启动 ==="

# 1. 检查依赖
command -v node >/dev/null 2>&1 || { echo "需要 Node.js 18+"; exit 1; }
command -v docker >/dev/null 2>&1 || echo "警告: Docker 未安装，将使用 embedded PG"

# 2. 安装依赖
cd server && npm ci

# 3. 启动 Embedded PG（开发模式）
export EMBEDDED_PG_DIR=/tmp/pg16v
export DATABASE_URL="postgres://refs_app:refs_app@localhost:5432/refs"
export MIGRATION_DATABASE_URL="postgres://refs_migrator:refs_migrator@localhost:5432/refs"
export CONTEXT_ISSUER_DATABASE_URL="postgres://refs_issuer:refs_issuer@localhost:5432/refs"

# 4. 运行迁移
node runtime/migrations.mjs up

# 5. 运行快速验证
node -e "const {MIGRATION_MANIFEST}=await import('./runtime/migration-manifest.mjs');console.log('迁移数:',MIGRATION_MANIFEST.length)"

echo "=== 开发环境就绪 ==="
echo "运行测试: npm test"
echo "单文件: /tmp/onefile-gw.sh tests/<file>.test.mjs"
```

### 2.2 秘密扫描（立即可落地）

```bash
# .gitignore 已有（需确认）
# 添加 pre-commit hook
cat > .git/hooks/pre-commit << 'HOOK'
#!/bin/bash
# 扫描敏感字符串
if git diff --cached | grep -iE "password|secret|api.?key|bearer\s+[A-Za-z0-9]{20,}|-----BEGIN"; then
  echo "❌ 检测到可能的敏感信息，请检查暂存文件"
  exit 1
fi
echo "✅ 秘密扫描通过"
HOOK
chmod +x .git/hooks/pre-commit
```

### 2.3 本地 API 启动

```bash
# 启动 API 服务器（本地开发）
cd server
PORT=3001 node accounting-server.mjs
# 验证
curl http://localhost:3001/health
```

## 3. Docker 开发环境

### 3.1 compose.yaml 审查

存在 `compose.yaml` 和 `compose.attachments.yaml`。建议确认：

```bash
# 验证 compose 配置
docker compose -f compose.yaml config | grep -E "image|environment|secrets" | grep -v "^\s*#"
```

**安全要求**:
- 不得在 compose.yaml 硬编码 DB 密码（用 secrets 或 `.env` 文件）
- `.env` 文件必须在 `.gitignore` 中

### 3.2 镜像安全

```bash
# 确认镜像不含真实凭据
docker build -t refs-api . && \
  docker run --rm refs-api env | grep -iE "password|secret|token"
# 结果应为空
```

## 4. 静态检查

### 4.1 ESLint（已在 CI）

```bash
cd server && npm run lint
```

### 4.2 依赖安全

```bash
cd server && npm audit --audit-level=high
```

### 4.3 迁移完整性（一步验证）

```bash
# 验证当前 PG 与 manifest 一致
node -e "
const {createPool}=await import('./runtime/db.mjs');
const {ledgerDigest,manifestDigest}=await import('./runtime/test-logical-restore-drill.mjs');
const {MIGRATION_MANIFEST}=await import('./runtime/migration-manifest.mjs');
const pool=await createPool({databaseUrl:process.env.MIGRATION_DATABASE_URL});
const rows=(await pool.query('SELECT migration_name,checksum FROM refs_schema_migration ORDER BY migration_name')).rows;
console.log('Live digest:',ledgerDigest(rows));
console.log('Manifest digest:',manifestDigest(MIGRATION_MANIFEST));
console.log('Match:',ledgerDigest(rows)===manifestDigest(MIGRATION_MANIFEST));
await pool.end();
"
```

## 5. 开发环境安全检查清单

```
□ .env 文件不在 git 追踪中
□ compose.yaml 无硬编码密码
□ npm audit 无高危漏洞  
□ pre-commit hook 已安装（秘密扫描）
□ 测试 fixtures 无真实业务数据
□ docker 镜像不含凭据
□ node_modules 不在 git 中
```

## 6. 立即可落地

1. **创建 `server/dev-setup.sh`**: 一键启动开发环境脚本（参考上方）。
2. **添加 pre-commit hook**: 安装秘密扫描钩子。
3. **添加 `npm run verify` 脚本**: 运行 lint + migration-check + 快速测试 (< 30s)。

```json
// package.json
"scripts": {
  "verify": "npm run lint && node runtime/migrations.mjs check && npm test -- --test-name-pattern='S0[1-4]'"
}
```

## 7. Owner 决策缺口（D-Q11-x）

| ID | 问题 |
|---|---|
| D-Q11-1 | 是否使用 Docker 还是 embedded PG 作为本地开发数据库？ |
| D-Q11-2 | 是否需要 seed 数据脚本（演示用 COA/entity/member）？若有，是否含真实数据？ |
