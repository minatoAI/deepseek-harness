/**
 * `dsh plugin check` engine — validate a DSH bundle locally, without
 * installing, networking, or spawning a subprocess: parse the bundle's patch
 * layer, mock-mount every inserted plugin entry, and verify each tool's
 * parameters schema through the same normalization the registry applies
 * (retrospective item 2). The engine is pure data in, report out; the CLI
 * layer only renders and exits.
 * @module @deepseek-ai/dsh/plugin-check
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { assertSupportedJsonSchema, normalizeRegisteredParameters } from '@deepseek-ai/dsh-tools'

/** One inserted composition row's verdict. */
export type PluginCheckStatus = 'ok' | 'warn' | 'error'

/** One registered tool's schema verdict. */
export interface PluginCheckTool {
  name: string
  status: 'ok' | 'converted' | 'error'
  /** Human-readable detail for converted/error tools. */
  message?: string
  /** The validated (or converted) model-facing parameters schema. */
  parameters?: Record<string, unknown>
}

/** One captured `webServer.register` route. */
export interface PluginCheckRoute {
  kind: string
  path: string
}

/** One inserted composition row and its mock-mount outcome. */
export interface PluginCheckLine {
  id?: string
  /** The row's plugin name (`<bundle>` or `<bundle>/<subpath>` or an external package). */
  name: string
  status: PluginCheckStatus
  message?: string
  /** Absolute entry file the row resolved to (absent for external packages). */
  entry?: string
  /** Registered tool verdicts. */
  tools: PluginCheckTool[]
  /** Declared plus `ctx.inject` dependency names. */
  inject: string[]
  /** Captured `ctx.slots.inject` slot names. */
  slots: string[]
  /** Captured `webServer.register` routes. */
  routes: PluginCheckRoute[]
}

/** The complete check result; `ok` decides the CLI exit code. */
export interface PluginCheckReport {
  bundleName: string
  bundleVersion: string
  patchPath: string
  lines: PluginCheckLine[]
  warnings: string[]
  errors: string[]
  ok: boolean
}

/**
 * Harness services the mock either provides (`tools`, `webServer`, `slots`,
 * `logger`) or recognizes as standard harness services it does not fake
 * (`fs`, `subprocess`, `credentials`, ...). Any other inject dependency is
 * reported as an unknown-inject warning — most likely a typo or a service
 * that does not exist in the target profile.
 */
const KNOWN_SERVICES = new Set([
  'tools', 'webServer', 'slots', 'logger',
  'fs', 'subprocess', 'credentials', 'settings', 'sandboxPolicy', 'model',
  'systemPrompt', 'session', 'scope', 'config', 'loader', 'time', 'random',
  'router', 'server', 'http', 'storage', 'database', 'userApproval',
  'watermark', 'spill', 'workspace', 'feedback', 'preset', 'skill',
  'interaction', 'identity', 'guard', 'plan', 'todo', 'goal', 'jobs',
  'schedule', 'terminal', 'shell', 'mcp', 'lsp', 'attachment', 'host', 'web',
  'agent', 'subagent', 'workflow', 'persistence', 'sessionPersistence',
])

