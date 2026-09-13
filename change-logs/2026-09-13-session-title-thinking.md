# 会话标题在思考模型上稳定生成：放大预算并在标题请求中关闭思考

- **完成时间**：2026-09-13
- **分支**：feat/teammate-tool-filter（基于 master@778b1d5fca，其上另有 teammate 系列提交，本改动仅含下列两笔）
- **Commit**：
  - 411a8a62a0595ad2e3029e791c82f665a103d518 — fix(session-title): enlarge title output budget for thinking models
  - bc9d218072d3f1c09e59d39370a80fa5f42be63e — fix(llm-pi-ai): disable thinking for session-title when off is offered
  - （记录文件、索引与根 README 计数见本分支后续 `docs(change-logs)` 提交，属记账提交，不列入实质改动。）

## 摘要（Abstract）

Web 端会话标题长期只显示 fallback（首条消息开头几个字），原因是标题辅助调用沿用主会话路由，但输出预算只有 64 token，思考模型的思考过程先把预算吃光，标题正文被截断，生成失败后回退到 fallback。本次做两处改动：一是将标题 `maxOutputTokens` 从 64 放大到 256；二是 pi-ai 适配器在标题请求（`purpose: 'session-title'`）且模型提供 `off` 档时强制走 `off`（不思考），与 DeepSeek 适配器已有的行为对齐，没有 `off` 的模型保持原 profile 默认、行为不变。pi-ai 全包 393/393 单测通过，headless profile 套件回到改前基线失败集（均为 Windows 跑 Linux 快照的平台差），全仓 `typecheck` 通过。

## 背景（Background）

用户报告：Web 端当前会话标题直接取消息开头几个字，不够人性化。排查会话导出 `session.v3.jsonl` 发现 `seq=14 session/title fallback` 之后有 `seq=15 session/title-llm-request`（路由 `opencode-go-test/muse-spark-1.3-contributor`、预算 64），但从未出现 provider 标题。标题服务按 `first-prompt` 节奏、经 `resolveRoute()` 继承主请求路由发起 `purpose: 'session-title'` 的辅助 `ctx.llm.stream` 调用；DeepSeek 适配器对该 purpose 禁思考，而 pi-ai 适配器此前忽略 `purpose`、沿用 profile 默认思考档（如 `xhigh`）。64 token 的预算被思考 trace 占满是失败主因。约束有三：默认行为零回归（没有 `off` 的路由行为必须与改前一致）、失败仍走标题服务的 warn + fallback 兜底、不新增依赖与配置项。

## 改动过程（Process）

### 预算放大（packages/bundle/base/cordis.patch.yml）

`session-title-llm` 的 `maxOutputTokens: 64 → 256`，并在注释中说明思考模型 sizing。`GenerateOptions.purpose` 的 seam 契约（`packages/llm/llm/src/types.ts`）本来就允许按 purpose 定生成策略，所以 256 只作用于标题辅助调用，主会话不受影响。6 个 headless 期望快照与 4 处 mock-server 标题嗅探（`max_tokens === 64`）及 Web smoke 测试同步更新到 256；`provider.e2e.ts`（test-local 64）与 SDK 快照（test-local 32）是测试自有值，刻意不动。

### pi-ai 标题关思考（packages/llm/llm-pi-ai/src/adapter.ts）

在 `streamWithSnapshot` 中新增 `titleEffort`：标题请求且 `getSupportedThinkingLevels(model).includes('off')` 时取 `'off'`，排在 `options.reasoningEffort ?? configuredDefaultEfforts ?? profile.reasoning` 之前进入 `resolveReasoningLevel()`。`off` 经 `profileOptions` 翻译为省略 reasoning 参数：目录模型 wire 上为 `thinking: { type: 'disabled' }`，手声明 `off: null` 的模型省略思考参数。`off` 的有无只读模型元数据（内置 catalog 或手声明 `reasoningEfforts` 的 key 集合），与用户配置的默认档无关；没有 `off` 的模型保持原默认（如 `xhigh`），请求照发、失败照走 fallback，不比改前更差。附带发现：只配 `{ default: xhigh }` 的手声明模型会被解析为仅提供 `['xhigh']`，标题仍带思考发送，用户需显式声明 `off:` 才能让标题不思考。

### 测试与文档

`adapter.spec.ts` 新增 2 例：提供 `off` 的 `deepseek-v4-flash`（profile 默认 `max`）标题请求断言 wire `thinking: disabled` 且无 `reasoning_effort`；不提供 `off` 的手声明 `acme-think`（`reasoningEfforts: { low, high }`）标题请求断言保留 profile 默认 `reasoning_effort: 'high'`。`llm-pi-ai/README`（中英）与 `session-title-llm/README`（中英）各加一句标题关思考说明，`i18n.yaml` 指纹重录。Agent Note 记在 `.agents/notes/implemented/bug-fix/2026-09-13-session-title-budget-for-thinking-models.*`。

### 过程中的环境坑

两次与代码无关的失败：一是 `vitest` 在 `workspace-write` 沙箱下 `spawn EPERM`，按仓库规则原样重试并升级到 `danger-full-access` 后通过；二是 pi-ai 34/65 mock-server 用例失败，根因是沙箱代理变量（`http_proxy/https_proxy=127.0.0.1:7897` + `NODE_USE_ENV_PROXY=1`）劫持回环请求，清空代理变量后全过。预算放大后 headless 套件多出 2 个失败，是硬编码 `max_tokens === 64` 的标题嗅探，更新到 256 后回到基线。

## 总结（Summary）

`muse-spark` 这类提供 `off` 的模型现在标题调用是“不思考 + 256 上限”，两处堵点都打通，重启 `dsh web` 后新建会话即可看到模型生成的标题。边界：没有 `off` 的路由行为与改前完全一致，仍可能因思考吃掉预算而回退到 fallback，此时应显式配置标题 `provider`/`model` 覆盖或声明 `off`（如 `reasoningEfforts: { off:, xhigh: xhigh, default: xhigh }`，主聊天默认保持 `xhigh`）。工作区内与本改动无关的未跟踪文件（`agent-team-guide.md`、`team-architecture.png`、`team-tool-filter-test.patch.yml`、`team-verify/`）原样保留，未纳入提交。

## 验证（Verification）

- `packages/llm/llm-pi-ai` 全包：15 文件 / 393 用例全绿（含新增 2 例）。
- headless profile 套件：失败集与改动前基线逐个一致（bash/pwsh 平台差、`Approval policy` 环境文本、一个既有 `fetch failed`），无标题相关 diff。
- `pnpm run typecheck` 全仓通过（exit 0）。
- `verify-agent-note-format` 在沙箱升级后仍因 esbuild 服务 spawn 失败，已按门禁规则手工核对 Note 格式，CI 拥有该信号。
- 可复现：检出本记录所列两笔 commit 后运行 `pnpm vitest run packages/llm/llm-pi-ai`（需清空 `http_proxy`/`https_proxy`/`NODE_USE_ENV_PROXY`）与 `pnpm run typecheck`；产品验证需重启 `dsh web` 并新建会话观察标题。
