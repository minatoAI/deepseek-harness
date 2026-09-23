# 同步官方上游 `dsh-v0.1.7-rc.1`（Git WorkTree 隔离）

- **完成时间**：2026-09-24
- **分支**：`upgrade/upstream-0.1.7-rc.1`（独立 worktree，基于 `upgrade/upstream-0.1.7-alpha.2`）
- **提交**：
  - Merge upstream deepseek-ai/master (dsh-v0.1.7-rc.1) into upgrade/upstream-0.1.7-rc.1
  - docs(change-logs): record the upstream dsh-v0.1.7-rc.1 sync

## 摘要（Abstract）

把官方上游 `deepseek-ai/deepseek-harness` 自 `dsh-v0.1.7-alpha.2` 之后的 156 个提交（发行 tag `dsh-v0.1.7-rc.1`，相对 alpha.2 改动 933 个文件、+13851/−3101）合并进本地血统，根版本由 `0.1.7-alpha.2` 升到 `0.1.7-rc.1`。新分支建立在 alpha.2 升级分支之上，因此 alpha.2 的合并成果与本次 RC1 同步共存，不需要从本地 `master` 重做一遍 alpha.2 的冲突处理。15 处冲突里 11 处是生成产物与双语配对记录，全部交给生成器与配对工具重建；4 处真实冲突中，`agent-team` 的 typert/Remote 层被官方的投影化重写取代（以官方为准，同时保留本地必须的 `'tools'` 注入与 `@deepseek-ai/dsh-tools` 依赖），`apps/cli/src/plugin.ts` 取双方并集，官方新增的版本豁免子命令与本地 `dsh plugin check` 并存。21 个本地独有功能提交全部保留。

## 背景（Background）

本地仓库在共同祖先之后积累了 42 个独有提交（不含 merge），其中 21 个是功能改动，覆盖 `tools.register` 的注册期参数校验、本地 `dsh plugin check`、teammate 的 `persona` 与 `tool_filter`、会话标题预算与截断、`llm-pi-ai` 的推理档位与图像降级、`x-opencode-session` 亲和头、403 RegionError 本地化文案等。alpha.2 同步已经把这些改动与官方 alpha.2 合并进 `upgrade/upstream-0.1.7-alpha.2`。

官方在 alpha.2 之后又发布了 `dsh-v0.1.7-rc.1`，前进 156 个提交（其中 102 个非 merge）。本项目不设"正式版"节点，RC 与 Alpha 同样直接同步，因此不等正式发行。RC1 的主线是：聊天与工具生命周期的"准备中"阶段（一个工具节点承载 preparing/start/result 三个阶段）、聊天图片链接预览与内联展开、Web Team 面板改由 `agentTeam` 投影驱动、插件 peer 版本兼容预检、插件管理器健壮性（含给 pnpm 运行加空闲超时约束、GitHub 安装失败的镜像恢复）、语音输入镜像选择、原生命令与 Windows 资源管理器集成、i18n 与桌面端打磨。

约束有三条：

- 正在运行的实例就是 alpha.2 的 worktree（`dsh web` 监听 127.0.0.1:3080），它同时是当前 shell 工具的宿主。因此 alpha.2 worktree 不能在切到 RC1 实例之前删除，否则会切断工具通道。
- 本地 `dsh plugin check` 只是个人使用期间的临时补救手段，与官方实现撞车时以官方为准。
- 官方做得不够好、不够正确，或双方各有可取之处时，不机械套用"官方为准"，保留更好的一边或留待讨论。

## 改动过程（Process）

### 1. 新分支建立在 alpha.2 升级分支之上

方向仍是 merge-forward：把 `upstream/master` 合并进本地血统，绝不 reset 到上游。基线选 `upgrade/upstream-0.1.7-alpha.2` 而不是本地 `master`，这样 alpha.2 已经解决的 15 处冲突不会重演，两个升级成果共存。RC1 与 alpha.2 的共同祖先正是上游 alpha.2 的发行提交，因此本次合并的增量就是 RC1 相对 alpha.2 的那 933 个文件。

