# 同步官方上游 `dsh-v0.1.7-alpha.2`（Git WorkTree 隔离）

- **完成时间**：2026-09-23
- **分支**：`upgrade/upstream-0.1.7-alpha.2`（独立 worktree）
- **提交**：
  - Merge upstream deepseek-ai/master (dsh-v0.1.7-alpha.2) into upgrade/upstream-0.1.7-alpha.2
  - docs(change-logs): record the upstream dsh-v0.1.7-alpha.2 sync

## 摘要（Abstract）

把官方上游 `deepseek-ai/deepseek-harness` 的 162 个提交（发行 tag `dsh-v0.1.7-alpha.2`，相对共同祖先改动 869 个文件、+21355/−11052）合并进本地血统，根版本由 `0.1.7-alpha.1` 升到 `0.1.7-alpha.2`。合并全程在一个 Git WorkTree 里进行，正在运行的实例及其工作树没有被改动。功能重叠与冲突一律以官方为准，官方未实现的本地独有能力全部保留。合并后修掉两处回归：一处是本地独有提示词被误删，一处是本地注册期 schema 校验拒绝 MCP 的裸对象根——后者同时是合并前就存在的本地缺陷。全量测试的失败文件集合收敛为合并前本地 `master` 失败集合的子集。

## 背景（Background）

本地仓库在共同祖先之后积累了 42 个独有提交（不含 merge），包括 `tools.register` 的注册期参数校验、本地 `dsh plugin check` 命令、teammate 的 `persona` 与 `tool_filter`、会话标题预算调整、`llm-pi-ai` 的推理档位与图像降级、`x-opencode-session` 亲和头等。官方上游在同一区间前进 162 个提交并发布 `dsh-v0.1.7-alpha.2`。

约束有两条：

- 正在运行的 DeepSeek Harness（`dsh web`，监听 127.0.0.1:3080）不能被影响，因此不能在主工作树里做合并、装依赖或跑测试。
- 本地改动若已被官方独立实现，或与官方行为冲突，一律以官方为准；官方未实现的本地独有能力保留。

## 改动过程（Process）

### 1. 用 WorkTree 隔离

建两个 linked worktree：升级目标分支 `upgrade/upstream-0.1.7-alpha.2`（合并与全部验证在这里进行），以及停在合并前本地 `master` 的 `dsh-baseline`（用来把合并后的测试失败区分为"合并引入"还是"本地既有"）。主工作树只多了 `.git/worktrees` 元数据，源码与运行中的进程全程未动。

### 2. 确定合并方向

方向是 merge-forward：把 `upstream/master` 合并进本地血统，绝不 reset 到上游，以保证 42 个本地独有提交存活。

### 3. 冲突与双语配对

真实 `git merge` 产生 15 处冲突，其中 5 处是 `*.i18n.yaml` 双语配对记录（`git merge-tree --write-tree` 预测的 10 处不含它们，以实际合并结果为准）。`.gitattributes` 把 `*.i18n.yaml` 绑定到自定义 merge driver，而配对的 owner 归属由脚本从 git 历史重新推导、不读索引，所以改用 `pnpm run verify-translation-pairing --write <pair>` 显式重录。

双方自共同祖先以来都改过的文件共 36 个，其中 `src/` 下 5 个：`packages/core/tools/src/index.ts`、`packages/core/tools/src/schema.ts`、`packages/experimental/tool-agent-team/src/index.ts`、`packages/extensions/tool-cordis/src/api-catalog.ts`、`packages/client/ui-chat/src/client/locale.ts`。

### 4. 本地独有功能的去留审计

逐条核对 42 个本地独有提交是否已被官方独立实现：

- **保留（官方未实现）**：`tools.register` 的注册期参数校验与本地 `dsh plugin check`、teammate 的 `persona` 与 `tool_filter`、会话标题预算 64→256、`llm-pi-ai` 的推理档位与图像降级、`x-opencode-session` 亲和头、fork-seed 收件箱、403 RegionError 本地化文案、`agent-team` 的 `@deepseek-ai/dsh-tools` peer 依赖与 tsconfig 路径。
- **语义随官方、措辞保留**：`tool-agent-team` 的 `wait_agent` 调度语义官方已实现，但其提示词里 "block inside the turn with wait_agent" 等本地独有措辞官方没有。
- **冲突以官方为准**：见第 6 节。

### 5. 回归一：本地独有提示词被误删

初版合并把 `wait_agent` 的两段本地独有措辞当成官方重复实现删掉了，`packages/experimental/tool-agent-team/tests/tool-team.spec.ts` 随即失败。用 `git merge-file -p <ours> <base> <theirs>` 重建真实自动合并结果后确认：官方在源码与测试里都没有这两句话，属本地独有，已按原文恢复。

### 6. 回归二：注册期 schema 校验拒绝裸对象根（以官方为准）

- **现象**：46 个测试报 `invalid parameters schema: properties must be an object of property schemas.`，来自 `packages/core/tools/src/schema.ts` 的 `assertCompositeRootParameters`。
- **根因**：本地校验把没有 `properties` 的对象根判为非法，而官方 `packages/mcp/mcp-client/src/tools.ts` 把 MCP 服务器发布的 `inputSchema` 原样透传给 `tools.register`，按 MCP 规范无参数工具发布的正是裸 `{ type: 'object' }`。该 schema 被拒后整台服务器的工具被静默丢弃。
- **判定**：这不是合并引入。在 `dsh-baseline` 工作树跑同样的两个包得到 69 failed / 66 passed，失败原因一致；`schema.ts` 的校验函数在合并前后逐字节相同。
- **处理**：按"官方为准"放宽 `assertObjectParameters`——对象根没有 `properties` 时视为开放对象放行，仅当声明了 `required` 时校验其必须是属性名字符串数组；`oneOf`/`anyOf` 组合根仍走原分支校验。新增 `assertRequiredNames` 辅助函数，本地校验特性本身保留。

