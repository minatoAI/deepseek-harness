# 内置 Web Search 评测与禁用

- **完成时间**：2026-09-17
- **分支**：`master`
- **Commit**：
  - docs(change-logs): archive the built-in web search assessment
  - （本条记录、目录索引、根 README 计数与索引中既有条目的中文摘要英译同属一个 commit。）

## 摘要（Abstract）

对 DSH 内置 Web 搜索（`@deepseek-ai/dsh-web-search-deepseek` + `@deepseek-ai/dsh-tool-web`，走 DeepSeek 官方 Anthropic 兼容端点）做了一次完整评测：扫描 519 个历史会话统计真实调用与错误率，用逐字节复刻 provider 请求的线上探针测量成本与输出，dump 原始响应定位映射缺陷，并与自建插件 `dsh-jina` 做同查询对照。结论：**内置搜索在来源质量上达不到 dsh-jina 的水平**（学术场景 8 条来源无一条 arxiv.org，技术文档混入 dependabot 聚合页），工具面仅有 `queries[]`、缺少时间与域名参数，且每次搜索都是一整轮辅助模型调用、未命中缓存输入占账单 79.9%。据此在 profile 补丁层禁用整条 `web` 栈，搜索与网页读取改由 dsh-jina 承担。评测过程中发现的 provider 输出漏映射（丢弃模型总结，只回传标题+链接）未落地修复，留作后续参考。

## 背景（Background）

内置 Web 搜索长期表现为"用不了"：会话日志显示 `web_search` 66 次调用中失败 54 次（82%）。同时用户观察到 DeepSeek 账单中"未命中缓存输入"占比极高，怀疑缓存率问题推高成本；以及搜索结果与工具本身质量存疑。

三个具体待答问题：

1. 能否卸载内置 Web 搜索？影响面多大？
2. 它的实际搜索质量、输出质量、结果可用性如何？是否还值得保留？
3. 高成本的结构性原因是什么？缓存率能否优化？

另有一个排查诉求：用户担心此前对本地 checkout 的改动影响了该插件，要求与远端仓库比对。

约束：DeepSeek 官方文档中没有独立的"搜索 API"页面，机制来源需要另行查证；评测要求不臆造结论，所有判断须有可复现的实测数据支撑。

## 改动过程（Process）

### 1. 会话日志全量统计

解压 `$DSH_HOME/sessions` 下 519 个会话（DSH 日志为多帧 zstd，Node 的 zstd API 只解第一帧，需按帧魔数 `28 B5 2F FD` 切分逐帧解压），解析全部 `tool/call` / `tool/result` 事件：

| 工具 | 调用 | 错误 | 错误率 |
|---|---|---|---|
| `web_search`（内置） | 66 | 54 | 82% |
| `jina_web_search`（自建） | 330 | 4 | 1.2% |
| `web_fetch`（内置） | 304 | 32 | 10.5% |

54 次内置搜索错误的构成：45 次 `HTTP 401: Authentication Fails, Your api key: 1 is invalid`，9 次 `unknown tool "web_search": only run_code is callable directly`（PTC preset 的工具面限制，非搜索故障）。

时间线：2026-08-13 至 08-21 共 12 次成功；2026-09-10 19:53Z 起每次都是 401；末次失败 2026-09-17 12:57Z。即"用不了"的根因是**凭证**（key 被设为字面量 `1`），与插件代码无关。

`web_fetch` 的 32 次错误以 `TypeError: fetch failed`（15 次）、`cross-origin redirect ... not followed`（9 次，搜狐/网易/搜狗/头条/Bing/HuggingFace）、`unsupported content type`（2 次）、`configured web provider "net-proxy" is not registered`（2 次）为主。

### 2. 本地代码与上游比对

```
git status --short                                     # 仅未跟踪的评测草稿
git diff HEAD upstream/master -- packages/web/*/src    # 输出为空
git log upstream/master..HEAD -- packages/web          # 输出为空
```

