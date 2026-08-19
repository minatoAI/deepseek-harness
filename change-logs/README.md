# 改动记录（Change Logs）

本目录记录本仓库每次改动的背景与过程。规范见 [AGENTS.md](AGENTS.md)。

## 记录列表（按完成时间倒序）

- **2026-08-19** — [`reasoningEfforts.default` 点名的档位加入模型提供的档位集合](2026-08-19-reasoning-efforts-default-offer.md)：`{ default: medium, high: high }` 现在直接提供 medium 与 high 两档并以 medium 为默认，不再要求默认档重复声明为档位键。
- **2026-08-18** — [为工具参数错误补充完整归属路径](2026-08-18-tool-argument-diagnostic-paths.md)：：`defineTool()` 以工具名作为运行时校验根路径，使直接调用与 Code Mode 子分发明确报告 `run_code.description`、`pwsh.description` 等完整参数路径。
- **2026-08-17** — [接受 `reasoningEfforts.default` 作为保留选择键](2026-08-17-reasoning-efforts-default.md)：`llm-pi-ai` 将 `default` 视为每模型默认档选择键而非未知档位，避免整节 settings 注册失败导致自定义提供方消失。
- **2026-08-14** — [工具参数 Schema 契约校验与 `dsh plugin check` 本地校验](2026-08-14-tool-schema-contract.md)：`tools.register` 注册期校验参数 schema 并指名报错，新增 `dsh plugin check` 本地组合包校验命令，配套中英双语 bundle 开发清单。
