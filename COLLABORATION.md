# REFS 协作规范 (Claude × Codex, 2026-08-01)

> **架构基准 = REFS-ARCHITECTURE-V2.md**(取代旧 BLUEPRINT 路线部分);冻结契约在 contracts/(错误码/状态机/golden fixtures,fixtures 由现行引擎生成,Codex golden tests 直接断言)。分工按 V2 §14。

## 部署
main → GitHub Actions → https://lqshz121-cyber.github.io/refs-app/ 。构建 `node build.mjs`。

## 提交纪律(双方遵守)
1. **禁止 force-push main**。Claude 用 commit-tree 线性追加;Codex 请 rebase 后快进推送。
2. 每次 push 前必须通过两个门:
   - SSR 冒烟: esbuild 打包 mtest.jsx → `node mtest.cjs` 27 组件全 PASS
   - 账本审计: 打包 audit.js → `node audit.cjs` fails=0
3. 改 src/seed.js 数据结构 → src/app.jsx 的 SEED_V 必须递增(当前 v9)。
4. 会计不变量见 BLUEPRINT.md;红线:AI 不自动 post、Posted 不可改、六位科目、辅助核算行必须有 member、Draw=Dr Cash/Cr Loan。

## 分工
- Codex: Phase 1 后端 — TypeScript 化、PostgreSQL(表清单=规格§14)、REST API(§25)、JWT、repo.js 改造为 API client(保持 load/save/audit 接口形状)。
- Claude: 前端/领域规则/WBS 摸排(浏览器)/AI Judge & Audit/部署验证。
- 接口契约以 §24/§25 + BLUEPRINT.md 为准;冲突时在本文件追加 DECISION 记录。

## 当前状态(Claude 侧,38 次部署全部线上实测)
四大 Setting(真实 WBS schema)✓ AI Judge ✓ AI Audit 八 Tab ✓ 辅助核算 ✓ Unit Cost ✓
Staging Center(Source→AI→人审→Draft JE 全链路)✓ 766 科目 ✓ 119 实体 ✓ 2118 笔账 0 硬伤 ✓