本地 `master` 相对 `upstream/master` 为 51 ahead / 882 behind。51 个本地提交涉及 `llm-pi-ai`、`agent-team`、`session-title`、`tools`、`cli` 与文档，**没有任何一个触及 `packages/web`**。内置 Web 搜索源码与上游逐字节一致，排除本地改动致因。

### 3. 官方文档查证

DeepSeek 未提供独立的搜索 API 文档页；机制分散在两处：

- `https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code` 的「Using Web Search in Claude Code」一节明确：*The DeepSeek API natively supports the Web Search feature in Claude Code... Because invoking the Web Search tool generates additional LLM API requests to summarize the retrieved search content, additional model token costs will be incurred.* —— **成本结构由官方文档明确记载**。
- `https://api-docs.deepseek.com/guides/anthropic_api` 的兼容表列出 `server_tool_use`、`web_search_tool_result` 为 Supported，`citations`、`cache_control`、`anthropic-version` 为 **Ignored**，`code_execution_tool_result` 为 Not Supported。

即：内置搜索使用的是 Anthropic Messages 协议的**服务端工具**机制（`web_search_20250305`），DSH 的接入方式正确。Wayback Machine 2026-06-06 快照显示该兼容表结构当时已经如此。

两条官方声明直接判定了两个缺陷的性质：

- **`citations` 被忽略** → `citationSnippets()` 在该端点上永远返回空 Map，snippet 恒缺，属官方限制而非 DSH 缺陷。
- **`cache_control` 被忽略** → DSH 无法手动设置缓存断点，只能依赖 DeepSeek 的自动前缀缓存。

### 4. 成本结构分析

定价（`api-docs.deepseek.com/quick_start/pricing`，deepseek-flash，每 1M tokens；低峰 / 高峰）：缓存命中输入 $0.003/$0.006，未命中输入 $0.15/$0.30，输出 $0.60/$1.20。**缓存命中价是未命中的 1/50。**

一次测试账单（11 次查询，共 195,605 tokens，¥0.22）拆解：

| 项目 | tokens | 费用（低峰） | 占比 |
|---|---|---|---|
| 缓存命中输入 | 4,736 | $0.000014 | 0.04% |
| **未命中输入** | 179,589 | **$0.026938** | **79.9%** |
| **输出** | 11,280 | **$0.006768** | **20.1%** |

≈ ¥0.02 / 次查询。

同查询重复 3 次的方差实验证明**缓存本身工作正常**：

| 运行 | 未命中 | 命中 | 输出 | 费用 |
|---|---|---|---|---|
| run1 | 9,739 | 3,584 | 767 | ¥0.0126 |
| run2 | 395 | 12,928 | 779 | ¥0.0037 |
| run3 | 11,324 | 2,816 | 938 | ¥0.0148 |

run2 命中 12,928 tokens、成本降至 1/3.4 —— 命中率低（2.6%）的唯一原因是**每次 query 都不同**，检索内容是 per-query 的，无法跨请求复用前缀。

配置层旋钮实测无效（同查询四组对照，thinking × maxUses）：thinking 仅 200–341 字符，不是成本大头；关闭 thinking 后输出下降但未命中输入上升，净成本未降；单次样本噪声极大（同查询 miss 在 395–13,768 间波动）。

**结论：79.9% 的未命中输入是结构性的，不可优化。**

### 5. 输出质量缺陷定位

原始响应 dump：

```
block[0] thinking                93 字
block[1] text                    "I'll search for that query for you."
block[2] server_tool_use         web_search
block[3] web_search_tool_result  10 items
block[4] thinking                72 字
block[5] text                    3214 字   ← 完整总结，被丢弃
```

`web_search_result` item 实际字段为 `{type, title, url, encrypted_content, page_age}`：无 `citations`，`encrypted_content` 是加密串不可读，`page_age` 恒为 null。

`packages/web/web-search-deepseek/src/provider.ts` 的 `mapAnthropicResponse()` 最终 `return { sources, truncated: false }` —— **不返回 `content`**，模型生成的 3,214 字总结被整段丢弃，模型只拿到标题+链接。对照 `packages/web/web-search-perplexity/src/provider.ts`：Perplexity provider 正是把答案映射为 `content` 的；seam 的 `WebSearchResult.content`、`formatSearchOutput()`、卡片 meta 的 `answer` 字段均支持该值。**属漏映射而非设计取舍。**