### 7. 生成产物同步

`register()` 的 JSDoc 是 cordis 目录的生成来源。改完 `packages/core/tools/src/index.ts` 的注释后必须重跑 `pnpm run gen-cordis-catalog`，由它重写 `docs/subsystems/tools.md`、`docs/subsystems/tools.zh.md` 的目录区域与 `packages/extensions/tool-cordis/src/api-catalog.ts`，并刷新 `docs/subsystems/tools.i18n.yaml`。手改文档区域会被生成器还原，因此以源注释为准。

## 总结（Summary）

- **效果**：根版本 `0.1.7-alpha.1` → `0.1.7-alpha.2`；官方 162 个提交全部并入，42 个本地独有提交全部保留；合并引入的测试失败为 0。
- **顺带修复**：本地既有的 MCP 工具静默丢弃缺陷随本次放宽一并修掉。
- **边界**：`verify-no-unknown-casts` 的既有 baseline 缺口，以及 Windows 无符号链接权限导致的环境性失败（`verify-cordis-config`、`verify-node-next-types`、doc-sync 的 `project-doc-site` 一项），均与本次合并无关，本次不改动。
- **遗留**：上游与本地的重叠已按"官方优先、本地独有保留"处理；本次不推送，保留在本地分支供复核。

## 验证（Verification）

### 合并前基线（对照证据）

在 `dsh-baseline` 工作树（停在合并前本地 `master`）跑全量测试：

```text
Test Files  39 failed | 1601 passed | 17 skipped (1657)
Tests  147 failed | 33148 passed | 1 expected fail | 153 skipped (33449)
```

### 合并后全量测试（最终提交树）

```text
Test Files  33 failed | 1622 passed | 14 skipped (1669)
Tests  73 failed | 33573 passed | 1 expected fail | 137 skipped (33784)
```

逐条比较失败用例：**76 个**基线失败用例在合并后通过，其中包含此前被第 6 节 schema 缺陷拖垮的 `packages/mcp/mcp-client/tests/` 四个 spec，以及 `browser-use-runtime`、`browser-use-stagehand-native`、`computer-use-cua-driver-native`。只有 **2 个**用例仅在合并后失败，且都在 `packages/skill/skill-office/tests/checkers.spec.ts`：该 spec 两个用例各自耗时约 2.5s，紧贴 vitest 默认 5000ms 超时（基线同文件总计 6526ms），并发负载下会超时；在最终提交树上单独重跑为 `2 passed`、耗时 5.19s。因此合并引入的确定性失败为 **0**。

合并前的失败集合本身与本次合并无关，签名集中在 Windows 符号链接权限、控制台与编码差异，以及本地既有的 unknown 断言缺口上。首轮全量测试中另有 `typert/generator/tests/cordis-catalog.spec.ts` 失败，原因是第 7 节的手改文档区域与源注释不一致，重跑生成器后该 spec 5 项全通过。

### 聚焦测试

`pnpm exec vitest run packages/mcp/mcp-client/tests packages/core/tools/tests packages/spill/spill-policy/tests packages/experimental/tool-agent-team/tests`：

```text
Test Files  28 passed (28)
Tests  659 passed (659)
```

覆盖 `register-parameters.spec.ts`(11)、`mcp-client.spec.ts`(53)、`tool-definition.spec.ts`(4)、`reconnect.spec.ts`(31)、`multimodal.spec.ts`(9)、`multimodal-recovery.spec.ts`(5)、`tool-team.spec.ts`(35)。

### 门禁

- `pnpm run typecheck`：退出码 0。
- `pnpm run build`：退出码 0，`build: recorded 263 client artifact(s) with 3 public value(s)`。
- `pnpm run gen-cordis-catalog`：`115 artifact(s) computed, 3 written, 1 pair record(s) refreshed`；随后 `pnpm run verify-cordis-catalog` 报 `115 generated file(s)/region(s) are up to date`，退出码 0。
- `pnpm run verify-translation-pairing`：`1106 pair(s) checked across all in-scope documentation, all consistent`，退出码 0。
- `pnpm run doc-sync`：`41 passed, 1 failed`；唯一失败是 `scripts/project-doc-site.spec.ts` 里需要创建符号链接的用例（`EPERM`，该 spec 64 项中 63 项通过），属平台限制。
- `pnpm run hygiene`：`15 passed, 3 failed`；3 项均为合并前既有。`verify-no-unknown-casts` 报出的 5 处 `unknown` 断言在合并前的 `master` 上内容哈希完全一致（仅 `packages/core/tools/src/schema.ts` 因新增辅助函数从第 564 行后移到第 583 行），本次未新增任何 `unknown` 断言；另 2 项 `verify-cordis-config`、`verify-node-next-types` 因 Windows 无法创建符号链接而失败。
- 构建产物冒烟：`node apps/cli/lib/bin.js --version` 输出 `0.1.7-alpha.2`，`--help` 正常打印用法，均退出码 0；未启动任何服务端进程。

### 复现命令

```sh
git worktree add ../deepseek-harness-upgrade -b upgrade/upstream-0.1.7-alpha.2 master
cd ../deepseek-harness-upgrade
git merge upstream/master
pnpm install
pnpm run gen-cordis-catalog
pnpm run verify-translation-pairing
pnpm run typecheck && pnpm run build && pnpm run doc-sync && pnpm run hygiene
pnpm exec vitest run packages/mcp/mcp-client/tests packages/core/tools/tests
```
