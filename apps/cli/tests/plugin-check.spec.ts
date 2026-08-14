/**
 * `dsh plugin check` — validate a DSH bundle locally: parse its patch layer,
 * mock-mount every inserted plugin entry, and verify each tool's parameters
 * schema (through the same normalization the registry applies) without
 * installing, networking, or spawning a subprocess.
 */

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDshArgs } from '../src/args.ts'
import { checkBundle, renderCheckReport } from '../src/plugin-check.ts'
import { runPluginCheck } from '../src/plugin.ts'

const created: string[] = []

/** One line of the patch YAML inserting one row. */
const row = (id: string, name: string): string => `    - id: ${id}\n      name: ${name}\n`

/** The minimal good bundle: one full-schema tool, one empty UI half. */
const GOOD_INDEX = `
export const name = 'test-bundle'
export const inject = ['tools']
export function apply(ctx) {
  ctx.tools.register({
    name: 'probe_read',
    description: 'probe read tool',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { url: { type: 'string', description: 'Page URL.' } },
      required: ['url'],
    },
    output: { schema: { type: 'string' }, render: () => [] },
    async execute() { return 'ok' },
  })
  ctx.inject(['webServer'], (rpcCtx) => {
    rpcCtx.webServer.register({ kind: 'exact', path: '/api/probe', handler: async () => {} })
  })
}
`

const UI_INDEX = `
export const name = 'test-bundle-ui'
export const inject = []
export function apply() {}
`

const GOOD_MANIFEST = {
  name: 'test-bundle',
  version: '1.2.3',
  type: 'module',
  main: 'index.js',
  exports: { '.': './index.js', './ui': './ui/index.js' },
  dsh: { bundle: { patch: './cordis.patch.yml' } },
}

/** Build one fixture directory in the OS temp area. */
async function makeFixture(files: Record<string, string | object>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-check-'))
  created.push(dir)
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    await mkdir(dirname(full), { recursive: true })
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2)
    await writeFile(full, text)
  }
  return dir
}