成本含义：输出占账单 20.1%（重复实验样本中 31.3%），即这部分已付费的 token 完全未被模型使用。

### 6. 迭代一原型与实测

在独立探针中实现改进 mapper（取**最后一个 `web_search_tool_result` 之后**的 text block 拼接为 `content`，排除前导语），不改仓库源码。同一真实响应（`Spring Boot 3.5 release notes`，¥0.0172）对比：

| | 现有 mapper | 改进 mapper |
|---|---|---|
| 模型可见输出 | 2,156 字符 | **5,172 字符** |
| 答案 | **无** | **3,014 字符结构化总结** |
| 成本 | ¥0.0172 | ¥0.0172（不变） |

即零额外成本回收账单中 20–31% 的已付费输出。该改动**未落地到仓库**。

### 7. 与 dsh-jina 的同查询对照

4 个查询分别跑两种工具（Jina 用默认参数）：

| 查询 | 内置（迭代一） | Jina |
|---|---|---|
| 2026年9月 AI 行业最新动态 | ¥0.0136 / 8 源 / 总结 2,179 字 | 10 源 |
| OpenAI latest news September 2026 | ¥0.0114 / 8 源 / 总结 3,116 字 | 10 源 |
| Spring Boot 3.5 release notes | ¥0.0041 / 8 源 / 总结 2,971 字 | 10 源 |
| arxiv 2026 transformer survey | ¥0.0209 / 8 源 / 总结 4,743 字 | 10 源 |

分维度判定：

| 维度 | 内置 | Jina | 胜方 |
|---|---|---|---|
| 信息密度（可直接使用） | 结构化总结 2,179–4,743 字 | 标题 + URL + 1 行描述 | 内置 |
| 来源权威性（中文新闻） | 新华网、中新社、证券时报、每经、上证报 | YouTube、知乎、IBM、新浪、网易 | 内置 |
| 来源权威性（英文新闻） | 中文财经媒体转述为主 | nytimes、openai.com、apnews、axios | Jina |
| 来源权威性（技术文档） | spring.io 官方 + github wiki，但混入 3 条 dependabot 聚合页与 2 条作者归档页 | spring.io 官方博客多条（含最新 3.5.14/15/16） | Jina |
| 来源权威性（学术） | 8 条全为聚合站（ezproxy、arxivlens、opentrain、semanticscholar），**无一条 arxiv.org** | 10 条真 arxiv.org + ScienceDirect + OpenReview，带作者/年份/引用数 | Jina |
| 工具面表达力 | 仅 `queries[]` | `time` / `type`(web·arxiv·ssrn·images·blog) / `gl` / `hl` / `num` | Jina |
| 成本 / 时延 | ¥0.004–0.021 / 4–8 s | 限时免费额度 / 1–3 s | Jina |

来源质量的差距有结构性原因：内置工具的模型可见参数只有 `queries[]`（`packages/web/tool-web/src/search.ts`），没有时间过滤、域名选择与结果数，模型无法表达"最近一周"或"限定 arxiv.org"，只能把意图塞进查询文本，**任何 mapper 改动都无法弥补**。

同时内置补齐了 Jina 缺失的信息密度，两者为互补而非替代关系。

### 8. 禁用决定与落地

按"达不到 dsh-jina 水平即不消耗 DeepSeek 额度"的判据，在 profile 补丁层 `$DSH_HOME/profiles/web/cordis.patch.yml` 禁用整条 `web` 栈：

```yaml
- id: web
  disabled: true
```

`web` 服务是 `web-search-deepseek`、`web-fetch-http`、`tool-web` 三者共同的注入依赖；服务缺失时它们不会 apply，因此 `web_search` 与 `web_fetch` 一并从所有 preset（standard / ptc / cordis）消失。全仓仅 `tool-web` 消费 `ctx.web`，无其他功能受影响；`dsh-jina` 不依赖 `ctx.web`。该 profile 的 `patchReload: live`，补丁即时生效。

