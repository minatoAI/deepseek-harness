# Agent Note: truncate oversized session-title input instead of keeping fallback

Status: implemented

[English](2026-09-14-session-title-input-truncation.md) | 中文

## Problem

共享 `session-title-llm` 辅助模块依据 `maxInputBytes` 检查最终 JSON 封装标题提示词的大小，装不下就拒绝整个辅助请求。一条 1451 字的中文首提示词封装后为 4277 字节，超过出厂 4096 字节预算，因此没有记录 `session/title-llm-request`，主对话正常，会话却只剩确定性首词回退标题。

## Decision

在 `packages/session/session-title-llm/src/index.ts` 中，记录或分发前先把选择装入 `maxInputBytes`。能装下时原样发送；否则单条消息保留前部 UTF-8 安全前缀，多条消息保留首／末条并丢弃中间，优先收缩较长的前缀。已记录的 `session/title-llm-request` 携带确切的截后文本与 seq，因此模型可见输入仍可从日志重建。只有小于空封装的预算才会拒绝。

## Alternatives considered

- **只调大 `maxInputBytes`。** 这只是把失败推迟到下一条长 CJK 提示词，还会抬高每次标题调用的 token 成本；保留为部署旋钮，而非修复。
- **继续拒绝超限输入。** 回退是持久的，但长提示词除非手动加大覆盖项刷新，否则永远拿不到 AI 标题；这正是报告的缺陷。
- **先摘要再生成标题的第二次模型调用。** 这会给每个长会话增加新的失败模式与延迟；前缀／首尾装入复用已有的单次辅助请求。

## Verification

`packages/session/session-title-llm/tests/llm.spec.ts` 钉住两种形态：超限单条 CJK 消息在预算内分发其前部前缀且 seq 不变；三条超限消息在预算内分发首／末条且不含中间。相邻的 `session-title`、`first-prompt`、`all-prompts` 提供方套件仍通过。出故障的 4277 字节会话输入在出厂 4096 预算下装入 4094 字节（1451 字保留前 1390 字，前缀一致）。

## Consequences

- 长首提示词从前部前缀得到 AI 标题，而不是永久回退；长多轮会话从背景加最新进展得到标题。
- 溢出后中间消息对标题模型不可见；截断前缀不带省略号标记。
- `maxInputBytes` 现在是截断预算而非拒绝阈值，只有空封装都装不下时才拒绝。
