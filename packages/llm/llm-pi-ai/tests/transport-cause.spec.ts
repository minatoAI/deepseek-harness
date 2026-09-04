import { channel } from 'node:diagnostics_channel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import {
  installTransportCauseLogging,
  redactTransportUrl,
  summarizeTransportError,
  takeTransportCause,
  uninstallTransportCauseLogging,
} from '../src/transport-cause.ts'

function undiciError(message: string, code: string, causeMessage: string, causeCode: string): Error {
  const cause = new Error(causeMessage) as Error & { code: string }
  cause.code = causeCode
  const error = new Error(message) as Error & { code: string; cause: Error }
  error.code = code
  error.cause = cause
  return error
}

/** Stderr lines written by this module only (the host hook uses its own prefix). */
function causeLines(writes: unknown[][]): string[] {
  return writes
    .map(call => String(call[0]))
    .filter(line => line.startsWith('[dsh-undici-cause]'))
}

describe('redactTransportUrl', () => {
  it('keeps host and path while dropping credentials, query, and hash', () => {
    expect(redactTransportUrl('https://user:pass@opencode.ai/zen/go/v1/responses?apiKey=secret#frag'))
      .toEqual({ host: 'opencode.ai', path: '/zen/go/v1/responses' })
  })

  it('passes unparseable values through truncated', () => {
    expect(redactTransportUrl('not a url')).toEqual({ host: '', path: 'not a url' })
    expect(redactTransportUrl('x'.repeat(500))).toEqual({ host: '', path: 'x'.repeat(120) })
  })
})

describe('summarizeTransportError', () => {
  it('keeps undici codes with their socket cause', () => {
    expect(summarizeTransportError(undiciError('fetch failed', 'UND_ERR_FETCH', 'other side closed', 'UND_ERR_SOCKET')))
      .toEqual({
        code: 'UND_ERR_FETCH',
        message: 'fetch failed',
        causeCode: 'UND_ERR_SOCKET',
        causeMessage: 'other side closed',
      })
  })

  it('reads the message from wherever the rejection carries it', () => {
    expect(summarizeTransportError(new Error('boom'))).toMatchObject({ code: '', causeCode: '' })
    expect(summarizeTransportError({ cause: { message: 'gone' } }))
      .toMatchObject({ code: '', message: 'gone', causeCode: '', causeMessage: 'gone' })
    expect(summarizeTransportError('plain failure')).toMatchObject({ message: 'plain failure' })
    expect(summarizeTransportError(null)).toMatchObject({ code: '', causeCode: '', causeMessage: '' })
  })

  it('tolerates null, missing, and primitive causes', () => {
    expect(summarizeTransportError({ message: 'x', cause: null }).causeMessage).toBe('')
    expect(summarizeTransportError({ message: 'x', cause: 'gone' }).causeMessage).toBe('gone')
    expect(summarizeTransportError({ message: 'x', cause: {} }).causeCode).toBe('')
  })

  it('collapses whitespace and truncates long codes and messages', () => {
    const summary = summarizeTransportError({
      code: 'C'.repeat(100),
      message: `a\n  b\t${'m'.repeat(500)}`,
      cause: { code: 'K'.repeat(100), message: 'c  d' },
    })
    expect(summary.code).toBe('C'.repeat(40))
    expect(summary.causeCode).toBe('K'.repeat(100).slice(0, 40))
    expect(summary.message).toHaveLength(200)
    expect(summary.message).toContain('a b')
    expect(summary.causeMessage).toBe('c d')
  })
})

describe('takeTransportCause', () => {
  it('reads absent without a capture', () => {
    expect(takeTransportCause()).toBeUndefined()
  })
})

