# 为工具参数校验错误补充完整归属路径

- **完成时间**：2026-08-18
- **分支**：`master`（基于 `origin/master@2314e10c`）
- **Commit**：
  - `45461434c76d987f6938570773d840834d3ff276` — fix(tools): qualify argument validation paths

## 摘要（Abstract）

工具实参校验原先从空路径开始生成诊断，同名参数缺失时只会报告 `description`，无法判断错误属于外层 `run_code` 还是 Code Mode 内部调用的 `pwsh`。本次让 `defineTool()` 以所属工具名作为校验根路径，使直接调用与子分发统一返回 `run_code.description`、`pwsh.description`、`reader.path`、`bash.command` 等完整路径，同时保持 `ToolArgsError` 与 `INVALID_ARGS` 错误契约不变。核心、Code Mode、PowerShell 工具测试以及 Host 构建均已通过，并在重启后的实际 Web Host 中确认新诊断生效。

## 背景（Background）

问题来源于 Web GUI 中的一次 Code Mode 调用：外层传输工具和内部 PowerShell 工具都要求 `description`，但旧错误仅显示：

```text
invalid arguments: missing required property "description"
```

该信息没有给出参数所属工具。排查者即使知道请求经过 `run_code`，仍无法确定缺失的是 `run_code.description`，还是程序内 `await tools.pwsh(...)` 的 `pwsh.description`。这不是 PowerShell 工具的特例，而是所有通过 `defineTool()` 创建的工具共享的运行时校验路径问题，因此需要在通用定义层修复，不能为单个工具硬编码。

## 改动过程（Process）

### 通用校验路径

- `packages/core/tools/src/schema.ts`：将 `defineTool()` 内部实参校验从 `validateJsonSchemaValue(parameters, args, '')` 改为 `validateJsonSchemaValue(parameters, args, options.name)`。
- 校验器继续沿 JSON Schema 属性向下拼接路径；唯一变化是首段从空字符串变为工具名。因此缺失、类型错误及嵌套字段错误都会带上所属工具前缀。
- 错误类型、错误代码与执行流程不变，调用者仍收到 `ToolArgsError` / `INVALID_ARGS`。

### 核心与 Code Mode 回归

- `packages/core/tools/tests/code-mode.spec.ts` 新增两条回归：
  - 外层 `run_code` 缺少 `description` 时报告 `run_code.description`；
  - Code Mode 子工具 `pwsh` 缺少同名参数时报告 `pwsh.description`。
- `packages/core/tools/tests/tools.spec.ts` 更新真实 `reader` 工具断言，确认文本内容与结构化错误都使用 `reader.path`。

### Shell 工具覆盖

- `packages/shell/tool-pwsh/tests/tools.spec.ts` 增加真实 PowerShell 工具缺少 `description` 的回归断言。
- `packages/shell/tool-bash/tests/tools.spec.ts` 将缺失字段和类型错误断言更新为 `bash.command`、`bash.description`、`bash.timeoutMs`、`bash.workdir` 与 `bash.run_in_background`。
- Bash 工具测试在仓库的 Windows Vitest 配置中被明确排除，因此本机未收集该 suite；对应断言将在 Linux CI 中执行。

### 构建与运行时确认

- 重新构建 Host 库后，`packages/core/tools/lib/types/schema.js` 与 `packages/core/tools/lib/index.js` 均包含以 `options.name` 为根路径的校验逻辑。
- 用户手动重启当前 Web Host 后，故意省略内部 `pwsh.description`，实际返回 `invalid arguments: missing required property "pwsh.description"`，确认运行中的 Harness 已加载新产物。

## 总结（Summary）

- 同名工具参数的错误归属现在明确，无需结合调用栈猜测是哪一层缺参。
- 修复位于 `defineTool()`，自动覆盖直接工具执行与 Code Mode 子分发，不依赖具体工具名。
- 边界：公开的 `validateArgs(spec, args)` 是纯 schema 辅助函数，仍从空路径开始并返回 `path` 一类 schema 相对路径；只有经 `defineTool()` 构造并实际执行的工具获得所属工具前缀。
- 直接自行构造 `ToolArgsError` 的其他路径（例如结构化输出处理）不经过本次 `defineTool()` 校验，未作修改。

## 验证（Verification）

以下均为实际执行的验证（2026-08-18）：

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/core/tools/tests/tools.spec.ts packages/core/tools/tests/code-mode.spec.ts` | 229 passed（136 + 93） |
| `pnpm exec vitest run packages/shell/tool-pwsh/tests/tools.spec.ts` | 62 passed |
| `pnpm exec oxlint --type-aware <5 个改动文件>` | 0 warnings / 0 errors |
| `pnpm run build:lib:host` | 通过，构建产物包含新校验根路径 |
| Git pre-commit 门禁 | 通过；lint 对 `schema.ts` 周边既有的 7 条未使用 disable 指令给出 warning，无 error |
| 重启后真实 Code Mode 子调用 | 缺少参数时返回 `pwsh.description` |

可复现：

```sh
pnpm exec vitest run packages/core/tools/tests/tools.spec.ts packages/core/tools/tests/code-mode.spec.ts
pnpm exec vitest run packages/shell/tool-pwsh/tests/tools.spec.ts
pnpm run build:lib:host
```
