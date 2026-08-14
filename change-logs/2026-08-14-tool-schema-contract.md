# 工具参数 Schema 契约校验与 `dsh plugin check` 本地校验

- **完成时间**：2026-08-14
- **分支**：`improvement/tool-schema-contract`（基于 `master@47f9438`）
- **Commit**：
  - `7c49da9c487f7844c86c78138ea2b41b0e693133` — feat(tools): validate and normalize parameters at tools.register
  - `4c3bd215c1c2fea066dae2a5ff2216fb2a186444` — feat(cli): add dsh plugin check for local bundle validation
  - `709a0605c93bfb15973585d9f0f9236fa4d0a7cf` — docs(bundle): add bundle development checklist and document dsh plugin check

## 摘要（Abstract）

本次改动为 DSH 工具注册机制建立了明确的 schema 契约：`tools.register` 在注册期即校验并规范化 `parameters`，拒绝畸形 schema 并指名报错；新增 `dsh plugin check` 命令，用于在本地（不启动主机）验证插件组合包（bundle）的补丁、工具 schema、插槽与路由声明。配套补齐了面向插件作者的 bundle 开发清单（中英双语）并在发布指南中登记该命令。整体遵循 TDD 流程，全部回归门禁与真实验收通过。

## 背景（Background）

来源为复盘文档 `dsh-改进复盘-2026-08-14.md` 中的改进项 1、2、5：

- 此前 `tools.register` 对 `parameters` 不做结构校验：属性表形态会被 `parameterSchemaSpecToJsonSchema` 转换，而完整 JSON Schema 形态原样透传，两种形态混用，且错误信息不含工具名——插件 schema 错误要等到模型 API 调用时才暴露。
- 插件组合包缺少本地校验手段：安装进 profile 之前无法预检 `cordis.patch.yml`、入口导出、工具注册与路由声明，问题只能在运行时暴露。
- 插件作者缺少一份系统性的 bundle 开发与发布前检查清单。

另：deepseek-ai 官方仓库不接受外部 PR，本次改动停留在个人仓库（`minatoAI/deepseek-harness`）的分支上。

## 改动过程（Process）

### 任务 1：`tools.register` 参数校验与规范化

- `packages/core/tools/src/schema.ts` 新增 `normalizeRegisteredParameters`：
  - 完整 JSON Schema（`isJsonSchemaRecord && type === 'object'`）→ `assertObjectParameters` 结构校验（properties 存在且为普通对象、属性值均为对象、required 为字符串数组且 ⊆ properties）后原样返回；
  - 属性表形态（无顶层 type 键且每值均为带 type 字符串的对象）→ `parameterSchemaSpecToJsonSchema` 转换，错误包装为带工具名的信息；
  - 其余形态抛带工具名 + `REGISTER_PARAMETERS_FIX_HINT` 的错误。
- `packages/core/tools/src/index.ts` 的 `register()` 接入规范化，转换时 `logger.warn` 提示；仅当结果与入参不同才重建 definition。
- 测试：`tests/register-parameters.spec.ts` 7 条用例（含 `collectToolCatalog()` 全发货工具零改写断言）。
- 调整既有测试 fixture（`{type:'object', default:NaN}` → 带 properties 的形态），因无 properties 形态现在注册期即拒。

### 任务 2：`dsh plugin check` 命令

- 新增 `apps/cli/src/plugin-check.ts` 校验引擎：解析 bundle 的 `dsh.bundle.patch` manifest 与 patch 文件，对每个插件行做 mock 环境下的动态 import + apply，校验 `tools.register` 参数，捕获 `webServer`/`slots` 路由与插槽声明；所有错误进入报告而不抛出。
- `apps/cli/src/plugin.ts` 新增 `runPluginCheck`；`args.ts` 新增 `PluginCheckInvocation`（`plugin check [target] [--json]`，`--profile` 改为普通 option）；`bin.ts` 分发 `plugin-check` 模式。
- 测试：`tests/plugin-check.spec.ts` 10 条用例（好 bundle、属性表 warn、坏 schema、缺 patch、入口缺失、import 抛错、JSON 往返、路由解析、回归）。

### 任务 3：文档

- 新增 `docs/user/develop/basic/bundle-checklist.md`（+ `.zh.md` + `.i18n.yaml`），覆盖补丁格式、工具 schema、settings 插槽、credentials 缝、客户端→主机通道、subprocess 传输、git 安装 build 策略与发布前清单。
- `docs/user/develop/basic/publish.md`（+ 双语）新增「Validate a bundle with dsh plugin check」小节。

### 过程中的关键问题

- TS 严格模式（`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`）导致的 5 处类型修正（args.ts 的 target 判定、plugin-check.ts 的条件展开等）。
- ASI 陷阱：`createMockCtx(...)` 后一行以 `(` 开头被接续解析为函数调用，通过 esbuild 转换产物确认后以显式分号修复。
- 沙箱策略中途由 workspace-write 切换为 danger-full-access，git/vitest 不再需要提权。

## 总结（Summary）

- `tools.register` 现在在注册期拒绝畸形 schema，错误信息包含工具名并给出修复提示；完整 JSON Schema 与属性表两种形态的边界被明确。
- 插件作者可离线运行 `dsh plugin check <bundle>` 预检组合包，`--json` 输出便于 CI 集成。
- 文档补齐了从开发到发布前的检查清单。
- 遗留：复盘项 3/6/7/8（热重载、沙箱粒度、systemProxy、presets）未做，记录于验收文档。

## 验证（Verification）

以下均为实际执行的验证（2026-08-14）：

| 验证 | 结果 |
| --- | --- |
| `vitest run packages/core/tools apps/cli` | 435 passed / 1 skipped |
| `pnpm run verify-tool-catalog` | 零 diff |
| `pnpm run verify-md-links`（1899 文件） | 通过 |
| `pnpm run verify-doc-budgets`（9 份） | 通过 |
| `pnpm run verify-translation-pairing`（937 对） | 通过 |
| `pnpm run build:lib:host` | 通过 |
| 验收 A：`dsh plugin check` 真实 jina 插件 | 12 工具 ok，exit 0 |
| 验收 B：改坏 schema 的副本 | exit 1，指名报错工具 |
| `--json` 输出 | 可解析 |
| pre-push 钩子 `typecheck:contracts-ready` | 通过后推送成功 |
