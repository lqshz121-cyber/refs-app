# WBS H1 接手执行说明

基线为 ee35b223af2f02147aad9c4c7e98d181e440b55e。本次补丁需要通过验证并形成候选提交后，才能用于 staging。适用范围为 2026 H1；生产不在范围内。Cowork 已拒绝的远程 Shell 操作继续由 Owner 执行。

## 当前发布条件

Owner 已在本会话直接授权本地验证通过后推送候选分支、部署 refs-accounting-api-staging 并执行单公司单期试点；试点验收后仍须另行确认扩批。此授权不包含生产，也不解除远程 Shell 的既有操作限制。

当前不能部署并执行写入试点：最终候选的完整验证仍未通过。新增迁移 447、448、449 接入现代 retained source 与 human Draft evidence，分别修复正式重分类、inventory 读回和来源确认；没有修改已应用迁移或补造 legacy trace。原 CLI 的管理连接科目写入和过账后 source_link 写入已删除，改为引用 APPROVED 设置提案调用正式 WBS H1 重分类命令，并在每次内核操作前核验 staging 身份。

单公司、单 H1 期间和明确的试点 reason 都必须显式指定。映射到 610000 不等于已完成：仍可能需要把测试供应商调整到真实供应商。纯逻辑测试 24/24、零跳过；fresh PG16 的现代链路和迁移往返升级专项 2/2、零跳过，但最终代码还需完整回归。首次专项确认旧来源确认函数拒绝现代证据，第二次暴露了过账后 Draft 引用清空的差异；修复后通过，不将失败运行记成通过。

重分类使用显式 reclassMaker 角色和 REFS_WBS_TEST_IMPORT_RECLASS_MAKER_ACTOR_ID，授予现有正式 WBS_H1_PAYABLE_DRAFT_MAKER 权限包；默认启动授权包没有扩大。该身份须与设置裁定、提交、审核、批准和过账身份分离。inventory 分开呈现现代 Draft 与实际 Posted 状态，并保留原始 mapping_match_count，正式过账标记不再遮蔽四格的映射轴。

下一步冻结候选到独立验证目录，完成 fresh PG15/16 全量、跨版本现代链路、完整 CLI 主入口和本地回归。早先两套完整 PG 运行均为 279/283，四项 MIGRATION_MANIFEST_MISMATCH：运行期间目录新增迁移而进程仍持有旧清单；退出码 1，不作为数据库验收通过。新运行不得与继续编辑共用源码目录。

## 供应商总账与应付明细修复

实际 mapping CLI 在干净 PG18 中暴露了新的发布阻断：四行重分类已把总账转到真实供应商，但 AP Bill 仍属于 WBS_TEST_VENDOR。125.0000 的合成测试产生两个供应商明细异常，虽然总差额为零。总账平衡不代表应付明细一致，不能以这次结果部署。

候选迁移 450 在正式 Draft 创建时绑定分录哈希；Post 时锁定来源 Bill，只允许尚未分配、无调整且全额未结的原始应付，把供应商、版本、不可变证据、审计和 outbox 与总账同事务更新。旧未绑定 Draft 不自动补哈希，过账时拒绝。PG18 最终专项 4/4、零跳过，覆盖历史兼容、现代链路、实际 CLI 和迁移往返；供应商明细异常归零，outbox 故障证明整笔过账回滚，证据不可修改、留存历史禁止破坏性 down。完整 PG15/16 仍须验证。

尚无 WBS 供应商转移的专用冲销命令。候选保留拒绝通用业务关联冲销的限制，并阻止带 reversal_of_id 或 reclass_of_id 的派生凭证绕过专用流程。不能宣称已支持供应商转移冲销；后续若有此需求，须另行实现拥有业务证据的正式流程。

冻结 bfeb9ee8 的根目录 npm test 和 build 退出码均为 0；server npm test 退出码为 1，原因是 TABLE-CENSUS 的 migration_head 停在 446，而非 449。本次已同步到 450 并登记新增证据表，表清单与相关工具专项共 26/26、零跳过。bfeb9ee8 的 PG15/16 全量仍运行，不因新增修复停止或修改该验证目录；它们即使通过也不覆盖迁移 450，最终候选须另行冻结验证。

## 工具变化

- 授权版本读取错误会计入失败并保留批次汇总；仅 40001 最多尝试三次。
- 设置工具验证 runtime、issuer、migration、grant-sync 四个连接指向相同端点，并通过 refs_grant_sync 校验 staging 部署身份；每次内核操作前重复验证。迁移 301 不允许 runtime 或 refs_app 直接调用部署校验函数。
- 设置汇总的 plan_counts 表示读回的计划分类，counts 表示互斥的最终结果；实际成功批准记 APPROVED，批准失败只记 FAILED。计划读取失败只出现在最终 FAILED 中。
- 异常明细完整保留 missing_details、not_ready_accounts、ambiguous_details，不再截断。大规模执行需保留完整 JSONL 日志，终端摘要不足以代替回执。
- npm test 的 pretest 已包含 company-runners 测试；新增独立测试及两个工具别名。

