# MERGE GUIDE: Codex a77822a → main(现 da0858e) · 2026-08-01
基线分叉: a77822a 基于 2a2c535;远端此后有 bf158d6 / c11dda6 / da0858e 三段 Claude 提交。
**Claude 侧已冻结以下热点文件,直到本次合并落地**: app.jsx, modules-more.jsx, seed.js, build.mjs, module-aiaudit.jsx, modules-core.jsx。

## 逐文件冲突图与解决原则(冲突时以本表为准)
| 文件 | Claude 侧改动(2a2c535之后) | 解决原则 |
|---|---|---|
| modules-more.jsx | RuleCenter 静态 rules 数组同步文案(bf158d6);GL +Detail/CashFlow tab、CWIP/Inventory/CostGLRecon 报表(c11dda6/da0858e) | **RuleCenter 取 Codex**(engine 单一来源优于我的静态数组,删除我的 rules 数组);GL/报表部分取 Claude |
| app.jsx | palette 搜JE、build stamp span、SEED_V='v9' | SEED_V **取 Codex v10**;build stamp 若 Codex 有等效实现取 Codex、删我的 span+build.mjs 注入,二者留一;其余取 Claude |
| build.mjs | GITHUB_SHA/time 注入 dist html | 与 Codex 的 SHA/time 实现取其一(功能相同) |
| seed.js | S/N 规范化、AIWB/WBLD 真实分录、SOURCE_DOCS | **Loan Draw 种子修正取 Codex**(JE-2026-07-1001 旧 Dr CWIP 是已知历史错账);其余取 Claude;合并后 SEED_V 再+1 |
| module-aiaudit.jsx | AI-CUT-01、Owner/Due/Resolve、一键红冲 | 取 Claude;若 Codex 的 trace 校验更严,叠加不互斥 |
| modules-core.jsx | runBatch、真实附件、JE表单 | 取 Claude;Codex 的 auto-JE source/rule trace 强校验叠加 |
| Mapping 审批状态机/SoD | Codex 新增 | 全取 Codex |
| contracts/golden-fixtures.json | 引擎生成 | **合并后必须重新生成**(R-LOAN-05/08 修正会改变输出): `npx esbuild genfix.js --bundle --platform=node --format=cjs --loader:.js=jsx --outfile=genfix.cjs && node genfix.cjs > contracts/golden-fixtures.json` |

## 合并步骤(Codex 执行)
1. `git fetch && git rebase origin/main`(逐冲突按上表);2. 重新生成 fixtures;3. 双测试门(mtest 27组件 + audit fails=0 + 你的 golden tests);4. 普通 push(禁 -f);5. 在本文件底部追加 DECISION 记录。

## Claude 请求 Codex 协助的不足项(用户点名)
1. **TS/domain 抽离我的 JSX**: engine.js(validateJE/loanRule/pmRule/trialBalance/statements)、ai.js(aiJudge)、settings.js、coa-wbs.js(memberOf/SUBSIDIARY) → 抽成 domain 包,前端只 import 类型化纯函数;我承诺之后组件内不再新增任何会计判断。
2. **repo.js 换 API client**: 保持 load/save/audit 过渡 facade + 新增异步 get/list/create/update/command(V2 §9),我按模块切换 UI。
3. **Posting Engine 收口**: 我前端的 advanceJE/newJEFromRule 等 actions 改为调用后端命令;期间锁/SoD/不可变由 DB+API 强制,前端仅回显错误码(contracts/ERROR-CODES.md)。
4. **WBS 增量适配器**: 同意"页面 token 不是生产凭证"——等 Ricky 提供正式只读 API;我已备好字段语义(四大Setting schema/9类source/291双步),需要你实现 cursor+idempotency+outbox。

## 100 分路径(阶段目标不变,收口优先)
Codex 纵切面: Auth→Entity/Period→JE→Approval→Posting→Ledger→TB→Audit(先跑通一条,不铺面)。
Claude: 冻结新增页面;对接冻结 API;WBS 语义支持;每次发布线上 E2E。
Ricky: WBS 只读 API/token + Postgres 环境(这是 Phase 1 的唯一外部依赖)。
