/**
 * Redacted undici transport-cause observer for pi-ai requests.
 *
 * pi-ai flattens the fetch rejection to a bare message before the adapter sees
 * it, so the actionable socket detail (`other side closed`) never reaches the
 * error channel. This module captures that detail at the `fetch` boundary and
 * in `node:diagnostics_channel`, keeping only method, host, path, sizes,
 * timing, and truncated codes/messages. It never records headers, bodies,
 * queries, or credentials, and it stays uninstalled unless
 * `DSH_LOG_UNDICI_CAUSE=1` (or an explicit install call) enables it.
 *
 * @module dsh-llm-pi-ai/transport-cause
 */

import diagnostics from 'node:diagnostics_channel'

declare global {
  /**
   * Re-entrancy marker so this observer and the host-side debugging hook
   * compose instead of replacing each other.
   */
  var __dshTransportCauseWrapped: boolean | undefined
}

/** Minimal cause carried alongside a flattened pi-ai error message. */
export interface TransportErrorCause {
  /** Undici or system error code, truncated to 40 characters. */
  code?: string
  /** Truncated error/cause message, never containing headers or bodies. */
  message?: string
}

const MAX_CODE_CHARS = 40
const MAX_MESSAGE_CHARS = 200
const MAX_PATH_CHARS = 120
const CAUSE_TTL_MS = 10_000

interface PendingRequest {
  /** Monotonic start for elapsed timing. */
  t0: number
  /** Redacted host for diagnostics-channel correlation. */
  hostPath: string
  /** HTTP method for diagnostics-channel correlation. */
  method: string
}

const pending = new Map<unknown, PendingRequest>()
let installed = false
let lastCause: { cause: TransportErrorCause; at: number } | undefined
let originalFetch: typeof globalThis.fetch | undefined

function truncate(value: string, max: number): string {
  return value.slice(0, max)
}

/**
 * Read a text field that is only meaningful as a string.
 * @param value - raw field from an error, cause, or request envelope.
 * @returns the text, or empty when the field carries none.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Reduce a URL to host plus pathname, dropping credentials, query, and hash.
 * @param value - absolute or relative URL value observed at the boundary.
 * @returns the redacted host and truncated pathname.
 */
export function redactTransportUrl(value: unknown): { host: string; path: string } {
  try {
    const parsed = new URL(String(value))
    return { host: parsed.host.slice(0, 80), path: parsed.pathname.slice(0, MAX_PATH_CHARS) }
  } catch {
    return { host: '', path: String(value).slice(0, MAX_PATH_CHARS) }
  }
}

/**
 * Summarize an undici rejection without touching headers or bodies.
 * @param error - rejection observed at the fetch or diagnostics boundary.
 * @returns truncated codes and single-line messages.
 */
export function summarizeTransportError(error: unknown): { code: string; message: string; causeCode: string; causeMessage: string } {
  const withCause = error as {
    code?: unknown
    message?: unknown
    cause?: { code?: unknown; message?: unknown } | null
  } | null
  const code = truncate(textOf(withCause?.code) || textOf(withCause?.cause?.code), MAX_CODE_CHARS)
  const message = truncate(
    (textOf(withCause?.message) || textOf(withCause?.cause?.message) || textOf(error)).replace(/\s+/g, ' '),
    MAX_MESSAGE_CHARS,
  )
  const cause = withCause?.cause
  const causeCode = truncate(
    textOf(cause !== null && typeof cause === 'object' ? cause.code : undefined),
    MAX_CODE_CHARS,
  )
  const causeMessage = cause === null || cause === undefined
    ? ''
    : truncate((textOf(cause.message) || textOf(cause)).replace(/\s+/g, ' '), MAX_MESSAGE_CHARS)
  return { code, message, causeCode, causeMessage }
}

function emit(line: string): void {
  try {
    process.stderr.write(`[dsh-undici-cause] ${line}\n`)
  } catch {
    // Logging must never break the request it observes.
  }
}

function recordCause(cause: TransportErrorCause): void {
  lastCause = { cause, at: Date.now() }
}

/**
 * Prefer the socket `cause` code for later classification: undici surfaces a
 * generic top-level code while the actionable detail rides on `cause`.
 * @param summary - redacted top-level and cause codes and messages.
 * @returns the cause to hand to error classification.
 */
function preferCause(summary: { code: string; message: string; causeCode: string; causeMessage: string }): TransportErrorCause {
  return {
    ...summary.causeCode.length > 0
      ? { code: summary.causeCode }
      : summary.code.length > 0 ? { code: summary.code } : {},
    message: summary.causeMessage || summary.message,
  }
}

/**
 * Take the most recent transport cause for error enrichment.
 * @param maxAgeMs - maximum age of an accepted record; older records read as absent.
 * @returns the recent cause, or undefined when none was captured recently.
 */
export function takeTransportCause(maxAgeMs = CAUSE_TTL_MS): TransportErrorCause | undefined {
  if (lastCause === undefined) return undefined
  if (Date.now() - lastCause.at > maxAgeMs) {
    lastCause = undefined
    return undefined
  }
  const cause = lastCause.cause
  lastCause = undefined
  return cause
}

