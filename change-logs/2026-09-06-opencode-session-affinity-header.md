# OpenCode 路由自动携带 x-opencode-session 会话亲和性

- **完成时间**：2026-09-06
- **分支**：master（基于 807ee7f74f9c4bc313decd3456bef6ef483c41eb）
- **Commit**：
  - 53dfb7aa473703ddcbfbff97b6aa08635203254f — feat(llm-pi-ai): send x-opencode-session affinity on OpenCode routes

## 摘要（Abstract）

OpenCode Go 托管推理从 09/05 起要求请求携带稳定的每会话 x-opencode-session 标头，缺失则服务端报错，而近期 harness 版本几乎不带该标头。本次在 DSH 侧实现零配置修复：llm-pi-ai 对路由键为 opencode / opencode-go、或 baseURL 包含 opencode.ai 的路由，自动把 loop 盖章的会话 id 作为 x-opencode-session 发出；同名部署标头不分大小写优先，无会话 id 的请求与模型发现探测省略该标头。单测 65 个通过，线上 OpenCode 控制台的会话列与本地会话 UUID 对上，确认生效。

## 背景（Background）

来源是 OpenCode Go 运营方 thdxr 的发帖：约 25k 个用户组织经 deepseek-harness 调用其托管推理 API，09/05 起无 x-opencode-session 的请求会在其侧报错，需要每会话稳定的 UUID 用于路由与优化；其遥测显示各 harness 版本的头 presence 接近零。稳定值本来就存在，即 GenerateOptions.sessionId（packages/llm/llm/src/types.ts 中的 Branded SessionId），pi-ai 已将其作为 sessionId 接收，DeepSeek 适配器也已将其映射为 x-deepseek-harness-session-id，llm-pi-ai 只缺这个 OpenCode 命名的标头。约束：禁止插件内硬编码可调阈值（须是 cordis.yml 可配的校验 Config 字段），但外部协议常量名不在此限；模板化标头值方案（settings.yaml 写 dsh-session-id 再替换）被否决，因为它要求 25k 个组织在 09/05 前手工改配置，拼写错误会静默发出字面量，且混淆部署面与请求面、需要两次 Fetch 校验。

## 改动过程（Process）

### 适配器规则（packages/llm/llm-pi-ai/src/adapter.ts）

新增 OPENCODE_SESSION_HEADER 常量与 needsOpencodeSession(provider, baseURL) 判定：路由键命中 opencode / opencode-go 直接通过，否则看 baseURL 小写后是否包含 opencode.ai，因此改名路由与指向托管端点的手工网关都能命中，而无关提供方不受打扰。requestHeaders 扩展为三参（部署标头、会话 id、路由事实）：先过滤归因保留名，再在缺显式同名头且有会话 id 时补自动值，最后合并 attributionHeaders；调用点把 options.sessionId 与 profile 传入。显式部署标头大小写不敏感优先，归因头仍优先于两者。

### 导出与文档

src/index.ts 重新导出 OPENCODE_SESSION_HEADER 与 needsOpencodeSession 供测试与调用方使用；JSDoc 按 verify-export-jsdoc 补齐 param 与 returns。中英 README 在配置目录之后新增 Send OpenCode session affinity / 发送 OpenCode 会话亲和性小节。按仓库规则同分支附 Agent Note 三元组（.agents/notes/implemented/feature/2026-09-06-opencode-session-affinity-header.md / .zh.md / .i18n.yaml），记录决策与否决的模板方案。

### 测试

adapter.spec.ts 新增 5 个用例：mock server 断言 opencode-go 路由从会话 id 自动赋值、无会话 id 省略、显式 X-OpenCode-Session 优先、非 OpenCode 路由不发、按路由键或托管端点地址匹配；既有 60 个用例未动。实现中发现 pinned pi-ai（0.84 系）目录尚无 muse-spark-1.3-contributor，属目录滞后而非本改动问题，另行指导用户用单协议独立路由承载新模型。

## 总结（Summary）

OpenCode Go 调用无需配置即可携带稳定的每会话路由，显式部署标头继续有效，非 OpenCode 路由与发现流量不受影响，标头值不会进入日志（transport-cause 从不记录标头）。边界：自定义路由键配代理 IP 时既不对键也不对地址，不会自动带头，此类部署应改用 opencode-go 键加 baseURL 覆盖；混合协议目录加目录外新模型仍须单开单协议路由或等 pi-ai 目录收录。

## 验证（Verification）

- pnpm vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts：65 个测试全部通过。
- pnpm exec tsc --noEmit -p packages/llm/llm-pi-ai/tsconfig.json：通过（exit 0）。
- pnpm exec oxlint 上述 3 个改动文件：0 警告 0 错误。
- 构建产物确认：packages/llm/llm-pi-ai/lib/index.js 含 opencode-session（构建时间为改动后）。
- 线上间接验证：OpenCode 控制台使用历史中 muse-spark-1.3-contributor 请求的会话列显示 49ff-a68，与本地会话 session-980b213a-1926-49ff-a685-bd910728ff21 的第三段一致，且 12 分钟内 7 条请求稳定同一值；新消息发出后控制台新增同会话行，确认头已到达对端。