/** Accumulated mock observations shared by one mounted row's context tree. */
interface MockState {
  label: string
  tools: PluginCheckTool[]
  routes: PluginCheckRoute[]
  slots: string[]
  injects: string[]
  unknownInject: string[]
  warnings: string[]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build one bundle-level failure report. */
function bundleFailure(bundleName: string, bundleVersion: string, patchPath: string, message: string): PluginCheckReport {
  return {
    bundleName,
    bundleVersion,
    patchPath,
    lines: [],
    warnings: [],
    errors: [message],
    ok: false,
  }
}

/** Record one inject dependency (declared or `ctx.inject`) with unknown-name warning. */
function recordInject(state: MockState, dep: string): void {
  state.injects.push(dep)
  if (!KNOWN_SERVICES.has(dep)) {
    state.unknownInject.push(dep)
    state.warnings.push(`plugin ${state.label}: unknown inject dependency "${dep}" — verify the service exists in the target profile`)
  }
}

/**
 * Build the mock context: `ctx.get` returns undefined, `ctx.on`/`ctx.effect`
 * record nothing, `ctx.tools.register` validates and normalizes, `ctx.inject`
 * runs the callback against a child context that carries the fakes for the
 * requested services, and the `webServer` fake captures routes.
 * @param state - shared observation accumulator.
 * @param fakes - service names to pre-install on this context.
 * @returns the mock context object.
 */
function createMockCtx(state: MockState, fakes: ReadonlySet<string>): Record<string, unknown> {
  const installWebServer = (target: Record<string, unknown>): void => {
    target.webServer = {
      register(route: unknown): () => void {
        if (typeof route !== 'object' || route === null) {
          throw new Error('webServer.register(options): options must be an object')
        }
        const kind = (route as { kind?: unknown }).kind
        const path = (route as { path?: unknown }).path
        const handler = (route as { handler?: unknown }).handler
        if (typeof kind !== 'string') throw new Error('webServer.register: kind must be a string (e.g. "exact")')
        if (typeof path !== 'string') throw new Error('webServer.register: path must be a string')
        if (typeof handler !== 'function') throw new Error('webServer.register: handler must be a function')
        state.routes.push({ kind, path })
        return () => {}
      },
    }
  }
  const ctx: Record<string, unknown> = {
    get(): undefined {
      return undefined
    },
    on(): void {},
    effect(): void {},
    inject(deps: unknown, callback: unknown): void {
      if (!Array.isArray(deps) || typeof callback !== 'function') {
        throw new Error('ctx.inject(deps, callback): deps must be an array of service names and callback a function')
      }
      for (const dep of deps) {
        if (typeof dep !== 'string') throw new Error('ctx.inject: dependency names must be strings')
      }
      const requested = deps as string[]
      const provided: string[] = []
      for (const dep of requested) {
        recordInject(state, dep)
        if (dep === 'webServer') provided.push(dep)
      }
      // The callback is deferred in the real runtime until every requested
      // service exists; the mock treats the fakes it can provide as present
      // and runs the callback once, against a child context carrying them.
      if (provided.length > 0) {
        // Explicit semicolon: the next line starts with `(`, which ASI would
        // otherwise join into `createMockCtx(...)(callback)(child)`.
        const child = createMockCtx(state, new Set(provided));
        (callback as (ctx: Record<string, unknown>) => unknown)(child)
      }
    },
    logger: {
      warn(message: unknown): void { state.warnings.push(String(message)) },
      info(): void {},
      error(): void {},
      debug(): void {},
      success(): void {},
    },
    tools: {
      register(definition: unknown): () => void {
        const name = typeof (definition as { name?: unknown } | null)?.name === 'string'
          ? (definition as { name: string }).name
          : '(unnamed tool)'
        const tool: PluginCheckTool = { name, status: 'ok' }
        try {
          if (typeof definition !== 'object' || definition === null) {
            throw new Error(`tool "${name}": registration must be an object`)
          }
          if (typeof (definition as { execute?: unknown }).execute !== 'function') {
            throw new Error(`tool "${name}": execute must be a function`)
          }
          const output = (definition as { output?: unknown }).output
          if (typeof output !== 'object' || output === null
            || typeof (output as { render?: unknown }).render !== 'function') {
            throw new Error(`tool "${name}": output must declare { schema, render }`)
          }
          assertSupportedJsonSchema((output as { schema: unknown }).schema)
          const parameters = (definition as { parameters?: unknown }).parameters
          if (typeof parameters !== 'object' || parameters === null) {
            throw new Error(`tool "${name}": parameters must be a JSON Schema object`)
          }
          const normalized = normalizeRegisteredParameters(name, parameters as Record<string, unknown>)
          tool.parameters = normalized
          if (normalized !== parameters) {
            tool.status = 'converted'
            tool.message = 'defineTool-style property-table parameters converted to a complete JSON Schema'
          }
        } catch (error) {
          tool.status = 'error'
          tool.message = errorMessage(error)
        }
        state.tools.push(tool)
        return () => {}
      },
    },
    slots: {
      inject(...args: unknown[]): void {
        if (typeof args[0] === 'string') state.slots.push(args[0])
      },
    },
  }
  if (fakes.has('webServer')) installWebServer(ctx)
  return ctx
}

/** Resolve one inserted row's plugin name to an entry file inside the bundle. */
interface EntryResolution {
  file?: string
  warning?: string
}

function resolveEntry(
  bundleName: string,
  bundleDir: string,
  manifest: Record<string, unknown>,
  pluginName: string,
): EntryResolution {
  if (pluginName === bundleName) {
    const main = typeof manifest.main === 'string'
      ? manifest.main
      : typeof (manifest.exports as Record<string, unknown> | undefined)?.['.'] === 'string'
        ? (manifest.exports as Record<string, string>)['.']
        : undefined
    if (main === undefined) return {}
    return { file: resolve(bundleDir, main) }
  }
  if (pluginName.startsWith(`${bundleName}/`)) {
    const sub = pluginName.slice(bundleName.length + 1)
    const exports = manifest.exports as Record<string, unknown> | undefined
    const target = exports?.[`./${sub}`]
    const rel = typeof target === 'string'
      ? target
      : typeof target === 'object' && target !== null && typeof (target as Record<string, unknown>).default === 'string'
        ? (target as Record<string, string>).default
        : undefined
    if (rel !== undefined) return { file: resolve(bundleDir, rel) }
    // Fall back to a package-relative file path spelled by the row name.
    for (const candidate of [join(bundleDir, sub), join(bundleDir, sub, 'index.js')]) {
      if (existsSync(candidate)) return { file: candidate }
    }
    return {}
  }
  // External package: resolvable only inside an installed profile.
  try {
    const require = createRequire(join(bundleDir, 'package.json'))
    return { file: require.resolve(pluginName) }
  } catch {
    return { warning: `plugin "${pluginName}" is an external package — its entry resolves only after installation (needs an installed profile environment)` }
  }
}

/** Mock-mount one inserted row and collect its tools, injects, slots, and routes. */
async function checkRow(
  row: { id?: string; name: string },
  bundleName: string,
  bundleDir: string,
  manifest: Record<string, unknown>,
): Promise<PluginCheckLine> {
  const line: PluginCheckLine = {
    name: row.name,
    status: 'ok',
    tools: [],
    inject: [],
    slots: [],
    routes: [],
    ...(row.id !== undefined ? { id: row.id } : {}),
  }
  const resolution = resolveEntry(bundleName, bundleDir, manifest, row.name)
  if (resolution.warning !== undefined) {
    line.status = 'warn'
    line.message = resolution.warning
    return line
  }
  if (resolution.file === undefined || !existsSync(resolution.file)) {
    line.status = 'error'
    line.message = `entry file for plugin "${row.name}" not found${resolution.file === undefined ? '' : ` (resolved ${resolution.file})`} — the bundle may need a prepare/build step before check`
    return line
  }
  line.entry = resolution.file

  let module: unknown
  try {
    module = await import(pathToFileURL(resolution.file).href)
  } catch (error) {
    line.status = 'error'
    line.message = `failed to import ${resolution.file}: ${errorMessage(error)}`
    return line
  }

  const namespace = module as Record<string, unknown> | undefined
  const plugin = namespace !== undefined && typeof namespace.apply === 'function'
    ? namespace
    : namespace !== undefined && typeof namespace.default === 'object' && namespace.default !== null
      && typeof (namespace.default as Record<string, unknown>).apply === 'function'
      ? namespace.default as Record<string, unknown>
      : undefined
  if (plugin === undefined) {
    line.status = 'error'
    line.message = `plugin entry "${row.name}" exports no apply function`
    return line
  }

  const state: MockState = {
    label: row.name,
    tools: [],
    routes: [],
    slots: [],
    injects: [],
    unknownInject: [],
    warnings: [],
  }
  const declared = Array.isArray(plugin.inject)
    ? plugin.inject.filter((dep): dep is string => typeof dep === 'string')
    : []
  const fakes = new Set(declared.filter(dep => dep === 'webServer'))
  for (const dep of declared) recordInject(state, dep)
  try {
    (plugin.apply as (ctx: Record<string, unknown>) => unknown)(createMockCtx(state, fakes))
  } catch (error) {
    line.status = 'error'
    line.message = `plugin "${row.name}" apply() threw: ${errorMessage(error)}`
    return line
  }

  line.tools = state.tools
  line.inject = state.injects
  line.slots = state.slots
  line.routes = state.routes

  const failedTools = line.tools.filter(tool => tool.status === 'error')
  if (failedTools.length > 0) {
    line.status = 'error'
    line.message = `tool schema errors: ${failedTools.map(tool => tool.name).join(', ')}`
  } else if (line.tools.some(tool => tool.status === 'converted')) {
    const count = line.tools.filter(tool => tool.status === 'converted').length
    line.status = 'warn'
    line.message = `${count} tool(s) used a defineTool-style property-table schema — converted to a complete JSON Schema`
  } else if (state.unknownInject.length > 0) {
    line.status = 'warn'
    line.message = `unknown inject dependencies: ${state.unknownInject.join(', ')}`
  }
  return line
}

/**
 * Validate one bundle: read its manifest, parse its patch layer, resolve and
 * mock-mount every inserted row, and verify every tool schema. Never throws
 * for user-facing failures — everything lands in the report.
 * @param target - local bundle directory (or a GitHub spec, reported as
 * local-only).
 * @returns the complete check report; `ok` decides the CLI exit code.
 */
export async function checkBundle(target: string): Promise<PluginCheckReport> {
  const bundleDir = resolve(target)
  const manifestPath = join(bundleDir, 'package.json')
  if (!existsSync(manifestPath)) {
    return bundleFailure(
      target, '', '',
      `${target} is not a local bundle directory (no package.json) — dsh plugin check is a local-only validator; pass a checked-out or installed bundle path`,
    )
  }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  } catch (error) {
    return bundleFailure(target, '', '', `failed to parse ${manifestPath}: ${errorMessage(error)}`)
  }
  const bundleName = typeof manifest.name === 'string' ? manifest.name : '(unnamed bundle)'
  const bundleVersion = typeof manifest.version === 'string' ? manifest.version : ''
  const patchRel = typeof (manifest.dsh as Record<string, unknown> | undefined)?.bundle === 'object'
    && (manifest.dsh as Record<string, unknown>).bundle !== null
    && typeof ((manifest.dsh as Record<string, unknown>).bundle as Record<string, unknown>).patch === 'string'
    ? ((manifest.dsh as Record<string, unknown>).bundle as Record<string, string>).patch
    : undefined
  if (patchRel === undefined) {
    return bundleFailure(
      bundleName, bundleVersion, '',
      `${manifestPath} declares no dsh.bundle.patch — this package is not a DSH bundle (or its dsh.bundle section is missing)`,
    )
  }
  const patchPath = resolve(bundleDir, patchRel)
  let patches: PatchOptions[]
  try {
    patches = loadOverlayPatches('dsh', patchPath)
  } catch (error) {
    return bundleFailure(bundleName, bundleVersion, patchPath, errorMessage(error))
  }

