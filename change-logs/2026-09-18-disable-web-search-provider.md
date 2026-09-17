# 收窄内置 Web 搜索禁用：只停 DeepSeek 搜索 provider，保留 web_fetch

- **完成时间**：2026-09-18
- **分支**：`master`
- **提交**：
  - docs(change-logs): record the narrowed built-in web search disable
  - （profile 补丁层注释更新、本记录、目录索引与根 README 计数同属一个 commit。）

## 摘要（Abstract）

把 2026-09-17 的"禁用整条 `web` 栈"收窄成只禁用内置搜索的 DeepSeek provider：在 `$DSH_HOME/profiles/web/cordis.patch.yml` 新增 `- id: web-search-deepseek / disabled: true`，`web` 服务与 `web-fetch-http` 保持挂载。这样 `web_search` 再也发不出任何 DeepSeek 计费请求（`web` 服务钉住的 `searchProvider: deepseek-official` 已无注册实现，调用在发出网络请求之前就以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败），而 `web_fetch` 的本地匿名抓取完整保留。`dsh --profile web --dump-config` 实测确认了这三行的最终状态。

## 背景（Background）

2026-09-17 的评测（见[内置 Web Search 评测与禁用](2026-09-17-builtin-web-search-assessment.md)）判定内置搜索的来源质量不及自建 `dsh-jina`、成本结构不可优化，当时的落地方式是在 profile 补丁层写 `- id: web / disabled: true`。这个做法有副作用：`web` 服务是 `web-search-deepseek`、`web-fetch-http`、`tool-web` 共同的注入依赖，服务缺失时三者都不 apply，于是 `web_fetch` 一并消失，只能由 `jina_read` 顶替（`jina_read` 依赖本地可达 `r.jina.ai`）。

收窄的判据是"只有走 DeepSeek API 的那部分要停"：

- 搜索确实是付费的：`web_search` 每次都是一整轮 Anthropic 兼容 Messages 调用，检索与总结的 token 都记在 `DEEPSEEK_API_KEY` 上。
- 网页读取不是：`web_fetch` 走 `dsh-web-fetch-http`，在你的进程里匿名抓取公网页面，不发送任何凭据（`packages/web/web-fetch-http/README.md:12,64`），与 DeepSeek 额度无关。
- 之前的"假 API Key"不是可靠开关：它只让每次调用在发出 HTTP 后吃 401，工具照样占着工具表，而且真 key 一旦回到 `DEEPSEEK_API_KEY`，搜索就会立刻恢复计费。
- 上一版补丁在后续编辑中被还原为 `[]`，也就是说在本次改动之前，内置搜索实际处于开启状态。

## 改动过程（Process）

### 1. 分清三个平面

在 Web GUI 里，"内置 Web 搜索"由三层组成，禁用的位置决定了结果：

| 层 | 包 | 平面 | 作用 |
|---|---|---|---|
| 模型可见工具 | `@deepseek-ai/dsh-tool-web` | preset（Web 应用在 `packages/bundle/web-app/cordis.patch.yml:502` 禁掉了 host 那行） | 注册 `web_search` / `web_fetch` |
| 搜索 provider | `@deepseek-ai/dsh-web-search-deepseek` | host | 真正发起 DeepSeek 请求 |
| 读取 provider | `@deepseek-ai/dsh-web-fetch-http` | host | 本地匿名 HTTP 抓取，不用 key |
| 服务缝 | `@deepseek-ai/dsh-web` | host | `ctx.web`，基础层钉住 `searchProvider: deepseek-official`、`fetchProvider: http`（`packages/bundle/base/cordis.patch.yml:461-473`） |

### 2. 在 profile 补丁层只停 provider 那一行

编辑 `$DSH_HOME/profiles/web/cordis.patch.yml`，新增一条 id 定向补丁：

```yaml
- id: web-search-deepseek
  disabled: true
```