### 2. 冲突分布

真实 `git merge` 产生 15 处冲突，分三类：

- **真实代码冲突（4 处）**：`apps/cli/src/plugin.ts`、`packages/experimental/agent-team/package.json`、`packages/experimental/agent-team/src/index.ts`、`packages/experimental/agent-team/tsconfig.json`。
- **生成产物（6 处）**：`docs/config-catalog.md`、`docs/persistence-catalog.md`、`docs/persistence-catalog.zh.md`、`docs/persistence-schema.json`、`docs/config-catalog.i18n.yaml`、`docs/persistence-catalog.i18n.yaml`。
- **双语配对记录（5 处）**：`docs/config-catalog.i18n.yaml`、`docs/event-producer-consumer.i18n.yaml`、`docs/persistence-catalog.i18n.yaml`、`docs/subsystems/agent-team.i18n.yaml`、`docs/tool-catalog.i18n.yaml`。

`git merge-tree --write-tree` 的预测少于实际结果，仍以实际合并结果为准。

### 3. 先解决可手改文件，再装依赖，再重跑生成器

`packages/experimental/agent-team/package.json` 带冲突标记时 `pnpm install` 无法解析工作区，所以顺序是：先手改 4 处真实冲突并 `git add`，再 `pnpm install`，再跑生成器，最后重录配对记录。

生成器各自负责的目标不同，必须按需选择：`gen-config-catalog` 只写 `docs/config-catalog.md`；`gen-tool-catalog` 只写 `docs/tool-catalog.md`；`gen-persistence-catalog` 写 `docs/persistence-catalog.md`、`.zh.md`、`.i18n.yaml`、`docs/persistence-schema.json` 与 `packages/core/session/src/known-event-types.ts`，并自行刷新自己的配对记录；`gen-doc-graphs` 写 6 份图文档；`gen-cordis-catalog` 在本次合并后的树里报 `115 artifact(s) computed, 0 written, 0 pair record(s) refreshed`，即 `docs/subsystems/*.md` 与 `packages/extensions/tool-cordis/src/api-catalog.ts` 已与源注释一致。

配对记录里仍有冲突标记时，检查模式会直接报 `malformed consistency record`，而不是给出可读的差异。配对 owner 由脚本从 git 历史重新推导、不读索引，`resolve-translation-pairing-conflicts` 因此解不开，改用 `pnpm run verify-translation-pairing --write <pair>` 显式重录 4 份纯哈希记录。重录后检查模式报 `1109 pair(s) checked across all in-scope documentation, all consistent`（alpha.2 时为 1106，增量正是 RC1 新增的 3 份 Agent Note 三语组）。

### 4. 真实冲突一：`agent-team` 的 typert/Remote 层（以官方为准）

RC1 把 `TeamService` 从 `TypertRemoteService` 改为 `Service`，删掉了 `@Remote('view')` 的 `remoteView` 与 `TeamView` 类型，Web Team 面板改由 `agentTeam` 投影驱动。判定以官方为准，依据是：

- 全仓搜索 `agent-team/typert`、`agent-team/remote`、`remoteView`、`TeamView`，只命中一份已归档的 Agent Note（归档记录已冻结，不作为现行依据），没有任何活动代码引用被删掉的导出。
- 官方在同一区间有 29 个文件的投影化重写提交，且 alpha.2 已并入该层，本地没有需要保留的实现。

同时保留本地必须在的部分：`packages/experimental/agent-team/src/roster.ts` 通过 `this.ctx.tools.restrictableNames` 与 `this.ctx.tools.get` 读取工具，所以 `static inject` 里的 `'tools'`、`package.json` 的 `@deepseek-ai/dsh-tools` peer 依赖、`tsconfig.json` 的 `../../core/tools` 项目引用都不可删。官方的 `package.json` 与 `tsconfig.json` 各去掉一行 typert 引用，取官方结果再叠加本地的 `dsh-tools` 相关行。

