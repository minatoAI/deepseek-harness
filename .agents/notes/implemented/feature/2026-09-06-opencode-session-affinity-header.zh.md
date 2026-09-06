# Agent Note: OpenCode 路由自动携带 x-opencode-session 会话亲和性

Status: implemented

[English](2026-09-06-opencode-session-affinity-header.md) | 中文

## 问题

OpenCode Go 托管推理要求每个会话携带稳定的 x-opencode-session 标头用于路由与优化，缺失该标头的请求从 09/05 起报错。近期所有 harness 版本几乎都没有带该标头，因此除非 harness 默认发送，否则 OpenCode Go 用户会中断。稳定值本来就存在，即 loop 盖章的 GenerateOptions.sessionId（packages/llm/llm/src/types.ts 中的 Branded SessionId），pi-ai 已将其作为 sessionId 接收，DeepSeek 适配器也已将其映射为 x-deepseek-harness-session-id；llm-pi-ai 路由只缺这个 OpenCode 命名的标头。

## 决策

PiAiAdapter 在服务 OpenCode 托管推理的路由上自动发送 x-opencode-session：路由键为 opencode 与 opencode-go，以及 baseURL 包含 opencode.ai 的手工声明路由，都会把 loop 会话 id 作为标头值。同名部署标头不分大小写优先，Harness 归因头仍优先于两者，无会话 id 的请求省略该标头，模型发现探测因为没有会话所以从不发送。规则位于 packages/llm/llm-pi-ai/src/adapter.ts（OPENCODE_SESSION_HEADER、needsOpencodeSession、扩展后的 requestHeaders），并从 packages/llm/llm-pi-ai/src/index.ts 重新导出；行为记录在 packages/llm/llm-pi-ai/README.md 的 Send OpenCode session affinity 小节。

## 备选方案

- 模板化标头值，例如 x-opencode-session: dsh-session-id 按请求替换。否决：它要求约 25k 个组织在 09/05 前手工改 settings.yaml，拼写错误会静默发出字面量字符串，它混淆部署面与请求面，且需要两次校验（配置时与替换后 Fetch 校验）。
- 只加通用 extraHeaders 配置而不自动化。否决：原因同上 rollout 问题，该标头是来源值已知的外部协议常量，让每个部署手工接线，是用数千次手工编辑换一行适配器规则。
- 在所有提供方路由上都发 x-opencode-session。否决：会把会话关联泄漏给从未要求 OpenCode 契约的提供方；范围保持在服务托管 OpenCode 推理的路由。

## 后果

OpenCode Go 调用无需配置即可携带稳定的每会话路由，显式部署标头继续有效，非 OpenCode 路由与发现流量不受影响，标头值不会进入日志，因为 transport-cause 从不记录标头。后续若再提按请求模板化标头，应引用本记录并说明新的协议常量为何不适用自动规则。

## 测试

packages/llm/llm-pi-ai/tests/adapter.spec.ts 经 mock server 锁定行为：会话 id 自动赋值、无会话 id 省略、显式标头优先、非 OpenCode 路由不发、按路由键或托管端点地址匹配；完整 adapter spec 通过（65 个测试）。
