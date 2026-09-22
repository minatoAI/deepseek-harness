/**
 * Shared route, framing, timeout, assembly, and validation policy for
 * model-backed session-title providers.
 * @module @deepseek-ai/dsh-session-title-llm
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'dsh-session-title-llm': { kind: 'dsh-session-title-llm' } & ContextFormed
  }
}

import type { FinishReason, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { deadline, MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { deepFreeze } from '@deepseek-ai/dsh-util-values'
import type { SessionSeq } from '@deepseek-ai/dsh-session'
import {
  normalizeSessionTitle,
  truncateTitleUtf8,
  SessionTitleProviderId,
} from '@deepseek-ai/dsh-session-title'
import type {
  SessionTitleAutomaticMode,
  SessionTitleModelIdentity,
  SessionTitleProviderRequest,
  SessionTitleProviderResult,
  SessionTitleUserMessage,
} from '@deepseek-ai/dsh-session-title'

/** Exact model-visible request recorded before one auxiliary title dispatch. */
export interface SessionTitleLlmRequestEventData {
  /** Registered title-provider identity responsible for the request. */
  readonly titleProvider: SessionTitleProviderId
  /** Exact human `user/message` seqs represented in `messages`. */
  readonly messageSeqs: SessionSeq[]
  /** Exact auxiliary LLM route. */
  readonly route: SessionTitleModelIdentity
  /** Exact auxiliary system prompt. */
  readonly system: string
  /** Exact auxiliary message list. */
  readonly messages: Message[]
  /** Exact auxiliary output-token cap. */
  readonly maxTokens: number
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Log-only pre-dispatch record of one session-title model request. */
    'session/title-llm-request': SessionTitleLlmRequestEventData
  }
}

/** Capability-owned timeout reason code for auxiliary title requests. */
export const SESSION_TITLE_TIMEOUT_CODE = 'SESSION_TITLE_TIMEOUT'

/** Required deployment policy for one model-backed title plugin. */
export interface SessionTitleLlmConfig {
  /** Target word count for non-CJK titles. */
  readonly targetWords: number
  /** Target character count for Chinese, Japanese, or Korean titles. */
  readonly targetCjkCharacters: number
  /**
   * Truncation budget in UTF-8 bytes for the final JSON-framed user prompt.
   * Oversized input is truncated to fit (a single message keeps its leading
   * prefix; several messages keep the first and the last) instead of
   * rejecting; only a budget smaller than the empty framing still rejects.
   */
  readonly maxInputBytes: number
  /** Auxiliary generation output-token cap. */
  readonly maxOutputTokens: number
  /** End-to-end auxiliary request deadline in milliseconds. */
  readonly timeoutMs: number
  /** Optional explicit provider route; must be paired with `model`. */
  readonly provider?: string
  /** Optional explicit model id; must be paired with `provider`. */
  readonly model?: string
}

/** Validated immutable model-provider policy. */
export interface ResolvedSessionTitleLlmConfig extends SessionTitleLlmConfig {}

/** Shared Loader field schemas with no library defaults. */
export const SessionTitleLlmConfigFields = {
  targetWords: z.number().step(1).min(1).required(),
  targetCjkCharacters: z.number().step(1).min(1).required(),
  maxInputBytes: z.number().step(1).min(1).required(),
  maxOutputTokens: z.number().step(1).min(1).required(),
  timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).required(),
  provider: z.string(),
  model: z.string(),
}

/** Shared Loader schema with no library defaults. */
export const SessionTitleLlmConfigSchema: z<SessionTitleLlmConfig> = z.object(SessionTitleLlmConfigFields)

/** Complete configuration key set for direct construction validation. */
const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'targetWords',
  'targetCjkCharacters',
  'maxInputBytes',
  'maxOutputTokens',
  'timeoutMs',
  'provider',
  'model',
])

/** Validate one positive integer limit. */
function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`session-title-llm: ${name} must be a positive integer`)
  }
}

/**
 * Validate and detach required model-provider configuration.
 * @param config - untrusted plugin configuration.
 * @returns immutable policy with optional route absence preserved.
 */
