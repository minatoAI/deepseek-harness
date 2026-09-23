# 改动记录（Change Logs）

[English](README.md) | 中文

本目录记录本仓库每次改动的背景与过程。规范见 [AGENTS.md](AGENTS.md)。

## 记录列表（按完成时间倒序）

- **2026-09-24** — [在 Git WorkTree 隔离下同步官方 `dsh-v0.1.7-rc.1`](2026-09-24-upstream-sync-rc1.md)：官方自 alpha.2 之后的 156 个提交并入一个叠在 alpha.2 升级分支上的新分支，两次同步成果共存、不必重做 alpha.2 的冲突处理；`agent-team` 的 typert/Remote 层随官方投影化重写、本地 `'tools'` 注入与 `@deepseek-ai/dsh-tools` 依赖保留，`dsh plugin` 同时保留官方的版本豁免子命令与本地 `check`——21 个本地功能提交全部存活。
- **2026-09-23** — [在 Git WorkTree 隔离下同步官方 `dsh-v0.1.7-alpha.2`](2026-09-23-upstream-sync-alpha2.md)：官方 162 个提交在独立 worktree 里并入本地血统，与本地改动重复或冲突之处一律以官方为准、本地独有能力全部保留；修复两处合并回归——被误删的本地独有 `wait_agent` 提示词、以及拒绝 MCP 裸 `{ type: 'object' }` 对象根的注册期校验（属合并前既有缺陷），cordis 目录按源注释重新生成。
- **2026-09-18** — [收窄内置 Web 搜索禁用：只停 DeepSeek 搜索 provider](2026-09-18-disable-web-search-provider.md)：profile 补丁层改为只禁用 `web-search-deepseek`，搜索调用在发出请求前以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败、额度零消耗，匿名抓取的 `web-fetch-http` 保留 `web_fetch`；补丁文件注释同步更正。
- **2026-09-17** — [内置 Web Search 评测与禁用](2026-09-17-builtin-web-search-assessment.md)：扫描 519 个会话证实"用不了"源于凭证而非插件，与上游比对确认源码未改；查证官方文档确认服务端工具机制与成本结构，实测未命中缓存输入占账单 79.9% 且结构性不可优化；同查询对照显示来源质量不及 dsh-jina，据此在 profile 补丁层禁用整条 `web` 栈。
- **2026-09-16** — [文档门禁恢复：改动记录引用格式与生成产物](2026-09-16-doc-gate-compliance.md)：9 条记录改用提交主题行、规范去掉 commit 标识符要求、重算 cordis 与 persistence 产物；doc-sync 的 6 项失败降为 1 项平台限制。
- **2026-09-13** — [会话标题在思考模型上稳定生成](2026-09-13-session-title-thinking.md)：标题预算 64→256，pi-ai 标题请求在模型提供 `off` 档时关闭思考，无 `off` 的模型保持原默认。
- **2026-09-12** — [创建 teammate 时可透传独立 persona](2026-09-12-2025-teammate-persona.md)：`spawn_teammate` 新增 `persona`（独占覆盖继承来的 Lead persona，不传照旧，空文本占名前拒绝）。
- **2026-09-12** — [创建 teammate 时可裁剪其全局工具集](2026-09-12-teammate-tool-filter.md)：`spawn_teammate` 新增 `tool_filter`（`allow`/`deny`），Team 协作工具恒可见，空过滤在占用名字前拒绝。
- **2026-09-06** — [OpenCode 路由自动携带 x-opencode-session 会话亲和性](2026-09-06-opencode-session-affinity-header.md)：llm-pi-ai 对 OpenCode 系路由自动发送 loop 会话 id，无需配置，显式标头优先。
- **2026-09-04** — [大图片请求体被网关快速重置时自动降级重试](2026-09-04-image-payload-fast-reset-degradation.md)：`llm-pi-ai` 在大载荷快速传输重置时逐轮减半图片预算重试，另补脱敏传输原因日志与压缩侧图片剥离。
- **2026-08-19** — [`reasoningEfforts.default` 点名的档位加入模型提供的档位集合](2026-08-19-reasoning-efforts-default-offer.md)：`{ default: medium, high: high }` 现在直接提供 medium 与 high 两档并以 medium 为默认，不再要求默认档重复声明为档位键。
- **2026-08-18** — [为工具参数错误补充完整归属路径](2026-08-18-tool-argument-diagnostic-paths.md)：：`defineTool()` 以工具名作为运行时校验根路径，使直接调用与 Code Mode 子分发明确报告 `run_code.description`、`pwsh.description` 等完整参数路径。
- **2026-08-17** — [接受 `reasoningEfforts.default` 作为保留选择键](2026-08-17-reasoning-efforts-default.md)：`llm-pi-ai` 将 `default` 视为每模型默认档选择键而非未知档位，避免整节 settings 注册失败导致自定义提供方消失。
- **2026-08-14** — [工具参数 Schema 契约校验与 `dsh plugin check` 本地校验](2026-08-14-tool-schema-contract.md)：`tools.register` 注册期校验参数 schema 并指名报错，新增 `dsh plugin check` 本地组合包校验命令，配套中英双语 bundle 开发清单。
