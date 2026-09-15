# 接受 `reasoningEfforts.default` 作为保留选择键

- **完成时间**：2026-08-17
- **分支**：`improvement/tool-schema-contract`（基于 `master@47f9438`，其上已有工具 schema 契约与 change-logs 规范）
- **Commit**：
  - `eaccaea6f3b2337f0b375cec58b718c1db69a2e0` — fix(llm-pi-ai): accept reasoningEfforts.default as a reserved selector

## 摘要（Abstract）

`llm-pi-ai` 的 `reasoningEfforts` 原先只接受 pi-ai 档位键。用户在 `settings.yaml` 写成 `{ default: medium }` 时，整份 `llm-pi-ai` 分节在 settings 注册期被拒，自定义提供方从目录消失，Models 页「添加自定义提供方」按钮也因协议列表为空而禁用。本次把 `default` 定为保留选择键：它不是档位，而是指向该模型实际提供的规范档位，并作为该模型在请求未点名努力度时的部署默认值（优先于路由级 `reasoning`）。schema、catalog 解析与 adapter 描述/请求路径一并接入，配套测试与中英文档。重启宿主后，原先那份 YAML 可直接使用。

## 背景（Background）

来源是本机 DeepSeek Harness GUI：把 `C:\\Users\\20506\\.dsh\\settings.yaml` 里某条自定义模型的 `reasoningEfforts: { medium: medium }` 改成 `{ default: medium }`，意图是设默认推理档，结果全部自定义提供方消失、添加按钮不可点。

根因不在 Models 页按钮，而在 settings 命名空间注册：

- `reasoningEfforts` schema 原先只允许 `off | minimal | low | medium | high | xhigh | max`。
- `default` 被当成未知档位，整份 `llm-pi-ai` 用户分节校验失败。
- 冷启动时没有「上次可用值」可回退，插件挂不上。
- 自定义路由来自该插件目录；添加按钮从 `protocolChoices('llm-pi-ai')` 读协议列表，分节缺失则禁用。

路由级已有 `reasoning` 字段可作部署默认；用户需要的是**按模型**写默认档，且只写 `default` 也应合法。

## 改动过程（Process）

### Schema：允许保留键 `default`

- `packages/llm/llm-pi-ai/src/config.ts`：`reasoningEfforts` 的 dict 键改为 `z.union([...THINKING_LEVELS, 'default'])`，`default` 的值必须是规范档位，而不是任意线缆拼写。
- 注册期不再因 `{ default: medium }` 整节拒绝，自定义路由可以重新挂上。

### Catalog：选择键，不是档位

- `packages/llm/llm-pi-ai/src/catalog.ts`：
  - `PiAiReasoningEfforts` 增加保留字段 `default?: ModelThinkingLevel`。
  - `declaredDefaultEffort()` 在解析期校验：缺值、空串、非档位一律指名报错。
  - `resolveModelReasoning()` 先剥离 `default` 再建 offer：
    - 只写 `default` + catalog 推理模型：保留 catalog 档位集合，只记下默认值。
    - 只写 `default` + catalog 非推理模型：拒绝（没有可落地的档位）。
    - 只写 `default` + 手工模型：以该规范拼写单独提供这一档（`off` 单独仍拒绝）。
    - 同时声明档位时，`default` 必须落在实际 offer 内（含 `off: null` / `off: none` 两种 Off）。
  - `RouteCatalog.configuredDefaultEfforts` 收集每模型默认，复制到 `ResolvedPiAiProviderProfile`。

### Adapter：按模型覆盖路由默认

- `packages/llm/llm-pi-ai/src/adapter.ts`：描述与请求的默认档改为 `configuredDefaultEfforts.get(model) ?? profile.reasoning`。请求级 `GenerateOptions.reasoningEffort` 仍最优先。

### 文档

- `packages/llm/llm-pi-ai/README.md` / `README.zh.md` 与生成目录 `docs/config-catalog.md` / `docs/config-catalog.zh.md` 同步说明：`default` 不是档位、必须指向实际 offer、只写 `default` 的语义、以及它覆盖路由 `reasoning`。
- 已录制对应 `.i18n.yaml` 配对 hash。

### 过程中的关键问题

- 工作区沙箱默认只能写 `E:\\dshHome`，改 `E:\\project\\deepseek-harness` 需 `danger-full-access`。
- 一次多段 edit 因 `old_string` 与 `new_string` 相同失败，拆成多次替换。
- 全仓库 `vitest --coverage` 被无关包 0% 拖死；改为包内覆盖率门禁，`packages/llm/llm-pi-ai/src/**` 100%。
- `pnpm run verify-translation-pairing -- docs/...` 不识别多余 `--`；改为 `pnpm exec tsx scripts/verify-translation-pairing.ts <paths>`。

## 总结（Summary）

- `reasoningEfforts: { default: medium }` 现在是合法、可服务的声明。
- 自定义提供方不再因该键整节卸载；添加按钮在命名空间重新注册后可点。
- 分层：请求点名 > 模型 `reasoningEfforts.default` > 路由 `reasoning` > 提供方自身默认。
- 边界：`default` 必须是该模型实际提供的规范档；catalog 非推理模型不能只写 `default`；手工模型只写 `default: off` 仍拒绝。
- 遗留：已写入坏 YAML 的宿主必须重启 / 重载，使 `llm-pi-ai` 按新 schema 重新注册。本次未改 Models UI。跑的必须是这份改过的 checkout，而不是另一套已安装产物。

## 验证（Verification）

以下均为实际执行的验证（2026-08-17）：

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/llm/llm-pi-ai/tests/config.spec.ts packages/llm/llm-pi-ai/tests/catalog.spec.ts packages/llm/llm-pi-ai/tests/adapter.spec.ts --coverage.enabled=false` | 113 passed |
| 包内测试 + 覆盖率（包含 `packages/llm/llm-pi-ai/src/**`） | 220 passed，stmts/branches/funcs/lines 100% |
| `tsc -p packages/llm/llm-pi-ai --noEmit` | 通过 |
| `pnpm exec tsx scripts/verify-translation-pairing.ts docs/config-catalog.md packages/llm/llm-pi-ai/README.md` | 配对一致 |
| 功能 commit 的 lefthook pre-commit（staged pairing / lint / whitespace） | 通过 |

可复现：

```sh
pnpm exec vitest run packages/llm/llm-pi-ai --coverage.enabled=false
tsc -p packages/llm/llm-pi-ai --noEmit
pnpm exec tsx scripts/verify-translation-pairing.ts docs/config-catalog.md packages/llm/llm-pi-ai/README.md
```