/**
 * Measure a fetch body without touching its bytes.
 * @param body - fetch init body.
 * @returns string byte length, view byte length, or zero for other bodies.
 */
function bodyLengthOf(body: unknown): number {
  if (typeof body === 'string') return Buffer.byteLength(body)
  if (body instanceof Uint8Array) return body.byteLength
  return 0
}

function requestHostPath(origin: unknown, path: unknown): string {
  try {
    const parsed = new URL(textOf(origin) + textOf(path))
    return `${parsed.host}${parsed.pathname.slice(0, MAX_PATH_CHARS)}`
  } catch {
    return `${textOf(origin).slice(0, 80)}${textOf(path).slice(0, 80)}`
  }
}

function onRequestCreate(message: unknown): void {
  const request = (message as {
    request?: { origin?: unknown; path?: unknown; method?: unknown } | null
  } | null)?.request
  if (request === null || request === undefined) return
  pending.set(request, {
    t0: Date.now(),
    hostPath: requestHostPath(request.origin, request.path),
    method: (textOf(request.method) || 'GET').slice(0, 10),
  })
}

function onRequestError(message: unknown): void {
  const envelope = message as { request?: unknown; error?: unknown } | null
  const info = pending.get(envelope?.request) ?? { t0: Date.now(), hostPath: 'unknown', method: '?' }
  const summary = summarizeTransportError(envelope?.error)
  recordCause(preferCause(summary))
  emit(`req-error ${info.method} ${info.hostPath} dt=${Date.now() - info.t0}ms code=${summary.code} msg=${summary.message}${summary.causeCode.length > 0 ? ` causeCode=${summary.causeCode}` : ''}${summary.causeMessage.length > 0 ? ` cause=${summary.causeMessage}` : ''}`)
  const failedRequest = envelope?.request
  if (failedRequest !== undefined) pending.delete(failedRequest)
}

function onConnectError(message: unknown): void {
  const summary = summarizeTransportError((message as { error?: unknown } | null)?.error)
  recordCause(preferCause(summary))
  emit(`connect-error code=${summary.code} msg=${summary.message}${summary.causeCode.length > 0 ? ` causeCode=${summary.causeCode}` : ''}`)
}

function onRequestClose(message: unknown): void {
  const request = (message as { request?: unknown } | null)?.request
  if (request === undefined || request === null) return
  pending.delete(request)
}

/**
 * Install the redacted fetch wrapper and diagnostics subscriptions.
 * Idempotent: repeated installs keep the first wrapper and subscriptions.
 */
export function installTransportCauseLogging(): void {
  if (installed) return
  installed = true
  diagnostics.subscribe('undici:request:create', onRequestCreate)
  diagnostics.subscribe('undici:request:error', onRequestError)
  diagnostics.subscribe('undici:client:connectError', onConnectError)
  diagnostics.subscribe('undici:request:close', onRequestClose)
  if (globalThis.__dshTransportCauseWrapped !== true) {
    const delegate = globalThis.fetch
    originalFetch = delegate
    globalThis.__dshTransportCauseWrapped = true
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const method = (init?.method ?? 'GET').slice(0, 10)
      const rawInput = typeof input === 'string'
        ? input
        : input instanceof URL ? input.href : textOf(input.url)
      const redacted = redactTransportUrl(rawInput)
      const host = redacted.host
      const path = redacted.path
      const bodyBytes = bodyLengthOf((init as { body?: unknown } | undefined)?.body)
      const t0 = Date.now()
      try {
        const response = await delegate(input, init)
        emit(`fetch-ok ${method} ${host}${path} bodyBytes=${bodyBytes} status=${response.status} dt=${Date.now() - t0}ms`)
        return response
      } catch (error: unknown) {
        const summary = summarizeTransportError(error)
        recordCause(preferCause(summary))
        emit(`fetch-error ${method} ${host}${path} bodyBytes=${bodyBytes} dt=${Date.now() - t0}ms code=${summary.code} msg=${summary.message}${summary.causeCode.length > 0 ? ` causeCode=${summary.causeCode}` : ''}${summary.causeMessage.length > 0 ? ` cause=${summary.causeMessage}` : ''}`)
        throw error
      }
    })
  }
}

/**
 * Remove the fetch wrapper and diagnostics subscriptions. Test-only teardown:
 * production leaves the observer installed for the process lifetime.
 */
export function uninstallTransportCauseLogging(): void {
  if (!installed) return
  installed = false
  diagnostics.unsubscribe('undici:request:create', onRequestCreate)
  diagnostics.unsubscribe('undici:request:error', onRequestError)
  diagnostics.unsubscribe('undici:client:connectError', onConnectError)
  diagnostics.unsubscribe('undici:request:close', onRequestClose)
  if (originalFetch !== undefined) {
    globalThis.fetch = originalFetch
    originalFetch = undefined
    globalThis.__dshTransportCauseWrapped = false
  }
  pending.clear()
  lastCause = undefined
}

if (process.env['DSH_LOG_UNDICI_CAUSE'] === '1') installTransportCauseLogging()