export function resolveSessionTitleLlmConfig(
  config: SessionTitleLlmConfig,
): ResolvedSessionTitleLlmConfig {
  const candidate: unknown = config
  if (candidate === null || typeof candidate !== 'object') {
    throw new Error('session-title-llm: configuration is required')
  }
  const value = candidate as SessionTitleLlmConfig
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`session-title-llm: unknown config key "${key}"`)
  }
  assertPositiveInteger('targetWords', value.targetWords)
  assertPositiveInteger('targetCjkCharacters', value.targetCjkCharacters)
  assertPositiveInteger('maxInputBytes', value.maxInputBytes)
  assertPositiveInteger('maxOutputTokens', value.maxOutputTokens)
  assertPositiveInteger('timeoutMs', value.timeoutMs)
  if (value.timeoutMs > MAX_TIMER_DELAY_MS) {
    throw new Error(`session-title-llm: timeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`)
  }
  const hasProvider = value.provider !== undefined
  const hasModel = value.model !== undefined
  if (hasProvider !== hasModel) {
    throw new Error('session-title-llm: provider and model must be supplied together')
  }
  if (hasProvider
    && (typeof value.provider !== 'string' || value.provider.length === 0
      || typeof value.model !== 'string' || value.model.length === 0)) {
    throw new Error('session-title-llm: provider and model overrides must be non-empty strings')
  }
  return deepFreeze({ ...value })
}

/** Select the provider-owned message subset from one fixed service revision. */
export type SessionTitleLlmMessageSelector = (
  messages: readonly SessionTitleUserMessage[],
) => readonly SessionTitleUserMessage[]

/**
 * Register one model-backed provider through the shared configuration and call policy.
 * @param ctx - context exposing the title and LLM services.
 * @param config - untrusted required deployment policy.
 * @param id - stable plugin id recorded with generated titles.
 * @param automatic - provider-owned automatic generation cadence.
 * @param selectMessages - exact source-message selection for one revision.
 */
export function registerSessionTitleLlmProvider(
  ctx: Context,
  config: SessionTitleLlmConfig,
  id: string,
  automatic: SessionTitleAutomaticMode,
  selectMessages: SessionTitleLlmMessageSelector,
): void {
  const resolved = resolveSessionTitleLlmConfig(config)
  const titleProvider = SessionTitleProviderId(id)
  ctx.sessionTitle.register({
    id: titleProvider,
    automatic,
    async generate(request) {
      return generateSessionTitleWithLlm(ctx, resolved, request, selectMessages(request.messages), titleProvider)
    },
  })
}

/** Resolve the explicit pair or the exact route captured from `request/header`. */
function resolveRoute(
  config: ResolvedSessionTitleLlmConfig,
  request: SessionTitleProviderRequest,
): SessionTitleModelIdentity {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  if (request.route === undefined) {
    throw new Error('session-title-llm: no logged request route is available; configure provider and model together')
  }
  return request.route
}

/** Stable language-aware system instruction shared by both provider plugins. */
function systemPrompt(config: ResolvedSessionTitleLlmConfig): string {
  return [
    'Create a concise title for an AI coding-assistant session from the supplied human messages.',
    'Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.',
    'Use the language of the messages.',
    `Aim for about ${config.targetWords} words in non-CJK languages or ${config.targetCjkCharacters} CJK characters.`,
  ].join('\n')
}

