# Agent Note: 快速网关重置后降级图片载荷

Status: implemented

[English](2026-09-04-image-payload-fast-reset-degradation.md) | 中文

## 问题

携带六张约 1 MiB 图片（线上约 5.3 MiB）的请求发往 opencode-go 网关时，约 33 ms 即被重置（`UND_ERR_SOCKET / other side closed`），五次原样重试全部以同样方式失败：网关拒绝接收的字节，原样重试不可能成功。Harness 里两个缺口让它无法恢复。第一，pi-ai 在适配器看到失败之前就把 fetch 拒绝压平成裸消息，socket cause 到不了错误分类（见[传输截断分类文](../../archived/bug-fix/2026-07-22-pi-ai-transport-truncation-classification.md)）。第二，适配器的图片策略只有一个——`maxRequestImageBytes` 上限加最旧优先卸载——在"全量发送"和"终止失败"之间没有任何行为。还有一个伴随的重发风险：压缩摘要器逐字回放历史，被污染的图片历史会在救援请求里重发自己的 base64 字节。

## 决策

适配器现在对快速重置做大图片载荷降级，而不是重复发送，由四个校验过的 profile 字段控制：

- `imagePayloadWarnBytes`（默认 3 MiB）：prepared 的 base64 载荷达到上限时，经 `onReplayDegrade` 对每个请求告警一次；请求本身不被阻塞。
- `imagePayloadDegradeMinBytes`（默认 2 MiB）：降级的载荷下限。更小的载荷保持传统路径，普通传输失败绝不收缩请求。
- `imageDegradeFastFailMs`（默认 3000）：判定重置属于包体问题的窗口。显式 413／载荷过大拒绝不论耗时一律降级；`TRANSPORT` 失败只在窗口内且尚未流出任何内容时降级。
- `maxImageDegradeRounds`（默认 2）：减半重试循环的上限。每轮把 `maxRequestImageBytes` 上限减半（经既有确定性投影，最旧图片先卸载），重建上下文并重试；`0` 恢复传统行为。

socket cause 在 harness 自己的 `fetch` 边界捕获（`src/transport-cause.ts`）：脱敏包装器加 `node:diagnostics_channel` 观察，只保留方法、主机、路径、大小、耗时与截断后的 code／消息，并把 cause 交给 `classifyPiAiError`，分类时 cause 优先于压平文本。日志只在 `DSH_LOG_UNDICI_CAUSE=1`（或显式安装调用）下开启；头、包体、查询与凭据从不进日志。这部分解决了传输截断文中的 `XXX(pi-ai upstream)`：不需要 pi-ai 转发 `Error` 也能捕获 cause，文本匹配保留为观察器漏过的兜底。那篇旧文因其兜底覆盖继续有效。

压缩摘要器发送 `projectImagesForTextModel` 占位符代替图片块，救援请求从不携带图片字节。这是无状态投影，不是会话事件或格式变更。

`TRANSPORT` 仍可重试，降级轮数耗尽后仍会回到 profile `retryPolicy`，并从完整载荷重新开始——最坏 `maxRetries × (1 + maxImageDegradeRounds)` 次线上尝试。

## 考虑过的替代方案

**只调大或调小静态 `maxRequestImageBytes` 上限。** 否决：任何固定上限，要么仍超过比假设更小的网关上限，要么让网关本可接受的大请求永久降级。失败是动态的（这个网关、这个大小、此刻），响应也应该是动态的。

**依赖带退避的外层重试。** 否决：退避不改变字节，观测到的失败五次原样重试全部失败。外层重试保留为兜底，不是修复。

**把降级记为会话事件。** 否决：降级循环是请求局部的投影选择，可由请求与 profile 完全重建；新事件会为零模型可见收益强制格式升级，违反无状态剥离决策。

**只在摘要器路由为纯文本时剥离图片。** 否决：摘要请求从不需要图片字节（它压缩的是文本），条件剥离恰恰会在最可能支持图片的路由上重开污染路径。

## 后果

网关拒收时重置的大图片请求，现在会在循环内收缩重试，而不是在原样重试后失败；告警行让部署方在用户察觉之前就有信号调低配置上限。代价是适配器流式路径多了一个按尝试循环，以及四个需要理解的 profile 字段。对持续失败的网关，外层重试仍可能放大降级轮数，但乘积有界，并在包 README 中写明。

## 测试

`packages/llm/llm-pi-ai` 与 `packages/compaction/compaction-basic` 共 469 个单测通过，两包均为零未覆盖行（每文件 100% 门禁）。销毁 socket 的 mock 服务器复现了观测到的 `other side closed` 重置，重试以半数图片成功；显式 413 不论耗时都降级；小载荷、零轮数、有内容后失败保持传统路径。宿主侧 undici 钩子在测试运行中独立记录了重置→降级→200 链路。

## 相关

- [从压平消息文本分类 pi-ai 传输截断](../../archived/bug-fix/2026-07-22-pi-ai-transport-truncation-classification.md)——在 cause 捕获上被部分取代（现于 harness fetch 边界观察）；其文本匹配兜底继续有效，本文不归档它。