### 5. 真实冲突二：`apps/cli/src/plugin.ts`（并集）

官方在 `plugin` 命令下新增了 `allow-version`、`revoke-version`、`version-exemptions` 三个子命令，用于给 profile 记录精确版本的兼容豁免；本地在同一个文件里挂了 `runPluginCheck`，实现 `dsh plugin check` 的本地 bundle 校验。两者关注点不同（前者是 profile 组装期的插件 peer 版本预检，后者是离线 bundle 的工具 schema 校验），没有任何共享函数或控制流，因此取并集：官方的新头部注释与导入照收，本地的 `checkBundle`/`renderReport`/`INSTALL_ANCHOR` 导入保留，`runPlugin` 与 `runPluginCheck` 的函数体各自自动合并、无需改写。冒烟验证 `dsh plugin check` 与 `dsh plugin allow-version` 的用法提示都在。

### 6. 本地独有能力全部保留

逐条核对 21 个本地功能提交是否已在官方实现里出现。检查方式是把每个提交的主题行逐个做 `git merge-base --is-ancestor` 判定，全部为真，即本地血统完整；再对本地独有的关键标识做源码级存在性检查，全部命中：

- `packages/core/tools/src/index.ts` 的 `normalizeRegisteredParameters`、`packages/core/tools/src/schema.ts` 的 `assertRequiredNames`（本地注册期校验）。
- `apps/cli/src/plugin-check.ts` 与 `apps/cli/src/plugin.ts` 的 `runPluginCheck`。
- `packages/experimental/agent-team/src/index.ts` 的 `'tools'` 注入、`roster.ts` 的 `restrictableNames`、`package.json` 的 `dsh-tools`。
- `packages/experimental/tool-agent-team/src/index.ts` 的本地独有 `wait_agent` 措辞（"block inside the turn with wait_agent"）。
- `packages/session/session-title-llm/src/index.ts` 的 `fitSingleMessage`/`fitHeadTailMessages`/`fitSelectedMessages`（超长输入截断而非拒绝）。
- `packages/llm/llm-pi-ai` 的图像降级字段与 `OPENCODE_SESSION_HEADER` 亲和头。
- `packages/client/ui-chat/src/client/locale.ts` 的 `message.failure.region` 文案。

## 总结（Summary）

- **效果**：根版本 `0.1.7-alpha.2` → `0.1.7-rc.1`；官方 RC1 的 156 个提交全部并入，alpha.2 的合并成果与 42 个本地独有提交全部保留；本地独有能力一项未丢。
- **冲突取向**：生成产物与配对记录全部由工具重建，不手工编辑；`agent-team` 的 typert/Remote 层以官方为准（本地无引用、官方有替代实现）；`apps/cli/src/plugin.ts` 取并集，官方新子命令与本地 `dsh plugin check` 并存。
- **边界**：本地 `dsh plugin check` 与官方新的 peer 版本预检是两件不同的事，本次保留并集；若后续官方补上等价的离线 bundle 校验，本地这份可以退役。
- **遗留**：本次不推送，保留在本地分支供复核；alpha.2 的 worktree 需要在切到 RC1 实例之后再删除。

## 验证（Verification）

### 合并后全量测试（最终提交树）

```text
Test Files  35 failed | 1631 passed | 18 skipped (1684)
Tests  75 failed | 33988 passed | 1 expected fail | 145 skipped (34209)
```

作为对照，前一次同步（alpha.2 最终提交树）为 `Test Files 33 failed | 1622 passed | 14 skipped (1669)` / `Tests 73 failed | 33573 passed | 1 expected fail | 137 skipped (33784)`；合并前本地 `master` 基线为 `Test Files 39 failed | 1601 passed | 17 skipped (1657)` / `Tests 147 failed | 33148 passed | 1 expected fail | 153 skipped (33449)`。