/** Frame exact messages as JSON so user text cannot break structural delimiters. */
function frameMessages(messages: readonly SessionTitleUserMessage[]): string {
  return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`
}

/** Measure one framed prompt in UTF-8 bytes. */
function framedInputBytes(messages: readonly SessionTitleUserMessage[]): number {
  return Buffer.byteLength(frameMessages(messages), 'utf8')
}

/**
 * Truncate one text to a UTF-8 byte budget, keeping its leading prefix
 * without splitting a Unicode code point.
 * @param text - original message text.
 * @param maxBytes - non-negative raw-text byte budget.
 * @returns the longest leading code-point prefix within the budget.
 */
function truncateInputText(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return ''
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  return truncateTitleUtf8(text, Math.max(1, Math.floor(maxBytes)))
}

/**
 * Drop the last code point from one text to guarantee forward progress
 * while shrinking an oversized framing.
 * @param text - current truncated text.
 * @returns the text without its last code point.
 */
function dropLastCodePoint(text: string): string {
  if (text.length === 0) return ''
  return truncateInputText(text, Buffer.byteLength(text, 'utf8') - 1)
}

/**
 * Fit one message prefix into the framing budget.
 * @param message - the single selected message.
 * @param maxInputBytes - framing budget.
 * @returns the same seq with a fitting leading prefix.
 */
function fitSingleMessage(
  message: SessionTitleUserMessage,
  maxInputBytes: number,
): SessionTitleUserMessage {
  if (framedInputBytes([message]) <= maxInputBytes) return message
  if (framedInputBytes([{ seq: message.seq, text: '' }]) > maxInputBytes) {
    const inputBytes = framedInputBytes([message])
    throw new Error(
      `session-title-llm: input is ${inputBytes} bytes, exceeding maxInputBytes ${maxInputBytes} even after truncation`,
    )
  }
  let low = 0
  let high = Buffer.byteLength(message.text, 'utf8')
  let best = ''
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = truncateInputText(message.text, mid)
    if (framedInputBytes([{ seq: message.seq, text: candidate }]) <= maxInputBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  if (best.length === 0) {
    const inputBytes = framedInputBytes([message])
    throw new Error(
      `session-title-llm: input is ${inputBytes} bytes, exceeding maxInputBytes ${maxInputBytes} even after truncation`,
    )
  }
  return { seq: message.seq, text: best }
}

/**
 * Fit the first and the last messages into the framing budget, keeping both
 * prefixes so the title can recall the background and the latest update.
 * Middle messages are dropped once the full selection no longer fits.
 * @param first - oldest selected message.
 * @param last - newest selected message.
 * @param maxInputBytes - framing budget.
 * @returns the fitting first/last pair, possibly with truncated prefixes.
 */
function fitHeadTailMessages(
  first: SessionTitleUserMessage,
  last: SessionTitleUserMessage,
  maxInputBytes: number,
): SessionTitleUserMessage[] {
  const pair: SessionTitleUserMessage[] = [first, last]
  if (framedInputBytes(pair) <= maxInputBytes) return pair
  if (framedInputBytes([
    { seq: first.seq, text: '' },
    { seq: last.seq, text: '' },
  ]) > maxInputBytes) {
    const inputBytes = framedInputBytes(pair)
    throw new Error(
      `session-title-llm: input is ${inputBytes} bytes, exceeding maxInputBytes ${maxInputBytes} even after truncation`,
    )
  }
  let firstText = first.text
  let lastText = last.text
  while (framedInputBytes([
    { seq: first.seq, text: firstText },
    { seq: last.seq, text: lastText },
  ]) > maxInputBytes) {
    const firstBytes = Buffer.byteLength(firstText, 'utf8')
    const lastBytes = Buffer.byteLength(lastText, 'utf8')
    if (firstBytes === 0 && lastBytes === 0) {
      const inputBytes = framedInputBytes(pair)
      throw new Error(
        `session-title-llm: input is ${inputBytes} bytes, exceeding maxInputBytes ${maxInputBytes} even after truncation`,
      )
    }
    if (firstBytes >= lastBytes) {
      const halved = truncateInputText(firstText, Math.floor(firstBytes / 2))
      firstText = halved === firstText ? dropLastCodePoint(firstText) : halved
    } else {
      const halved = truncateInputText(lastText, Math.floor(lastBytes / 2))
      lastText = halved === lastText ? dropLastCodePoint(lastText) : halved
    }
  }
  return [
    { seq: first.seq, text: firstText },
    { seq: last.seq, text: lastText },
  ]
}

/**
 * Fit one provider selection into the framing budget.
 * @param selectedMessages - provider-selected subset in seq order.
 * @param maxInputBytes - framing budget.
 * @returns the fitting subset: unchanged when it fits, otherwise a single
 * leading prefix or the truncated first/last pair.
 */
function fitSelectedMessages(
  selectedMessages: readonly SessionTitleUserMessage[],
  maxInputBytes: number,
): SessionTitleUserMessage[] {
  if (framedInputBytes(selectedMessages) <= maxInputBytes) return [...selectedMessages]
  const first = selectedMessages[0]
  const last = selectedMessages[selectedMessages.length - 1]
  if (first === undefined || last === undefined) {
    throw new Error('session-title-llm: at least one source message is required')
  }
  if (selectedMessages.length === 1) return [fitSingleMessage(first, maxInputBytes)]
  if (first.seq === last.seq) return [fitSingleMessage(first, maxInputBytes)]
  return fitHeadTailMessages(first, last, maxInputBytes)
}

/** Translate terminal finish reasons into an auxiliary-call failure. */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'stop':
      return undefined
    case 'error':
    case 'aborted': {
      const error = new Error(finish.failure.message) as Error & { code?: string }
      error.code = finish.failure.code
      return error
    }
    case 'max-tokens':
      return new Error('session-title-llm: title output reached maxOutputTokens')
    case 'tool-calls':
      return new Error('session-title-llm: title model unexpectedly requested a tool')
    default:
      return new Error(`session-title-llm: unsupported finish reason "${String((finish as { kind?: unknown }).kind)}"`)
  }
}

/**
 * Generate one title through the shared auxiliary LLM call.
 * @param ctx - context exposing the registered LLM service.
 * @param config - validated model-provider policy.
 * @param request - service-owned session, route, message snapshot, and cancellation.
 * @param selectedMessages - provider-selected subset in seq order; oversized
 * input is fitted to `maxInputBytes` (single prefix, several head+tail) before
 * framing, logging, and attribution.
 * @param titleProvider - registered title-provider identity recorded with the request.
 * @returns normalized non-empty title, exact fitted source seqs, and used model route.
 */
export async function generateSessionTitleWithLlm(
  ctx: Context,
  config: ResolvedSessionTitleLlmConfig,
  request: SessionTitleProviderRequest,
  selectedMessages: readonly SessionTitleUserMessage[],
  titleProvider: SessionTitleProviderId,
): Promise<SessionTitleProviderResult> {
  request.signal.throwIfAborted()
  if (selectedMessages.length === 0) {
    throw new Error('session-title-llm: at least one source message is required')
  }
  const fittedMessages = fitSelectedMessages(selectedMessages, config.maxInputBytes)
  const framedInput = frameMessages(fittedMessages)
  const route = resolveRoute(config, request)
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: framedInput }],
    source: { kind: 'dsh-session-title-llm' },
  })]
  const system = systemPrompt(config)
  using callDeadline = deadline(request.signal, config.timeoutMs, SESSION_TITLE_TIMEOUT_CODE)
  const options: GenerateOptions = deepFreeze({
    provider: route.provider,
    model: route.model,
    messages,
    system,
    maxTokens: config.maxOutputTokens,
    sessionId: request.session.id,
    purpose: 'session-title',
    signal: callDeadline.signal,
  })
  request.session.append('session/title-llm-request', {
    titleProvider,
    messageSeqs: fittedMessages.map(message => message.seq),
    route,
    system,
    messages,
    maxTokens: config.maxOutputTokens,
  })
  callDeadline.signal.throwIfAborted()
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream(options)) {
    callDeadline.signal.throwIfAborted()
    assembler.push(chunk)
  }
  callDeadline.signal.throwIfAborted()
  const terminalError = finishError(assembler.finish)
  if (terminalError !== undefined) throw terminalError
  const blocks = assembler.blocks()
  if (blocks.some(block => block.type === 'tool-call')) {
    throw new Error('session-title-llm: title output must contain text only')
  }
  const text = blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join(' ')
  const title = normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER)
  if (title.length === 0) throw new Error('session-title-llm: title model produced no text')
  return {
    title,
    messageSeqs: fittedMessages.map(message => message.seq),
    model: route,
  }
}