  const rows: Array<{ id?: string; name: string }> = []
  for (const patch of patches) {
    for (const entry of patch.insert ?? []) {
      if (typeof entry !== 'object' || entry === null) continue
      const name = (entry as { name?: unknown }).name
      if (typeof name !== 'string') continue
      const id = (entry as { id?: unknown }).id
      if (typeof id === 'string') rows.push({ id, name })
      else rows.push({ name })
    }
  }

  const warnings: string[] = []
  if (rows.length === 0) warnings.push('patch layer declares no inserted rows (a config-only patch is fine)')
  const lines: PluginCheckLine[] = []
  for (const row of rows) {
    const line = await checkRow(row, bundleName, bundleDir, manifest)
    lines.push(line)
    for (const warning of line.tools.filter(tool => tool.status === 'converted')) {
      warnings.push(`plugin ${line.name}: tool "${warning.name}" used a property-table schema — converted to a complete JSON Schema`)
    }
  }
  return {
    bundleName,
    bundleVersion,
    patchPath,
    lines,
    warnings,
    errors: [],
    ok: lines.every(line => line.status !== 'error'),
  }
}

/**
 * Render one report as JSON (lossless, parseable) or as a human-readable
 * text listing. The JSON form is the raw report, so every field round-trips.
 * @param report - the check result.
 * @param json - render JSON instead of text.
 * @returns the rendered report, one line-terminated document.
 */