## 执行顺序

1. 只读确认 deployed SHA、数据库身份和 ledger，列出 236 家导入范围与 237 家网站普查的差集，检查各公司六期是否存在。
2. 正式 grant-sync 通道授权。人类类授权遵守现有有效期限制，按批续期。
3. 整理已留存设置、提出 COA 种子、审核决定、dry run、应用种子。冲突、无名称和停用科目保留例外。
4. 先选一家公司一期导入；保留来源数量、金额和执行回执。
5. 先运行设置裁定 dry run，检查例外，再运行允许范围内的设置批准。
6. 设置批准后才运行重分类 dry run 和重分类。迁移 269 的 refs_create_wbs_h1_payable_reclass_draft 必须引用 APPROVED 设置决定，且设置决定者不能与 Draft maker 相同。
7. 检查 TB、报表、610000 残留、逐供应商 AP control 与 open-items 差异、来源与凭证追溯，重放证明没有重复记账；验收后向 Owner 提交回执，取得扩批确认后才扩大范围。

导入和重分类可能执行完整提交、审核、批准、过账流程，属于 staging 会计写入。设置批准不会把有例外的提案强制转绿。命令须在已部署本次候选的实例中运行。

## 日志与退出码

Render Shell 使用 Bash 时，先启用 pipefail。以下以设置 dry run 为例；本地测试不能证明远程实例可达。

```bash
set -o pipefail
REFS_WBS_H1_SETTINGS_DRY_RUN=1 node tools/decide-wbs-h1-accounting-settings.mjs 2>&1 | tee /tmp/wbs-h1-settings-plan.jsonl
rc=${PIPESTATUS[0]}
printf 'node_exit_code=%s\n' "$rc"
```

必须紧接管道读取 PIPESTATUS，避免其他命令覆盖它。保留完整日志与 node 退出码。只有退出码 0、目标身份匹配、summary 没有失败、数量对得上时，才推进下一步。不要仅依据 tail -1 判成功。禁止把连接串、令牌或 Cookie 粘进日志。

## 验收工件

逐公司逐期保存 release SHA、数据库版本、来源数与金额、导入/异常/Draft/Posted 数、映射四格、设置状态、610000 残留、TB 借贷差和追溯摘要。数字必须标明读取时间；历史 WBPA 1285 及交叉表不作为当前读回。

## 本地接手回执（2026-10-06）

工作分支：codex/refs-h1-runner-hardening-20261006。隔离工作树：本项目 work/refs-takeover-20261006；原 candidate 的未提交文件未改动。本次未推送、未部署、未执行远程 Shell，也未更改线上数据库。

补丁同时修复 Windows 中文路径下的两个前端边界校验器、迁移正则测试与密钥扫描测试。密钥扫描 CLI 原先在 Windows 可能不执行扫描却返回成功，已修复入口判断并添加真实子进程回归测试。

前端完整回归进一步暴露了旧发布验证的跨平台问题：Render 安全头、验收回执索引、CodeQL 工作流断言假设 LF；GO/NO-GO 和 Render schema 子进程使用了 URL pathname 而非文件路径。已规范化换行与路径转换，不放宽安全或发布条件；Render schema 校验器也修复了 CRLF 下漏读环境变量的问题。

已验证：

- company-runners：9/9，零跳过；授权、映射与本次工具的聚焦组合测试：37/37，零跳过。
- server 下完整 npm test：退出码 0，主测试组 919/919；其他组仍有 283、5、5、18 个跳过，不能作为数据库验收通过。
- npm run build：退出码 0；完整 run-verifiers：64/64。
- 根目录 npm test 的本次完整运行到 security-surface 时因 CRLF 解析失败而退出 1；修复后从该组起，包含 traceability、boot-guard、GO/NO-GO、SBOM、Render schema、staging readback 和 evidence client 的全部剩余测试链退出 0。前段测试已在完整运行中通过；没有把分段复测写成整条命令退出 0。
- git diff --check：通过；提交前暂存差异密钥扫描：零发现。

数据库验证已恢复：Owner 修复 Docker 后，company runner 的 fresh PG15/16/18 专项各 1/1、零跳过；历史重分类期间筛选的 fresh PG15/16/18 专项各 1/1、零跳过。后者明确制造 pre-275 测试证据，只证明历史兼容，不证明现代导入链路。PG15/16 完整套件仍运行中；server 完整期间筛选后复测退出 0，但仍有跳过，不能替代 fresh 数据库验收。根目录完整 npm test 重跑和 build 均退出 0，build 来源 cd61d4a1，最终候选仍需重新固定并验证。Render 当前未有可用的已登录操作会话。

恢复后顺序：数据库零跳过验证 → 固定候选 SHA → Owner 部署 staging → 只读读回与单公司单期试点 → 设置批准 → 重分类 → 验证后扩批。48 行原因、四格交叉表、22 个科目 / 影响 1248 行及 236/237 公司差集均仍需真实数据证据，不能从历史文档补算。