搜索与网页读取改由 dsh-jina 承担（`jina_web_search` / `jina_search_arxiv` / `jina_search_ssrn` / `jina_read`）。

## 总结（Summary）

- **根因澄清**：内置搜索"用不了"是凭证问题（key 被设为 `1`），非插件缺陷；源码与上游逐字节一致，未受本地改动影响。
- **机制查证**：使用 Anthropic Messages 的服务端工具机制，官方在 Claude Code 集成页与 Anthropic 兼容表中有记载，但无独立搜索 API 文档页。
- **成本**：未命中缓存输入占账单 79.9%，**结构性不可优化**（不同 query 无法共享前缀，且 `cache_control` 被官方忽略）；缓存机制本身正常，同 query 重跑可省 3.4 倍。绝对金额量级不大（按历史调用规模估算月度约 ¥1）。
- **质量**：来源质量达不到 dsh-jina（学术与官方文档场景差距最大），工具面参数缺失是结构性原因；信息密度反超 Jina，两者互补。
- **决策**：禁用整条 `web` 栈，搜索与读取改用 dsh-jina。

遗留与边界：

- provider 的**输出漏映射**（丢弃模型总结，白付 20–31% 输出 token）已定位并验证修复方案，**未落地**，留作后续参考；若日后恢复内置搜索，应优先修复。
- 官方 `citations: Ignored` 使 snippet 恒缺，不可修复。
- 禁用后 `web_fetch` 一并消失；其功能由 `jina_read` 覆盖，但 `jina_read` 依赖本地代理可达 `r.jina.ai`。
- 恢复方式：删除补丁中的 `- id: web` 一项；若只想恢复 `web_fetch`，需在用户 preset 中把 `tool-web` 的 `config.search` 设为 `false`（shipped preset 同名会被 system root 遮蔽，不能直接改）。

## 验证（Verification）

- **会话统计**：519 个会话全部解压成功（0 失败），计数与错误签名由 `tool/call`、`tool/result` 事件按 `callId → name` 关联得出。
- **线上探针**：逐字节复刻 `DeepSeekSearchProvider.search()` 的 endpoint、headers、body、`redirect: 'error'` 策略，11 次请求（10 业务查询 + 1 nonce）全部 HTTP 200；响应头与 trace id 确认非缓存代理响应。
- **成本核对**：按官方定价计算 195,605 tokens = $0.0337 ≈ ¥0.22，与 DeepSeek 平台账单截图数值一致，误差来自汇率。
- **缓存方差**：同查询重复 3 次，命中量 3,584 / 12,928 / 2,816，确认自动前缀缓存生效。
- **原始响应结构**：直接 dump 响应 JSON 的 block 类型、字段名与 `citations` 存在性，确认 `citations` 缺失、`page_age` 为 null。
- **改进 mapper**：在同一份真实响应上对比两种映射的模型可见输出长度与内容，成本字段不变。
- **Jina 对照**：4 个查询在会话内直接调用 `jina_web_search`，与内置结果逐条人工比对来源域名。
- **仓库比对**：`git status --short`、`git diff HEAD upstream/master -- packages/web`、`git log upstream/master..HEAD -- packages/web` 三条命令输出如上。
- **禁用生效**：补丁写入 `$DSH_HOME/profiles/web/cordis.patch.yml` 后，同一会话内调用 `web_search` 与 `web_fetch` 均立即返回 `Error: unknown tool`，证明 `patchReload: live` 生效、loader 正确解析该 YAML 且整条 `web` 栈已从所有 preset 卸载。
- **文档门禁**：`pnpm run verify-translation-pairing`（926 对全部一致）、`pnpm run verify-md-links`（1849 个文件链接全部解析）、`pnpm run verify-repository-references`（无 commit 标识符与禁用组织 URL）三项全部通过。
- **复现命令**：`git fetch upstream && git diff HEAD upstream/master -- packages/web`；会话统计与探针脚本本次存放于临时目录（未入库），核心逻辑为多帧 zstd 解压 + provider 请求复刻 + 映射对比。
