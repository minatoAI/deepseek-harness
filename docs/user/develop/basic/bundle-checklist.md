# Bundle development checklist

English | [中文](bundle-checklist.zh.md)

A checklist of the extension points and pitfalls a bundle author hits when moving from a working local patch to a distributable package. It complements the [publish tutorial](./publish.md) (packaging, profiles, install) and [plugin configuration](./config.md). Complete every item before publishing or asking users to install.

## Validate locally with dsh plugin check

`dsh plugin check <bundle-directory>` validates a bundle without installing, networking, or spawning a subprocess: it parses the patch layer, mock-mounts every inserted plugin entry, and verifies each tool's parameters schema with the same normalization the registry applies at registration.

```sh
dsh plugin check ./my-plugin        # text report; exit 0 when every row is ok
dsh plugin check ./my-plugin --json # machine-readable report
```

Run it after every edit and in CI. It is local-only: pass a checked-out or installed bundle directory, not a GitHub spec. Exit code 0 means every inserted row mounted and every tool schema validated; any error names the failing row or tool.

## Tool registration schemas

`ctx.tools.register` forwards the `parameters` object to the model API verbatim, so it must be a complete JSON Schema with an object root:

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

- Every `required` name must name a `properties` key (`required ⊆ properties`).
- A defineTool-style property table (`{ query: { type: 'string', required: true } }`) is converted automatically at registration with a warning — the legacy path works, but prefer the complete form for new code.
- Any other shape fails at registration with a tool-named error — never ship a schema that only fails at the first model call. `dsh plugin check` applies the same validation offline.

## Client configuration UI and credentials

- The standard web-settings surface for a plugin configuration card is the `settings.plugin.item` slot (Settings → Plugins → Configure), declared by the web settings package with no owner props.
- Store secrets through the [credentials seam](../../../../packages/credentials/credentials/README.md): resolve per operation, set/unset through `credentials.set`/`credentials.unset`, listen for `credentials/updated`, and never send a stored value back to the page — the card shows configured state, not the secret.
- Credential references are stable names; describe them so the UI can offer a sensible label.

## Client-to-host channels

- `credentials.*` RPC is browser-visible and covers reading state and writing credentials.
- `webServer.register({ kind: 'exact', path, handler })` registers host-side routes from an `ctx.inject(['webServer'], ...)` callback and returns a disposer. The api-proxy `UNARY_ROUTES` table is closed — third-party bundles cannot add methods to it.
- Dynamic plugins additionally get `harness.handle(method, handler)` for private host methods.

## Network transport

- Route outbound network calls through the [subprocess service](../../../../packages/subprocess/subprocess/README.md) rather than assuming a bare `fetch` in the host process: the spawned helper isolates transport, and the service resolves the executable and collects output.
- System-proxy handling is the author's responsibility: discover the proxy (WinINET on Windows), set `NODE_USE_ENV_PROXY` (plus `HTTP(S)_PROXY`) for the helper, and rediscover on transport failure — the pattern used by the jina bundle.

## Installing from git

- Git installs fetch sources, not built artifacts: ship a self-contained `prepare` script and expect users to allowlist it under `allowBuilds` in the profile's `pnpm-workspace.yaml`. Details and the tarball/npm alternatives: [publish tutorial](./publish.md#installing-from-github-the-build-script-catch).

## Before you publish

- README (bilingual pair when you can), LICENSE, and a `.gitignore` that never commits key files.
- The `package.json` `files` whitelist includes every shipped file: entry modules, `cordis.patch.yml`, and sub-path entries (`exports["./ui"]` for a UI half).
- Run `dsh plugin check` one last time on a clean checkout, install into a fresh profile, and boot once before tagging a release.

## See also

- [Package and install a plugin](./publish.md)
- [Plugin configuration](./config.md)
- [Credentials subsystem](../../../subsystems/credentials.md)
- [Subprocess subsystem](../../../subsystems/subprocess.md)