/** The good-bundle fixture with the standard patch (two rows). */
async function goodBundle(overrides: Record<string, string | object> = {}): Promise<string> {
  return makeFixture({
    'package.json': GOOD_MANIFEST,
    'cordis.patch.yml': `- insert:\n${row('main-tools', 'test-bundle')}${row('ui-half', 'test-bundle/ui')}`,
    'index.js': GOOD_INDEX,
    'ui/index.js': UI_INDEX,
    ...overrides,
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(created.splice(0).map(dir => import('node:fs/promises').then(({ rm }) => rm(dir, { recursive: true, force: true }))))
})

describe('checkBundle', () => {
  it('reports a good bundle as fully ok with tools, schema, and routes in the report', async () => {
    const dir = await goodBundle()
    const report = await checkBundle(dir)
    expect(report.bundleName).toBe('test-bundle')
    expect(report.bundleVersion).toBe('1.2.3')
    expect(report.patchPath.endsWith('cordis.patch.yml')).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.lines.map(line => line.name)).toEqual(['test-bundle', 'test-bundle/ui'])
    expect(report.lines.map(line => line.status)).toEqual(['ok', 'ok'])
    const tool = report.lines[0]!.tools[0]!
    expect(tool.name).toBe('probe_read')
    expect(tool.status).toBe('ok')
    expect(tool.parameters).toMatchObject({
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    })
    expect(report.lines[0]!.routes).toEqual([{ kind: 'exact', path: '/api/probe' }])
    expect(report.lines[0]!.inject).toContain('tools')
    expect(report.lines[0]!.inject).toContain('webServer')
    // The tool name and schema appear in the rendered report (JSON form).
    const json = JSON.parse(renderCheckReport(report, true)) as typeof report
    expect(json.lines[0]!.tools[0]!.name).toBe('probe_read')
    expect(json.lines[0]!.tools[0]!.parameters!.type).toBe('object')
  })

  it('warns (not errors) when a tool uses a property-table schema and auto-converts it', async () => {
    const dir = await goodBundle({
      'index.js': `
export const name = 'test-bundle'
export function apply(ctx) {
  ctx.tools.register({
    name: 'legacy_tool',
    description: 'legacy table',
    parameters: { q: { type: 'string', required: true }, n: { type: 'number' } },
    output: { schema: { type: 'string' }, render: () => [] },
    async execute() { return 'ok' },
  })
}
`,
    })
    const report = await checkBundle(dir)
    expect(report.ok).toBe(true)
    const line = report.lines.find(l => l.name === 'test-bundle')!
    expect(line.status).toBe('warn')
    expect(line.message).toMatch(/converted/i)
    const tool = line.tools[0]!
    expect(tool.status).toBe('converted')
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: { q: { type: 'string' }, n: { type: 'number' } },
      required: ['q'],
    })
  })

  it('errors a line whose tool schema root is not an object, naming the tool', async () => {
    const dir = await goodBundle({
      'index.js': `
export const name = 'test-bundle'
export function apply(ctx) {
  ctx.tools.register({
    name: 'broken_tool',
    description: 'broken',
    parameters: { type: 'array' },
    output: { schema: { type: 'string' }, render: () => [] },
    async execute() { return 'ok' },
  })
}
`,
    })
    const report = await checkBundle(dir)
    expect(report.ok).toBe(false)
    const line = report.lines.find(l => l.name === 'test-bundle')!
    expect(line.status).toBe('error')
    expect(line.tools[0]!.status).toBe('error')
    expect(line.tools[0]!.message).toMatch(/broken_tool/)
    // CLI exit code follows the report.
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    expect(await runPluginCheck(dir, true)).toBe(1)
    write.mockRestore()
  })

  it('reports clear errors for a missing patch file and for a manifest without dsh.bundle', async () => {
    const missingPatch = await goodBundle()
    await import('node:fs/promises').then(({ rm }) => rm(join(missingPatch, 'cordis.patch.yml')))
    const first = await checkBundle(missingPatch)
    expect(first.ok).toBe(false)
    expect(first.errors.join(' ')).toMatch(/cordis\.patch\.yml/)

    const noBundle = await makeFixture({
      'package.json': { name: 'plain-lib', version: '0.0.1', main: 'index.js' },
      'index.js': UI_INDEX,
    })
    const second = await checkBundle(noBundle)
    expect(second.ok).toBe(false)
    expect(second.errors.join(' ')).toMatch(/dsh\.bundle/)
  })

  it('errors a row whose entry cannot be found instead of crashing', async () => {
    const dir = await goodBundle({
      'cordis.patch.yml': `- insert:\n${row('ghost', 'test-bundle/ghost')}`,
    })
    const report = await checkBundle(dir)
    expect(report.ok).toBe(false)
    const line = report.lines[0]!
    expect(line.name).toBe('test-bundle/ghost')
    expect(line.status).toBe('error')
    expect(line.message).toMatch(/ghost/)
  })

  it('catches a plugin module that throws on import as a line error', async () => {
    const dir = await goodBundle({
      'index.js': 'throw new Error(\'boom at import\')\n',
    })
    const report = await checkBundle(dir)
    expect(report.ok).toBe(false)
    expect(report.lines[0]!.status).toBe('error')
    expect(report.lines[0]!.message).toMatch(/boom at import/)
  })

  it('renders a JSON output that round-trips with every report field', async () => {
    const dir = await goodBundle()
    const report = await checkBundle(dir)
    const parsed = JSON.parse(renderCheckReport(report, true)) as typeof report
    expect(parsed).toEqual(report)
    expect(Object.keys(parsed).sort()).toEqual(['bundleName', 'bundleVersion', 'errors', 'lines', 'ok', 'patchPath', 'warnings'])
  })
})

describe('parseDshArgs plugin check routing', () => {
  it('routes plugin check without --profile and keeps --json after the target', () => {
    expect(parseDshArgs(['plugin', 'check', './x'], '1.2.3'))
      .toEqual({ mode: 'plugin-check', target: './x', json: false })
    expect(parseDshArgs(['plugin', 'check', './x', '--json'], '1.2.3'))
      .toEqual({ mode: 'plugin-check', target: './x', json: true })
  })

  it('still requires --profile for pnpm-forwarded verbs like add', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit') })
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      parseDshArgs(['plugin', 'add', 'x'], '1.2.3')
      throw new Error('expected exit')
    } catch {
      expect(exit.mock.calls.at(-1)?.[0]).toBe(1)
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('regression: pnpm forwarding with --profile is unchanged', () => {
    expect(parseDshArgs(['plugin', '--profile', 'tui', 'add', 'turtle-ui'], '1.2.3'))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', 'turtle-ui'] })
    expect(parseDshArgs(['plugin', '--profile', 'tui', 'add', '--save-dev', 'x'], '1.2.3'))
      .toEqual({ mode: 'plugin', profile: 'tui', args: ['add', '--save-dev', 'x'] })
  })
})
