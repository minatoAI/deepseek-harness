# 创建 teammate 时可裁剪其全局工具集

- **完成时间**：2026-09-12
- **分支**：feat/teammate-tool-filter（基于 master 778b1d5fca）
- **Commit**：
  - 4f5b03c210c3e1a6e666a529de34422072d50026 — feat(agent-team): per-teammate tool filter for spawn_teammate
  - （记录文件、索引与根 README 计数见本分支后续 `docs(change-logs)` 提交，属记账提交，不列入实质改动。）

## 摘要（Abstract）

Lead 通过 `spawn_teammate` 创建 teammate 时默认继承 Lead 的完整工具 preset，无法做最小权限裁剪。本次为创建路径增加可选的 `tool_filter`（`allow` / `deny` 两种写法）：teammate 加入父 preset 之后再做一次作用域限定的 `tools.restrict()`，只隐藏全局工具；9 个 Team 协作工具（`send_message`、`team_task_*`、`list_agents`、`wait_agent`）是作用域注册，恒保持可见，协作能力不受影响。空过滤 `{}` 在进入 `provisioning` 之前即被拒绝，不烧掉永久不可复用的 teammate 名。两个测试套件 62 个用例全部通过，`pnpm run build` 通过。

## 背景（Background）

需求来自 Agent Team 模式的实际使用：Lead 想按分工给 teammate 配最小工具集，例如 researcher 只保留检索类工具、不给写文件工具，以提高任务效率与质量。约束有三条：一是默认行为不变，不传过滤即完整继承；二是绝不影响内置 Team 协作工具，裁剪后 mailbox 与任务板仍可用；三是 teammate 名一旦进入 `provisioning` 即永久占用、失败也不复用，所以非法过滤必须在占用名字之前报错。机制上 `ctx.subagents.startContinuable()` 经 `applyChildComposition()` 已支持 `toolFilter`（`composeFrom(parent.ctx)` 后 `tools.restrict()`），且 `tools.restrict()` 只过滤全局工具、作用域注册恒可见——正是最小权限 teammate 需要的语义，本改动只是把这条已存在的能力接到 Team 创建路径上。

## 改动过程（Process）

### 公共类型（packages/experimental/agent-team/src/types.ts）

新增 `TeammateToolFilter` 接口（`allow` / `deny` 均为可选字符串数组），`SpawnTeammateRequest` 增加可选 `toolFilter` 字段并写明语义：作用域限定的 `tools.restrict()`、Team 工具不受影响、未知全局名创建期 loud 失败。第一版曾直接 `import type { ToolRestriction } from '@deepseek-ai/dsh-tools'` 并给包 tsconfig 加到 `core/tools` 的引用边，结果把 host 版工具声明经 `./client` 出口拖进浏览器编译面，`ctx.sessions` 被顶成 host 的 `SessionStore`，在 `client-ui-agent-team/mount.ts` 报 4 个 `TS2339`。用 stash 做开关对照定位（干净树 `tsc -b tsconfig.client.json` exit 0，恢复改动 exit 2），修复是本地声明结构相同的接口并撤回依赖与引用边：service 层把值原样透传给 continuable-subagent 层，结构类型天然兼容，不需要那层依赖；中途被中断的 `pnpm install` 留下的 `pnpm-lock.yaml` 脏改动一并撤回。

### 创建转发（packages/experimental/agent-team/src/roster.ts）

`spawnAdmitted()` 在调用 `startContinuable()` 的 request 里透传 `toolFilter`；空对象（`allow` 与 `deny` 皆无）在 `provisioning` 事务之前抛 `TeamError`（`TEAM_INVALID_TOOL_FILTER`），名字不被占用。`src/index.ts` 仅更新 `spawnTeammate` 的 JSDoc。

### 工具面（packages/experimental/tool-agent-team/src/index.ts）

`spawn_teammate` 新增 `tool_filter` 对象参数（`additionalProperties: false`，`allow` / `deny` 字符串数组，描述中声明 Team 协作工具恒可见），`{}` 在工具层即抛错且不占用名字，有值时透传为 `toolFilter`。

### 测试

`agent-team/tests/team.spec.ts` 加 1 例：空 `toolFilter` 报 `TEAM_INVALID_TOOL_FILTER` 且 `durable(lead).members` 仍为 `[]`。`tool-agent-team/tests/tool-team.spec.ts` 加 2 例：`allow` 过滤使子 agent 看不到全局 `write-code`、仍可见 `search-docs` 与 `send_message` / `team_task_list`、且 Lead 自身不受影响；空 `tool_filter` 报错且不占名。

## 总结（Summary）

Lead 现在可以按分工动态裁剪每个 teammate 的全局工具（`allow` 白名单或 `deny` 黑名单，`allow: []` 合法，即只留协作工具），默认不传则行为与改前完全一致。边界有三：未知全局工具名仍 loud 失败且会烧掉名字（进入 `failed`、永不复用），Lead 应使用已知工具名；`fork` 继承的历史若引用了被隐藏的工具会留下悬挂引用，干净的最小权限模式是 `fresh` + 过滤；包 README、Agent Note、`doc-sync` 与覆盖率门禁按约定延至 PR 前补（spike 阶段只保留 changelog 记账）。

## 验证（Verification）

- `pnpm vitest run packages/experimental/tool-agent-team/tests/tool-team.spec.ts`：13/13 通过（含新增 2 例）。
- `pnpm vitest run packages/experimental/agent-team/tests/team.spec.ts`：49/49 通过（含新增 1 例）。
- `npx tsc -b tsconfig.client.json`：通过（exit 0，确认浏览器面未被 host 声明污染）。
- `pnpm run build`：完整通过（含客户端产物构建）。
- 沙箱说明：vitest 在受限沙箱下曾报 vite `spawn EPERM`（命名管道拒绝），按仓库规则原样重试一次并升级沙箱后通过；`pnpm install` 曾因 `--prefer-offline` 中断留下 lockfile 脏改动，已撤回（本改动纯类型，无新依赖）。
- 可复现命令：`git checkout feat/teammate-tool-filter` 后依次运行以上四条；真机任务级验证（researcher 只留检索工具跑简单任务）待用户在源码模式下执行，见下一步测试方案。
