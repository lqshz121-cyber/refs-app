# Z02 — 隔离 E2E 阻断分类

会话 claude-9c9cd162 · 2026-09-20 · **实现 + 7/7 通过，无需任何真实凭据**

## 0. 解决的问题

七种情况在操作员眼里都是"staging E2E 没跑通"，但**处置方式完全不同**：重新部署 / 授角色 / 开开关 / 等数据 / 找 Render。混在一起就会有人花一小时排查错的那一个。

交付：`server/runtime/staging-blocker-classifier.mjs`（纯函数）+ `tests/staging-blocker-classification.test.mjs`（**7/7**）。

## 1. 七类 + 兜底

| 类 | 阻断 | 含义 | 清除方式 | X04 步 |
|---|---|---|---|---|
| `EXTERNAL_DEPENDENCY_UNCONFIGURED` | ✅ | 依赖已开但配置键缺失，进程拒绝启动 | 在 Render 补上具名键。**拒绝是对的**：半配置的依赖不该运行 | 1 |
| `RELEASE_MISMATCH` | ✅ | 某服务报的 SHA 不是候选 | 用候选 SHA 重部署该服务。**不要在版本混杂的集群上做业务验收** | 2 |
| `API_UNREACHABLE` | ✅ | API 根本没应答（DNS/TLS/拒连/边缘 5xx） | 查 Render 服务健康。在此之前下游一切无意义 | 3 |
| `ROLE_MISSING` | ✅ | 已认证，但 actor 对该实体无 grant（403） | Owner 授角色。**绝不自授** | 5 |
| `STATEMENT_SCOPE_MISSING` | ✅ | 对实体有 grant，但缺该命令所需的具体权限（403） | Owner 把 grant 扩到具名权限 | 5 |
| `EMPTY_DATA` | ❌ | 一切正常，答案确实为空 | 受控导入前的预期状态。**诚实的空结果是通过，不是失败** | 6 |
| `WBS_DISABLED` | ❌ | WBS pilot 为 DISABLED | **范围声明不是故障**。记 BLOCKED 并继续，不得用本地 fake 替代 | 7 |
| `UNCLASSIFIED` | ✅ | 未匹配任何已知形态 | 停下来找人看。**不得当作通过** | — |

## 2. 三个设计决定

### 2.1 `ROLE_MISSING` 与 `STATEMENT_SCOPE_MISSING` 必须分开
两者都表现为 **403**，但一个要"给实体授权"，另一个要"把已有授权扩到某个动词"。合并会把操作员送到错的人那里。
分类器据 `permissionDenied.entityGranted` 区分；**信息不足的裸 403 退化为较宽的 `ROLE_MISSING`，而不是猜更窄的那个**。

### 2.2 优先级：配置 → 可达性 → 版本 → 授权
不是随意排的：
- **配置优先**，因为拒绝启动的进程回答不了任何问题
- **版本先于授权**，因为**错误构建上的 403 什么也证明不了**

已由 Z02-4 钉住：同时存在缺配置、不可达、版本漂移、403 时，仍先报缺配置；同时存在漂移与 403 时先报漂移。

### 2.3 fail closed
Z02-3 断言：空观测、只有 `reachable`、200 但无其他信息、418 —— **一律 `UNCLASSIFIED` 且 `blocking:true`**。
`200 + resultCount>0` 也归 `UNCLASSIFIED` —— 那不是本分类器的职责，**但也不允许被静默报成健康**。

## 3. 诊断不泄密（Z02-5）

诊断只携带**键名与状态码**：
- 缺配置 → `missing_config_keys=S3_ENDPOINT,SCANNER_ENDPOINT`（**键名是可操作信息，取值永不出现**）
- 版本漂移 → `release_drift_services=web`（**报哪个服务漂了，不报它跑的是哪个 SHA**）

测试显式断言输出不含 `sk_live`、`Bearer `、`password=`、`-----BEGIN`，且不回显观测到的 SHA。

## 4. 纯函数（Z02-7）

分类**不做任何 I/O**：无网络、无数据库、无写入，且不改环境变量。
因此它能在**完全无凭据**的预检里运行 —— 这正是"隔离 E2E 阻断分类"的要求。

## 5. 与 X04 九步脚本的对接

`x04Disposition(classification)` 给出：
- `stop_at_step` —— 阻断类停在它被检出的那一步
- `continue_allowed`
- `record_as` —— `BLOCKED` / `PASS_EMPTY` / `BLOCKED_NON_FATAL`

**两个非阻断类记法不同**：`EMPTY_DATA` 记 `PASS_EMPTY`（是通过），`WBS_DISABLED` 记 `BLOCKED_NON_FATAL`（不是通过，只是不致命）。这个区分避免把"WBS 没开"日后误读成"WBS 验过了"。

## 6. 零真实写入

分类器是纯函数；测试全部是对观测对象的断言，**不连数据库、不发网络请求、不写任何数据**。

## 7. Owner 决策

- **D-Z02-1** 是否把分类器接入 X04 步骤 1–3 作为强制预检（在无凭据环境下即可跑）。
- **D-Z02-2** 七类是否够用。若 staging 实跑中出现 `UNCLASSIFIED`，应把新形态补成具名类而不是放宽兜底 —— 兜底放宽就等于取消 fail closed。
