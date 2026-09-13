# Agent Note: size the base session-title budget for thinking models

Status: implemented

[English](2026-09-13-session-title-budget-for-thinking-models.md) | 中文

## Problem

交付的 `dsh-base` 组合把辅助会话标题请求的上限设为 `maxOutputTokens: 64`。该预算适用于 DeepSeek 路由，因为 DeepSeek 适配器会对 `purpose: 'session-title'` 关闭思考，全部预算都用于那一行标题。其余适配器各自负责其用途专用行为，标题调用不带显式 `reasoningEffort`，沿用 profile 默认的思考级别。在思考模型上，推理轨迹先耗尽这 64 token，标题正文尚未输出，共享辅助函数随即拒绝该结果（`max-tokens` 结束或只有推理块而无文本），主对话正常，会话却永远只剩确定性回退标题。

## Decision

两个改动一起交付。`packages/bundle/base/cordis.patch.yml` 中的 `session-title-llm` 行设置 `maxOutputTokens: 256`，在无法关闭思考的路由上为推理轨迹加标题留出空间。pi-ai 适配器（`packages/llm/llm-pi-ai/src/adapter.ts`）在模型提供 off 等级时将 `purpose: 'session-title'` 的请求解析为不思考——在 pi-ai 词汇内对齐 DeepSeek 适配器的标题关闭思考行为；没有 off 等级的模型保留 profile 默认，因此没有任何路由的标题比之前更差。6 个 headless-profile 期望快照中的 `session/title-llm-request` 事件现记录 `"maxTokens": 256`，headless 与 web spec 中的 mock 服务端标题请求嗅探器也以 256 为键。

## Alternatives considered

- **只加预算，不动适配器。** 思考模型仍会把大预算的大部分花在推理上，标题所剩无几；保留为互补的一半，而非完整修复。
- **通过成对的 `provider`／`model` 覆盖项给标题调用指定独立的非思考路由。** 每个部署今天就可以这样做且继续可用，但修不好每个思考模型部署都会继承的出厂默认值。
- **标题调用无条件强制 `off`，即使模型不提供该等级。** 这会让永思考路由上原本可用的标题变成永久回退；交付的规则在这种情况下退化为保留 profile 默认。
- **保留 64 并只记录该失败。** 回退标题是持久的，但报告的现象——所有会话都以首词为标题，除手动重命名外无恢复路径——正是要修的缺陷。

## Verification

headless-profile 期望快照钉住了已记录 `session/title-llm-request` 事件上的分发 `maxTokens`；组合若回退该预算就会失败。`session-title-llm` 单元套件钉住了让小预算致命的拒绝行为：`max-tokens` 结束与无文本的纯推理输出在接受前都会被拒绝。pi-ai 适配器套件钉住了新规则的两面：提供 off 的模型上标题请求发送思考关闭且无 reasoning effort，没有 off 的模型上标题请求保留 profile 默认。

## Consequences

- 思考模型部署能得到模型生成的标题，而不是永久的回退标题，代价是标题调用的输出成本约为之前的四倍，且不再消耗思考轨迹。
- 关闭思考的路由仅在模型实际输出更多 token 时才付出更大的上限；标题正文本身仍受既有词数与字节目标约束。
- 模型不提供 off 等级的路由行为与之前完全一致；此类路由应使用显式的 `provider`／`model` 标题覆盖项或进一步调大预算。
