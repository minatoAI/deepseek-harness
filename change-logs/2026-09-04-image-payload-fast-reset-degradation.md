# 大图片请求体被网关快速重置时自动降级重试

- **完成时间**：2026-09-04
- **分支**：`master`（基于 `a3126ac15a`）
- **Commit**：
  - `25e20ace19` — fix(llm-pi-ai): degrade image payload after fast gateway reset
  - `a341d46402` — fix(llm-pi-ai): avoid delete on required global flag in spec

## 摘要（Abstract）

`opencode-go` 路由（`POST opencode.ai/zen/go/v1/responses`）在请求携带多张约 1MB 图片（请求体约 5.3MB）时，网关在约 33ms 内直接重置连接（`UND_ERR_SOCKET / other side closed`），而约 3MB 的请求可以通过；相同载荷重试必现失败。本次在 DSH 侧实现自适应修复：`llm-pi-ai` 在判定为“大载荷 + 快速失败 + 首包前”的传输层重置时，自动把图片预算减半后重建请求重试，最多降级 `maxImageDegradeRounds` 轮；首轮超过 `imagePayloadWarnBytes` 的请求只告警一次；另新增脱敏的传输层原因日志（`DSH_LOG_UNDICI_CAUSE=1`）与 compaction 侧的图片剥离。验证与文档门禁全部通过。

## 背景（Background）

来源是提案 `E:\dshHome\dsh-image-payload-fix-proposal.md`（P0-1 告警、P0-2 降级重试、P1 原因日志、P2 压缩剥离、P3 文档）。关键事实：

- 约 3MB 的图片请求可以成功，6 张约 1MB 图片（约 5.3MB）必现 `TRANSPORT / other side closed`，失败耗时约 33ms 且与内容无关，指向网关请求体大小限制而非模型故障。
- pi-ai 把 `Error.cause` 拍平，适配器只能通过 `toStreamChunks` 的 `error` 终止块看到失败，看不到原始 `cause`，因此此前无法区分“网关拒收大请求体”与普通传输抖动。
- 宿主进程注入了 `NODE_OPTIONS` undici-cause hook，与测试/子进程共享全局标记时会冲突，且其日志直写 stderr 与固定路径文件。

约束：仓库禁止插件内硬编码可调阈值（须是 cordis.yml 可配的校验 `Config` 字段）；`packages/*/*/src` 覆盖率门禁要求单文件 100%；每个导出须有带 `@param` / `@returns` 的 JSDoc；中英 README 代码块须字节一致。

## 改动过程（Process）

### 配置：四个可配红线（`packages/llm/llm-pi-ai/src/config.ts`）

新增 profile 字段 `imagePayloadWarnBytes`（默认 3MiB）、`imagePayloadDegradeMinBytes`（默认 2MiB）、`imageDegradeFastFailMs`（默认 3000ms）、`maxImageDegradeRounds`（默认 2），`resolveProfiles` 校验；沿用 `DEFAULT_*` 仅作 schema 默认值，不做运行时硬编码。

### 传输层原因捕获（新增 `src/transport-cause.ts`）

- 脱敏 `fetch` 包装 + `node:diagnostics_channel` 观察器，导出 `takeTransportCause` / `installTransportCauseLogging` 等；全局标记命名为 `__dshTransportCauseWrapped`（初版 `__dshCauseHookWrapped` 与宿主 hook 撞名导致生产环境组合失效，已改名并补了共存测试）。
- 仅当 `DSH_LOG_UNDICI_CAUSE=1` 时自动安装；输出 `[dsh-undici-cause]` 行到 stderr，永不记录 header、body、query 与 key。
- `src/stream.ts` 的 `classifyPiAiError(message, cause?)` 改为 cause 优先，文本匹配保留为兜底。

### 降级判定（新增 `src/image-degrade.ts`，`src/adapter.ts` 接入）