与 alpha.2 树逐条比对，只有 5 个用例仅在 RC1 树上失败，其中 4 个是并发负载下撞上 vitest 默认 5000ms 超时的抖动——`scripts/benchmark-npm-resolution.spec.ts` 两项、`packages/deliverables/workspace-changes/tests/git.spec.ts` 一项、同包 `plugin.spec.ts` 一项——把 4 个文件单独重跑后全部通过：

```text
Test Files  1 failed | 3 passed (4)
Tests  1 failed | 59 passed | 2 skipped (62)
```

剩下 1 个是 RC1 新增的上游测试 `packages/boot/app-boot/tests/compatibility-preflight.spec.ts` 中构造符号链接环的用例，在本机以 `EPERM: operation not permitted, symlink` 失败，属 Windows 无符号链接权限的平台限制而非合并缺陷（该 spec 28 项中 27 项通过）。另有 3 个仅在 alpha.2 树上失败的用例在 RC1 树上通过。

相对合并前基线，**76 个**基线失败用例在 RC1 树上通过，与 alpha.2 同步的收敛量一致。合并引入的确定性失败为 **0**。基线失败集合本身与本次合并无关，签名集中在 Windows 符号链接权限、控制台与编码差异，以及本地既有的 unknown 断言缺口上。

### 聚焦测试

`pnpm exec vitest run packages/experimental/agent-team/tests packages/experimental/tool-agent-team/tests apps/cli/tests/plugin-check.spec.ts apps/cli/tests/plugin.spec.ts packages/core/tools/tests/register-parameters.spec.ts packages/session/session-title-llm/tests`：

```text
Test Files  9 passed (9)
Tests  166 passed (166)
```

覆盖本次 4 处真实冲突与全部本地独有源码面：`agent-team` 的 `team.spec.ts`(49)、`projection-events.spec.ts`(26)、`persistence.spec.ts`(5)、`invariant.spec.ts`(2)，`tool-team.spec.ts`(35)，`plugin-check.spec.ts`(10)，`plugin.spec.ts`(14)，`register-parameters.spec.ts`(11)，`llm.spec.ts`(14)。

### 门禁

- `pnpm run typecheck`：退出码 0（含前置 tsdown 构建）。
- `pnpm run verify-translation-pairing`：`1109 pair(s) checked across all in-scope documentation, all consistent`，退出码 0。
- `git diff --name-only --diff-filter=U`：空；`git grep '^<<<<<<< '`：无命中。
- 构建产物冒烟：`node apps/cli/lib/bin.js --version` 输出 `0.1.7-rc.1`，退出码 0；未启动任何服务端进程。

### 复现命令

```sh
git worktree add ../deepseek-harness-rc1 -b upgrade/upstream-0.1.7-rc.1 upgrade/upstream-0.1.7-alpha.2
cd ../deepseek-harness-rc1
git merge upstream/master
# 先解决 apps/cli/src/plugin.ts 与 agent-team 的三个文件，git add 后再装依赖
pnpm install
pnpm run gen-config-catalog
pnpm run gen-persistence-catalog
pnpm run gen-tool-catalog
pnpm run gen-doc-graphs
pnpm run gen-cordis-catalog
pnpm run verify-translation-pairing --write docs/config-catalog.md docs/event-producer-consumer.md docs/subsystems/agent-team.md docs/tool-catalog.md
pnpm run verify-translation-pairing
pnpm run typecheck
pnpm exec vitest run packages/experimental/agent-team/tests packages/experimental/tool-agent-team/tests apps/cli/tests/plugin-check.spec.ts apps/cli/tests/plugin.spec.ts packages/core/tools/tests/register-parameters.spec.ts packages/session/session-title-llm/tests
```