describe('transport cause logging', () => {
  let stderr: MockInstance
  let realFetch: typeof globalThis.fetch

  beforeEach(() => {
    uninstallTransportCauseLogging()
    realFetch = globalThis.fetch
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    uninstallTransportCauseLogging()
    globalThis.fetch = realFetch
    vi.unstubAllEnvs()
    stderr.mockRestore()
  })

  it('ignores a teardown without an install', () => {
    expect(() => { uninstallTransportCauseLogging() }).not.toThrow()
  })

  it('composes with an existing fetch wrapper instead of replacing it', async () => {
    const stub = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = stub
    globalThis.__dshTransportCauseWrapped = true
    installTransportCauseLogging()
    await globalThis.fetch('https://gateway.test/v1/responses', { method: 'POST' })
    expect(stub).toHaveBeenCalledTimes(1)
    expect(causeLines(stderr.mock.calls)).toHaveLength(0)
    channel('undici:request:create').publish({
      request: { origin: 'https://gateway.test', path: '/v1/responses', method: 'POST' },
    })
    channel('undici:request:error').publish({
      request: { origin: 'https://gateway.test', path: '/v1/responses', method: 'POST' },
      error: undiciError('fetch failed', 'UND_ERR_FETCH', 'other side closed', 'UND_ERR_SOCKET'),
    })
    expect(causeLines(stderr.mock.calls)).toHaveLength(1)
    expect(takeTransportCause()).toEqual({ code: 'UND_ERR_SOCKET', message: 'other side closed' })
    globalThis.__dshTransportCauseWrapped = undefined
  })

  it('logs through a delegate that rejects non-Request input', async () => {
    const stub = vi.fn(async (): Promise<Response> => { throw new TypeError('Failed to parse URL') })
    globalThis.fetch = stub
    installTransportCauseLogging()
    await expect(globalThis.fetch({} as unknown as string)).rejects.toThrow('Failed to parse URL')
    const lines = causeLines(stderr.mock.calls)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('fetch-error GET  bodyBytes=0')
    expect(takeTransportCause()).toEqual({ message: 'Failed to parse URL' })
  })

  it('keeps the first wrapper across repeated installs', async () => {
    const stub = vi.fn(async () => new Response('{}', { status: 200 }))
    globalThis.fetch = stub
    installTransportCauseLogging()
    installTransportCauseLogging()
    await globalThis.fetch(new URL('https://gateway.test/v1/responses'), { method: 'POST', body: 'x'.repeat(10) })
    expect(stub).toHaveBeenCalledTimes(1)
    const lines = causeLines(stderr.mock.calls)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('fetch-ok POST gateway.test/v1/responses bodyBytes=10 status=200')
    expect(lines.join('\n')).not.toContain('apiKey')
  })

  it('logs redacted fetch failures and records their cause', async () => {
    const stub = vi.fn(async (): Promise<Response> => {
      throw undiciError('fetch failed', 'UND_ERR_FETCH', 'other side closed', 'UND_ERR_SOCKET')
    })
    globalThis.fetch = stub
    installTransportCauseLogging()
    await expect(globalThis.fetch('https://opencode.ai/zen/go/v1/responses?apiKey=secret', {
      method: 'POST',
      body: new TextEncoder().encode('{}'),
    })).rejects.toThrow('fetch failed')
    const lines = causeLines(stderr.mock.calls)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('fetch-error POST opencode.ai/zen/go/v1/responses bodyBytes=2')
    expect(lines[0]).toContain('causeCode=UND_ERR_SOCKET')
    expect(lines[0]).toContain('cause=other side closed')
    expect(lines.join('\n')).not.toContain('secret')
    expect(takeTransportCause()).toEqual({ code: 'UND_ERR_SOCKET', message: 'other side closed' })
    expect(takeTransportCause()).toBeUndefined()
  })

  it('falls back through plain and codeless rejections', async () => {
    const stub = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('down'), { code: 'ECONNRESET' }))
      .mockRejectedValueOnce(new Error('bare'))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    globalThis.fetch = stub
    installTransportCauseLogging()
    await expect(globalThis.fetch(new Request('https://gateway.test/a'))).rejects.toThrow('down')
    expect(takeTransportCause()).toEqual({ code: 'ECONNRESET', message: 'down' })
    await expect(globalThis.fetch('https://gateway.test/b')).rejects.toThrow('bare')
    expect(takeTransportCause()).toEqual({ message: 'bare' })
    await globalThis.fetch('https://gateway.test/c', { headers: { authorization: 'Bearer secret-token' } })
    const lines = causeLines(stderr.mock.calls)
    expect(lines.filter(line => line.includes('fetch-error'))).toHaveLength(2)
    expect(lines.filter(line => line.includes('fetch-ok'))).toHaveLength(1)
    expect(lines.join('\n')).not.toContain('secret-token')
  })

  it('expires stale causes instead of attributing them to later failures', async () => {
    const stub = vi.fn(async (): Promise<Response> => {
      throw undiciError('fetch failed', 'UND_ERR_FETCH', 'other side closed', 'UND_ERR_SOCKET')
    })
    globalThis.fetch = stub
    installTransportCauseLogging()
    await expect(globalThis.fetch('https://gateway.test/v1')).rejects.toThrow()
    expect(takeTransportCause(-1)).toBeUndefined()
    expect(takeTransportCause()).toBeUndefined()
  })

  it('correlates diagnostics-channel errors with their request', () => {
    installTransportCauseLogging()
    const request = { origin: 'https://opencode.ai', path: '/zen/go/v1/responses', method: 'POST' }
    channel('undici:request:create').publish({ request })
    channel('undici:request:error').publish({
      request,
      error: undiciError('fetch failed', 'UND_ERR_FETCH', 'other side closed', 'UND_ERR_SOCKET'),
    })
    const lines = causeLines(stderr.mock.calls)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('req-error POST opencode.ai/zen/go/v1/responses')
    expect(lines[0]).toContain('cause=other side closed')
    expect(takeTransportCause()).toEqual({ code: 'UND_ERR_SOCKET', message: 'other side closed' })
  })

  it('logs codeless diagnostics errors without a pending request', () => {
    installTransportCauseLogging()
    channel('undici:request:create').publish({})
    channel('undici:request:create').publish({ request: null })
    channel('undici:request:create').publish({ request: {} })
    channel('undici:request:error').publish({})
    channel('undici:request:error').publish(null)
    channel('undici:request:error').publish(undefined)
    channel('undici:client:connectError').publish({ error: new Error('refused') })
    channel('undici:client:connectError').publish({ error: { code: 'ECONNREFUSED' } })
    channel('undici:client:connectError').publish({
      error: undiciError('connect failed', 'UND_ERR_CONNECT', 'refused', 'ECONNREFUSED'),
    })
    channel('undici:request:close').publish({})
    channel('undici:request:close').publish(null)
    const lines = causeLines(stderr.mock.calls)
    expect(lines.some(line => line.includes('req-error ? unknown'))).toBe(true)
    expect(lines.some(line => line.includes('connect-error'))).toBe(true)
    expect(takeTransportCause()).toBeDefined()
  })

  it('drops pending state on close', () => {
    installTransportCauseLogging()
    const request = { origin: 'https://gateway.test', path: '/v1', method: 'GET' }
    channel('undici:request:create').publish({ request })
    channel('undici:request:close').publish({ request })
    channel('undici:request:error').publish({ request, error: new Error('late') })
    const lines = causeLines(stderr.mock.calls)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('unknown')
  })

  it('auto-installs only with the opt-in set', async () => {
    vi.stubEnv('DSH_LOG_UNDICI_CAUSE', '')
    vi.resetModules()
    const disabled = await import('../src/transport-cause.ts')
    expect(globalThis.__dshTransportCauseWrapped).not.toBe(true)
    disabled.uninstallTransportCauseLogging()

    vi.stubEnv('DSH_LOG_UNDICI_CAUSE', '1')
    vi.resetModules()
    const enabled = await import('../src/transport-cause.ts')
    expect(globalThis.__dshTransportCauseWrapped).toBe(true)
    enabled.uninstallTransportCauseLogging()
  })
})
