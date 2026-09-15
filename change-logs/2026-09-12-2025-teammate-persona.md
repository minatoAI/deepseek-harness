# 创建 teammate 时可透传独立 persona

- **完成时间**：2026-09-12（UTC）
- **分支**：feat/teammate-tool-filter（基于当时的 master）
- **Commit**：
  - feat(agent-team): per-teammate persona shadowing for spawn_teammate
  - （记录文件、索引与根 README 计数见本分支后续 `docs(change-logs)` 提交，属记账提交，不列入实质改动。）

## 摘要（Abstract）

teammate 建起来是 `composeFrom(parent)`，Lead 的 persona（含建队职责与领队口吻）会原样继承，出现身份混淆：teammate 读到"你应该建队"却没有建队权限。代码自动剥离 leader 段落不可靠（要解析自然语言），本次走显式覆盖机制：`spawn_teammate` 新增可选 `persona` 字符串，有传则独占覆盖该 teammate 的 persona 区、无则照旧继承；空文本在占名前拒绝。底层 `persona` 能力（`deployment:persona-prefix` 同名 section 覆盖 + descriptor 快照 + 冷恢复重放）本来就绪，子包自有单测，本改动只把 Team 断掉的透传线接通。两个测试套件 65 个用例全部通过，两包类型检查干净。

## 背景（Background）

直接起因是用户自建的 `leader` preset：persona 要求主动并行委派、严格建队、最小工具集，而 teammate 会把这整段继承过去——"no matter if you are subagent 也要委派"与"只有 Lead 能建队"打架，"ignore team-creation duties"又可能被误读成连 one-shot subagent 都不能用。两个候选方案：按角色拆独立 preset（常驻挂载、分代不回收，机制太重，否决，结论记入本记录备 PR 引用）；创建参数级覆盖（跟 `tool_filter` 同一量级，选中）。`tool_filter` 解决"用什么工具"，`persona` 解决"以什么身份说话"，两者正交。

## 改动过程（Process）

### 语义确认（只读代码，未改底层）

`packages/subagent/subagent/src/types.ts` 写明 `persona` 是 shadowing 语义：子 scope 注册同名 `deployment:persona-prefix` section，nearest scope wins，只影响该 child；`child-agent.ts:applyChildComposition()` 先 join 父 preset、再装固定 `subagent:delegation` 上下文、再装 persona 覆盖与 tool restrict，创建与冷恢复同走此函数；`descriptor.ts` 快照 persona，`continuation.ts` 在创建与冷恢复两处重放。spawn/fork 两个 in-process provider 均声明 `persona: true`，而 Team 用的正是这两个 provider（`freshProvider: spawn`、`forkProvider: fork`）。结论：Lead 现写的 persona 必须是自包含的（身份 + 协作风格自带），Team policy 与 delegation 上下文不受影响。

### 透传实现（镜像 tool_filter 改动）

`agent-team/src/types.ts`：`SpawnTeammateRequest` 加 `persona?: string`，JSDoc 写明覆盖语义、自包含要求与建队职责归 Lead。`agent-team/src/roster.ts`：`spawnAdmitted()` 在占名前用现有 `requiredText(persona, 16_384)` 校验（空文本报 `TEAM_INVALID_ARGUMENT`，名字不烧），透传裁剪后的值给 `startContinuable`；两处 `spawnTeammate` JSDoc 补 `optional persona`。`tool-agent-team/src/index.ts`：`spawn_teammate` 加 `persona` 字符串参数，schema 描述写明"替换继承、自包含、去掉建队职责、省略即继承、空文本拒绝"，空文本工具层先拦再透传。纯字符串透传，无新依赖，浏览器编译面不受影响（上次 `ToolRestriction` 直引的教训不再犯）。

### 测试（镜像 tool_filter 用例）

`agent-team/tests/team.spec.ts` 加 1 例：空白 persona 报 `TEAM_INVALID_ARGUMENT` 且 `members` 为空。`tool-agent-team/tests/tool-team.spec.ts` 加 2 例：带 persona 建 `scout`，子 prompt 含定制文本、仍含 `Your Team role is teammate`（policy 未被覆盖）、Lead prompt 不含定制文本（作用域隔离）；空白 persona 报错且 `listMembers` 只有 lead。

## 总结（Summary）

Lead 现在每次建队可同时定两样：`tool_filter` 定工具集，`persona` 定身份，两者都是创建时快照、建完不可改。典型写法是 worker 自包含小 persona（身份 + 保留 one-shot subagent 与输出风格指引 + 不写建队职责）。边界：覆盖是整区替换不是追加，Lead 不能只写"增量"；fork + persona 与 fork + filter 的历史悬挂注意事项不变；部署级默认 teammate persona（如 researcher 模板）未做，留待转正。包 README、Agent Note、`doc-sync` 与覆盖率门禁继续延至 PR 前。

## 验证（Verification）

- `pnpm vitest run packages/experimental/tool-agent-team/tests/tool-team.spec.ts packages/experimental/agent-team/tests/team.spec.ts`：65/65 通过（15 + 50，含新增 3 例；此前基线 62/62）。
- `pnpm exec tsc --noEmit -p packages/experimental/agent-team/tsconfig.json` 与 `tool-agent-team` 同命令：均通过（无输出）。
- 提交 hook（lefthook：lint staged / whitespace / vendor manifest guard）：通过，0 错误，仅 2 条 roster.ts 既有 `oxlint-disable` 未使用警告（与本改动无关，之前提交已存在）。
- 沙箱说明：vitest 与 tsc 均先遇受限沙箱 `spawn EPERM`，按仓库规则原样重试一次并升级沙箱后通过。
- 可复现命令：`git checkout feat/teammate-tool-filter` 后依次运行以上命令；真机任务级验证（带 persona + tool_filter 建队跑简单任务）待用户在源码模式下执行。
