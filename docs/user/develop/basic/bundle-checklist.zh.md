# 组合包开发检查清单

[English](bundle-checklist.md) | 中文

本清单覆盖组合包（bundle）作者从「可用的本地 patch」走向「可分发的包」时遇到的标准扩展面与常见坑。它与[发布教程](./publish.md)（打包、profile、安装）和[插件配置](./config.md)互补。发布或让用户安装之前，逐条过一遍。

## 先用 dsh plugin check 做本地校验

`dsh plugin check <bundle-directory>` 在本地校验组合包，不安装、不联网、不启动子进程：解析 patch 层、mock 挂载每一行插入的插件入口，并用注册期同一套规范化逻辑校验每个工具的 parameters schema。

```sh
dsh plugin check ./my-plugin        # text report; exit 0 when every row is ok
dsh plugin check ./my-plugin --json # machine-readable report
```

每次改动后和 CI 里都跑一遍。它是纯本地校验：传入已检出或已安装的组合包目录，而不是 GitHub spec。退出码 0 表示每一行插入都成功挂载、每个工具 schema 都通过校验；任何 error 都会指名失败的行或工具。

## 工具注册 schema

`ctx.tools.register` 把 `parameters` 对象**原样**转发给模型 API，因此它必须是根为 `object` 的完整 JSON Schema：

```js
ctx.tools.register({
  name: 'my_search',
  description: 'Searches my catalog.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      query: { type: 'string', description: 'Search query.' },
    },
    required: ['query'],
  },
  output: { schema: { type: 'string' }, render: () => [] },
  async execute(args, exec) { return 'ok' },
})
```

- `required` 里的每个名字都必须是 `properties` 的键（`required ⊆ properties`）。
- defineTool 式属性表（`{ query: { type: 'string', required: true } }`）会在注册时自动转换并输出一条 warning——旧代码兼容路径可用，但新代码请直接写完整形态。
- 其他任何形态都会在注册期以带工具名的错误失败——绝不要把「只有第一次模型调用才暴露」的 schema 发出去。`dsh plugin check` 离线执行同一套校验。

## 客户端配置 UI 与凭据

- 插件配置卡的标准 web 设置位是 `settings.plugin.item` 插槽（设置 → 插件 → 配置），由 web settings 包声明，无 owner props。
- 密钥走[凭据 seam](../../../../packages/credentials/credentials/README.md)：每次操作时 resolve，通过 `credentials.set`/`credentials.unset` 写入/删除，监听 `credentials/updated`，绝不把已存值回传页面——卡片只展示配置状态，不展示密钥本身。
- 凭据引用是稳定名字；用 describe 描述它，让 UI 能给出合理标签。

## 客户端→主机通道

- `credentials.*` RPC 对浏览器可见，覆盖状态读取与凭据写入。
- `webServer.register({ kind: 'exact', path, handler })` 在 `ctx.inject(['webServer'], ...)` 回调里注册主机侧路由，返回 disposer。api-proxy 的 `UNARY_ROUTES` 是封闭表——第三方组合包无法向它添加方法。
- 动态插件另有 `harness.handle(method, handler)` 用于私有主机方法。

## 网络传输

- 出站网络调用走 [subprocess 服务](../../../../packages/subprocess/subprocess/README.md)，而不是假设主机进程里有裸 `fetch`：spawn 出来的辅助进程隔离传输，服务负责解析可执行文件并收集输出。
- 系统代理处理是作者的责任：发现代理（Windows 上读 WinINET），给辅助进程设 `NODE_USE_ENV_PROXY`（以及 `HTTP(S)_PROXY`），传输失败时重新发现——jina 组合包用的就是这个模式。

## 从 git 安装

- git 安装拉取的是源码而非构建产物：要自带自包含的 `prepare` 脚本，并预期用户需要在 profile 的 `pnpm-workspace.yaml` 里用 `allowBuilds` 放行。细节以及 tarball/npm 替代方案：[发布教程](./publish.md#installing-from-github-the-build-script-catch)。

## 发布之前

- README（尽量中英成对）、LICENSE，以及绝不提交密钥文件的 `.gitignore`。
- `package.json` 的 `files` 白名单包含所有要发布的文件：入口模块、`cordis.patch.yml`、子路径条目（UI 半身用 `exports["./ui"]`）。
- 在干净 checkout 上最后跑一次 `dsh plugin check`，装进全新 profile 并启动一次，再打发布 tag。

## 参见

- [打包与安装插件](./publish.md)
- [插件配置](./config.md)
- [凭据子系统](../../../subsystems/credentials.md)
- [子进程子系统](../../../subsystems/subprocess.md)
