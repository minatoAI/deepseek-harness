# `reasoningEfforts.default` 点名的档位加入模型提供的档位集合

- **完成时间**：2026-08-19
- **分支**：`master`（基于 `cad80bb7f7`）
- **Commit**：
  - `6ade53f23b` — fix(llm-pi-ai): reasoningEfforts.default level joins the model's offer

## 摘要（Abstract）

`llm-pi-ai` 的 `reasoningEfforts` 原先要求：字典同时声明档位与 `default` 时，`default` 点名的档位必须已在档位键中再次出现。用户在本机 GUI 的 `settings.yaml` 中把 grok-4.6 写成 `reasoningEfforts: { default: medium, high: high }`（意图：提供 medium 与 high 两个档位，默认 medium），整节被校验拒绝，settings 服务保留上一次可用值，模型选择器仍只有旧配置的「Medium」一档——「增加 high 没有生效」。本次改为：被 `default` 点名的档位本身就是交付档位集合的一员（以规范拼写加入，除非已被档位键以自定义拼写重述），因此 `{ default: medium, high: high }` 直接提供 medium 与 high、默认 medium，与「只写 `default` 时该档位成为唯一档位」的既有语义一致。向后兼容：此前合法的声明语义不变。

## 背景（Background）

来源是本机 DeepSeek Harness GUI：用户为 `rightcode` 路由的 `grok-4.6` 增加 high 推理档位，写法为

```yaml
reasoningEfforts: { default: medium, high: high }
```

定位过程（`packages/llm/llm-pi-ai/src/catalog.ts` 的 `resolveModelReasoning`）：

- 只把字典中的**档位键**（此处只有 `high`）视为交付档位；`default: medium` 仅用于指名默认档。
- 随后校验「`default` 必须落在实际交付档位内」——`medium` 未作为档位键声明 → 抛出 `reasoningEfforts.default "medium" is not among the levels this model offers`。
- settings 命名空间把该节整体拒绝（`settings-rejected`，外部编辑时仅告警并保留 last good），`rightcode` 继续以旧配置 `{ default: medium }` 服务——只提供 Medium 一档。用户看到的现象就是「配置没生效、只有原先的 default medium」。

设计缺口在于不对称：只写 `default`（`{ default: medium }`）时该档位会以规范拼写成为唯一交付档位；一旦再声明任何档位键，`default` 点名的档位反而被要求重复声明一次。对手工声明的网关模型而言，部署方点名默认档就是「该模型支持此档位」的断言，没有外部真值可校验，重复声明只是负担。

## 改动过程（Process）

### Catalog：默认档位加入交付集合

`packages/llm/llm-pi-ai/src/catalog.ts`（`resolveModelReasoning` 的已声明档位分支）：

- 构建 `thinkingLevelMap` 后，若 `default` 点名的档位未作为档位键声明，则以规范拼写补入；已作为档位键声明则保留其线缆拼写（`{ default: medium, medium: balanced, high: high }` 中 `medium` 仍发送 `balanced`）。
- `default: off` 且未声明 `off` 键时，把 map 中固定的 `off: null` 移除——map 缺席正是 pi-ai「支持 Off、不发送参数」的拼写。
- 「只提供 `off` 之外无思考档位」的拒绝条件相应放宽：非 `off` 的默认档也算思考档位（`{ default: medium, off: null }` 现在提供 off 与 medium）。
- 原「`default` 必须落在交付档位内」的校验随之成为恒真，删除。
- 只含 `default` 的字典（catalog 保留交付集合 / 手工模型以该档位为唯一档位）与 catalog 默认档校验保持不变。

### 文档

- `PiAiReasoningEfforts` 与 `resolveModelReasoning` 的 JSDoc、`README.md` / `README.zh.md`「按模型的推理档位」一节同步改写：档位只写一次，不必既写键又写默认。
- 重新生成 `docs/config-catalog.md`，镜像 `docs/config-catalog.zh.md`，重新录制两对 .i18n.yaml 配对 hash。

### 测试

`packages/llm/llm-pi-ai/tests/catalog.spec.ts`：

- 原「`{ default: medium, high: high }` 被拒」的断言翻转为接受，并新增四组断言：默认档随声明键一起提供、重述的键保留自定义拼写、`default: off` 无需重声明 Off、非 `off` 默认档可作唯一思考档位（`{ default: medium, off: null }`）。
- 无效默认档（未知档位名、null、空串、只写 `default: off`、未知键）的拒绝断言保留。

## 总结（Summary）

- `reasoningEfforts: { default: medium, high: high }` 现在是合法、可服务的声明：提供 medium 与 high，默认 medium。
- 分层不变：请求点名 > 模型 `reasoningEfforts.default` > 路由 `reasoning` > 提供方自身默认。
- 边界：`default` 仍必须是 pi-ai 规范档位名；只含 `default` 的字典语义不变（catalog 模型保留 catalog 档位集合并校验默认档在其中，非推理 catalog 模型拒绝，手工模型以该档位为唯一档位）；只提供 `off` 仍拒绝。
- 遗留：运行中的宿主进程仍持有旧代码，需重启宿主（或重载插件）使新 lib 生效；已写入的 YAML 无需改动。
- 本次未改 Models UI 与 schema（`default` 键本就合法）。

## 验证（Verification）

以下均为实际执行的验证（2026-08-19）：

| 验证 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/llm/llm-pi-ai/tests/catalog.spec.ts packages/llm/llm-pi-ai/tests/config.spec.ts packages/llm/llm-pi-ai/tests/adapter.spec.ts --coverage.enabled=false` | 117 passed（3 个文件） |
| `pnpm run build:lib:host`（tsc -b tsconfig.host.json + tsdown host） | 通过（lib/index.js 已含新逻辑） |
| `pnpm exec tsx scripts/verify-translation-pairing.ts` | 947 对全部一致 |
| `pnpm exec tsx scripts/verify-md-links.ts` | 1920 个文件全部通过 |
| lefthook pre-commit（staged pairing / lint / whitespace / vendor guard） | 通过 |

可复现：

```sh
pnpm exec vitest run packages/llm/llm-pi-ai --coverage.enabled=false
pnpm run build:lib:host
pnpm exec tsx scripts/verify-translation-pairing.ts
pnpm exec tsx scripts/verify-md-links.ts
```