这是 loader 的 id 定向补丁，不影响同一 `insert` 组里的 `web`、`web-fetch-http`、`tool-web` 行，因此不必重述任何 config（id 定向补丁对 `config` 是整体替换而非深合并，动 `web` 服务的 config 就得把 `fetchProvider: http` 再写一遍）。

### 3. 修正补丁文件里的注释

原注释块描述的是"禁用整条 `web` 栈"和相应的恢复方法，与新的实际内容不符。改后的注释保留了三条评测理由，并改写机制段落：说明只停搜索、`web_fetch` 为何可以保留、调用会以 `WEB_PROVIDER_CONFIGURED_MISSING` 失败，以及两种恢复路径（删除该项恢复搜索；改为禁用 `web` 服务行则连 `web_fetch` 一起停）。

### 4. 生效语义

- `web-search-deepseek` 不注册后，`web` 服务钉住的 `searchProvider: deepseek-official` 找不到实现；按 web 服务的选路规则，"配置了 id 但未注册"直接抛 `WEB_PROVIDER_CONFIGURED_MISSING`（`packages/web/web/README.md:69-77`），发生在任何网络请求之前。
- `tool-web` 的 `search` 默认仍为 true（`packages/web/tool-web/src/index.ts:38`，注册门槛在 `:91`），所以 standard / ptc / cordis 的工具表里仍会列出 `web_search`，调用时得到结构化错误而不是 `unknown tool`。要让工具本身也消失，需在用户 preset 里把 `tool-web` 的 `config.search` 设为 `false`；shipped preset 不能直接改（shipped root 前置且同名 id 由它胜出，`packages/preset/agent-presets/README.md:60`），必须复制一份到 `$DSH_HOME/.agent-presets/<新 id>/` 再选它。
- `web_fetch` 不受影响，仍由 `web-fetch-http` 承担。

## 总结（Summary）

- **效果**：搜索侧零额度消耗且不再需要"假 key"；网页读取保留在本地匿名 fetch；profile 的补丁文件从 `[]` 变成一条明确的 provider 禁用。
- **影响面**：只动用户 profile 补丁层，不改仓库源码；设置页里那张"Web search"配置卡会随 provider 一起消失。
- **边界**：`web_search` 工具条目仍在工具表中（调用即失败）；彻底移除需要在用户 preset 里关 `tool-web.config.search`。profile 配置热重载，但 preset 的组成只对新会话生效，且会话一旦产出内容就不能换 preset。
- **遗留**：本次不涉及仓库代码，`packages/web/*` 未改；provider 丢弃模型总结的漏映射问题仍是上次评测留下的待办，若日后恢复内置搜索应优先修。

## 验证（Verification）

- **组合结果（主证据）**：`pnpm dsh --profile web --dump-config` 退出码 0，输出中该行由补丁层标注并带 `disabled: true`：

  ```text
  - id: web
    name: '@deepseek-ai/dsh-web'
    config:
      searchProvider: deepseek-official
      fetchProvider: http
  # == @deepseek-ai/dsh-base, patched by $DSH_HOME\profiles\web\cordis.patch.yml
  - id: web-search-deepseek
    name: '@deepseek-ai/dsh-web-search-deepseek'
    config:
      apiKeyEnv: DEEPSEEK_API_KEY
    disabled: true
  # == @deepseek-ai/dsh-base
  - id: web-fetch-http
    name: '@deepseek-ai/dsh-web-fetch-http'
  ```

  即：patch 被真实 loader 解析（`loadOptionalPatches` + `composeEntries`，`apps/cli/src/dump-config.ts:57`），搜索 provider 已禁用，`web` 与 `web-fetch-http` 未被禁用。

- **文档门禁**：`pnpm run verify-translation-pairing`、`pnpm run verify-md-links`、`pnpm run verify-repository-references` 三项在本 commit 前运行并通过（README 配对 hash 已用 `pnpm run verify-translation-pairing --write README.md` 重录）。
- **复现命令**：修改 `$DSH_HOME/profiles/web/cordis.patch.yml` 后运行 `pnpm dsh --profile web --dump-config`，在输出里检索 `web-search-deepseek`。
