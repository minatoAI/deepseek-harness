# Agent Note: Split 403 region blocks from credential failures

Status: implemented

[English](2026-09-04-403-region-unsupported.md) | 中文

## Problem

会话 7c38242b 在 seq 750-752 以 `OpenAI API error (403) type RegionError: This model is not available in your country` 失败并映射为 `AUTH`。同一密钥、提供方与模型在前 44 步成功，第 44 步累计 112773 totalTokens，第 45 步用量全零且与上一步间隔约 54 秒，因此失败的是 LLM 请求本身。映射链在 `httpErrorCode` 把 401 或 403 映射为 `AUTH`，在 `classifyPiAiError` 把含 401 或 403 的文本映射为 `AUTH`，在 `displayFailure` 清空 `AUTH`，在 `MessageItem` 把 `AUTH` 渲染为密钥无效。会话日志保留提供方诊断，而 GUI 把地区拦截误报为密钥无效。

## Decision

`@deepseek-ai/dsh-llm` 拥有 `REGION_UNSUPPORTED_CODE`（`REGION_UNSUPPORTED`）与 `isRegionUnsupportedError`，以后者对 `RegionError`、`not available in your country`、`not available in region`、`country`、`region` 做大小写不敏感匹配。调用方同时要求 HTTP 403，裸措辞不改变其他状态的分类。`httpErrorCode` 保持纯 401 为 `AUTH`，把带指纹的 403 映射为 `REGION_UNSUPPORTED`，保持纯 403 为 `AUTH`。`DeepSeekFilesError` 对其拼接的提供方 detail 采用同一划分。`classifyPiAiError` 在通用 401-or-403 规则之前检查 403 加指纹，保持 `QUOTA` 与 `RATE_LIMIT` 顺序不变。模型发现保持 `DISCOVERY_FAILED`，401 提示检查密钥，403 提示检查密钥或地区可用性。两处 `displayFailure` 继续清空 `AUTH`，同时保留 `REGION_UNSUPPORTED` 的提供方消息，该消息不含凭据材料。`MessageItem` 与 `TrajectoryTable` 经 `message.failure.region` 与 `details.failure.region` 渲染 `REGION_UNSUPPORTED`：模型在当前地区不可用（403），密钥有效，请检查出口地区或 VPN，稍后重试，或切换模型或提供方，详见会话日志。会话日志格式不变。`REGION_UNSUPPORTED` 与 `AUTH` 一样位于默认可重试集合之外。

## Alternatives considered

**继续把所有 403 映射为 `AUTH`。** 拒绝：地区拦截的修复（出口、VPN、模型、提供方）与坏密钥不同，现有文案会让地区受阻的用户去轮换有效的密钥。

**不要求 403，只匹配 `RegionError`。** 拒绝：裸词匹配会因巧合措辞改变无关状态的分类；观测到的提供方失败恒带 403，状态要求使划分保持保守，纯 403 仍为 `AUTH`。

**像 `AUTH` 一样清空地区消息。** 拒绝：地区诊断不含凭据材料，轨迹检查器需要提供方细节，而对话渲染本地化指引。

**默认重试地区拦截。** 拒绝：同一地区同一路由每次失败相同，有界重试只增加延迟与计费；显式选择 `always` 模式的部署仍会重试。

## Consequences

地区拦截在对话与轨迹中以密钥有效的指引与 `REGION_UNSUPPORTED` code 渲染，纯 401 与非地区 403 保持密钥无效文案与既有快照。发现 403 从只指向密钥改为指向密钥或地区。默认重试忽略地区拦截，受阻轮次快速结束而不消耗重试预算。

## Testing

`dsh-llm` 锁定指纹的真假用例。`dsh-llm-deepseek` 在 `httpErrorCode` 与 `DeepSeekFilesError` 锁定 403 地区与纯 403、401 的划分。`dsh-llm-pi-ai` 在 convert、adapter 与 discovery 用例锁定 403 `RegionError` 文本、纯 403 回退与 403 发现提示。`dsh-llm-retry` 锁定 `REGION_UNSUPPORTED` 在默认值之外且无计时器直接委派。对话与轨迹锁定地区消息保留、与 auth 不同的本地化渲染与表格本地化。Web 以 `error-region.expected.md` 与 `error-auth.expected.md` 并存锁定，会话以 `error-region-finish` 与 `error-finish` 并存锁定。
