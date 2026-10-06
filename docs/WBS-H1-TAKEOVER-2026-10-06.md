# WBS H1 接手执行说明

基线为 ee35b223af2f02147aad9c4c7e98d181e440b55e。本次补丁需要通过验证并形成候选提交后，才能用于 staging。适用范围为 2026 H1；生产不在范围内。Cowork 已拒绝的远程 Shell 操作继续由 Owner 执行。

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
7. 检查 TB、报表、610000 残留、来源与凭证追溯，重放证明没有重复记账，然后扩大到十家公司与后续批次。

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

数据库验证阻塞：Docker Desktop 后端在 sailor-ingest.sock 的重命名步骤启动失败，Linux engine pipe 不存在。仅尝试停止/重新启动 Docker 相关进程；未重置 Docker、未删除卷。重命名该 socket 被 Windows 拒绝；后续清理同一 socket 的操作被自动审批策略拒绝，已停止该修复路径并重新打开 Docker Desktop，没有换方式绕过。需要 Owner 修复 Docker 启动后再跑规定的 fresh PG15/16，以及 staging PG18 对应的专项工具实测。

恢复后顺序：数据库零跳过验证 → 固定候选 SHA → Owner 部署 staging → 只读读回与单公司单期试点 → 设置批准 → 重分类 → 验证后扩批。48 行原因、四格交叉表、22 个科目 / 影响 1248 行及 236/237 公司差集均仍需真实数据证据，不能从历史文档补算。