export function renderCheckReport(report: PluginCheckReport, json: boolean): string {
  if (json) return `${JSON.stringify(report, null, 2)}\n`
  const out: string[] = []
  out.push(`bundle ${report.bundleName}@${report.bundleVersion}`)
  out.push(`patch ${report.patchPath || '(none)'}`)
  for (const line of report.lines) {
    const tag = line.status === 'error' ? 'error' : line.status === 'warn' ? 'warn ' : 'ok   '
    const id = line.id === undefined ? '' : ` (id: ${line.id})`
    const detail = line.message === undefined ? '' : ` — ${line.message}`
    out.push(`  [${tag}] ${line.name}${id}${detail}`)
    if (line.entry !== undefined) out.push(`         entry: ${line.entry}`)
    if (line.tools.length > 0) {
      out.push(`         tools: ${line.tools.map(tool => `${tool.name} (${tool.status})`).join(', ')}`)
    }
    if (line.routes.length > 0) {
      out.push(`         routes: ${line.routes.map(route => `${route.kind} ${route.path}`).join(', ')}`)
    }
  }
  for (const warning of report.warnings) out.push(`  warn  ${warning}`)
  for (const error of report.errors) out.push(`  error ${error}`)
  const toolCount = report.lines.reduce((sum, line) => sum + line.tools.length, 0)
  const errorCount = report.errors.length + report.lines.filter(line => line.status === 'error').length
  out.push(report.ok
    ? `check passed — ${toolCount} tool(s) across ${report.lines.length} row(s)`
    : `check failed — ${errorCount} error(s)`)
  return `${out.join('\n')}\n`
}