- `shouldDegradeImages`：413 无论耗时直接降级；TRANSPORT 类错误仅当“载荷够大 + 失败够快 + 首包前”才降级；`nextDegradedImageBudget` 每轮减半。
- 适配器改为按轮循环：每轮重建请求上下文、首轮超限告警一次（`context.ts` 经 `onReplayDegrade` 保证每请求一次）、内容块即时透出、usage 冲刷逻辑 hoisted 到共享位置；不可达的裸 `done` 分支按仓库既有惯例以 `/* v8 ignore next */` 保留为 `STREAM_CLOSED` 防线。
- 外层 `llm-retry` 仍会从完整载荷重试 TRANSPORT（最坏重试量为 `maxRetries × (1 + maxImageDegradeRounds)`）。

### 压缩侧剥离（`packages/compaction/compaction-basic/src/summarizer.ts`）

`summarizeWithLlm` 发送前经 `projectImagesForTextModel` 剥离图片消息（无状态，不写 session 事件、不 bump 格式版本），并更新了中英 README 与配对记录。

### 测试与文档

- 新增 `image-degrade.spec.ts`（9）、`transport-cause.spec.ts`（18）；扩展 `config` / `convert`（cause 优先）/ `context`（告警 + 字符串内容）/`adapter`（5 个降级用例：手写 `acme-vision` 的 `openai-completions` 路由 + `mock-server.ts` 新增 `destroySocket`）/`compaction-basic`（占位符前缀 + 毒化历史用例）用例。
- 过程中删掉了一个 scratch 探针测试（`tests/probe.spec.ts`），并确认：`openai` catalog 路由走 Responses 协议，chat 形 SSE 在此必败，适配器测试须用手写 `openai-completions` 路由。
- 中英 README（两包）+ `.i18n.yaml` 配对重新录制；新增 Agent Note 三件套 `.agents/notes/implemented/bug-fix/2026-09-04-image-payload-fast-reset-degradation.{md,zh.md,i18n.yaml}`。
- 修过一轮 `verify-translation-pairing` 失败：中英 YAML 示例注释分叉，改为英文注释使围栏块字节一致后重录。

## 总结（Summary）

- 效果：大图片请求遇到网关快速重置时不再以原载荷盲重试，而是逐轮减半图片预算后重试；实测链路在测试中走通（reset → 降级 → 200）。
- 边界：413 才不看耗时；TRANSPORT 降级三条件缺一即走原重试路径；降级轮数有界；`pnpm dsh` 从源码经 tsx 运行，插件 `.ts` 改动无需 build，但须重启 dsh 服务进程生效，GUI 仍是 `http://127.0.0.1:3080`。
- 遗留：四个红线默认值为经验值（3MiB / 2MiB / 3000ms / 2 轮），真实网关限额未知，重放仍失败时需贴 `[dsh-undici-cause]` 行再调；`catalog.ts` / `catalog.spec.ts` 的 lint 命中为改动前既有问题，未动。
- 旧记录 `.agents/notes/implemented/bug-fix/2026-07-22-pi-ai-transport-truncation-classification.md` 被部分取代（harness fetch 边界现可捕获 cause，文本兜底保留），按归档政策留用未归档。

## 验证（Verification）

以下均为实际执行的验证（2026-09-04）：

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/llm/llm-pi-ai packages/compaction/compaction-basic`（adapter 用例另以 `--project process-bound` 运行） | 18 个文件 / 469 个用例全部通过 |
| `tsc` 全量类型检查 | 通过 |
| `oxlint`（15 个触及文件） | 0 error |
| `pnpm run test:docs` | 15/15 通过 |
| `pnpm run duplication` | 0 clones |
| 独立子代理复验（7 项：单测/覆盖/类型/lint/文档门禁/重复度/翻译配对） | 7/7 通过 |
| 宿主 undici-cause hook 日志（测试期间独立记录） | 观察到 reset → 降级 → 200 链条（4236B 失败 `cause=other side closed`，2892B 重试成功） |

可复现：

```sh
pnpm exec vitest run packages/llm/llm-pi-ai packages/compaction/compaction-basic
pnpm exec vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts --project process-bound
pnpm run typecheck
pnpm run lint
pnpm run test:docs
pnpm run duplication
pnpm exec tsx scripts/verify-translation-pairing.ts
pnpm exec tsx scripts/verify-md-links.ts
```
