/**
 * Payload-degrade policy for gateway fast resets on large image bodies.
 *
 * A gateway that rejects an oversized request body on sight fails in
 * milliseconds, while ordinary network jitter fails later. Retrying the same
 * bytes cannot succeed, so a large, fast transport failure (or an explicit
 * 413/payload marker) degrades once: the oldest images become placeholders
 * and the smaller body is sent again. Each round at least halves the image
 * payload, and degradation stops after the configured rounds.
 *
 * @module dsh-llm-pi-ai/image-degrade
 */

/** Inputs for one payload-degrade decision after a failed attempt. */
export interface ImageDegradeDecision {
  /** Adapter finish code for the failure (`TRANSPORT`, `INVALID_REQUEST`, ...). */
  code: string
  /** Flattened failure message for 413/payload matching. */
  message: string
  /** Base64 image payload bytes actually sent on the failed attempt. */
  imageBytes: number
  /** Minimum payload that may degrade; smaller requests keep legacy retries. */
  degradeMinBytes: number
  /** Milliseconds from attempt start to the failure. */
  elapsedMs: number
  /** Window qualifying a transport failure as a gateway fast reset. */
  fastFailMs: number
  /** Degrade rounds already spent on this step. */
  degradedRounds: number
  /** Maximum degrade rounds for this step; zero disables degradation. */
  maxRounds: number
}

/**
 * Decide whether a failed image request should degrade and resend smaller.
 * @param decision - failure classification, payload size, timing, and budget.
 * @returns true only when all three gates pass: large payload, fast reset or
 * explicit size rejection, and remaining degrade budget.
 */
export function shouldDegradeImages(decision: ImageDegradeDecision): boolean {
  if (decision.maxRounds <= 0) return false
  if (decision.degradedRounds >= decision.maxRounds) return false
  if (decision.imageBytes < decision.degradeMinBytes) return false
  if (isPayloadRejection(decision.code, decision.message)) return true
  return decision.code === 'TRANSPORT' && decision.elapsedMs <= decision.fastFailMs
}

/**
 * Check for an explicit oversized-body rejection independent of timing.
 * @param code - adapter finish code for the failure.
 * @param message - flattened failure message.
 * @returns true for 413 and payload-too-large wordings.
 */
export function isPayloadRejection(code: string, message: string): boolean {
  if (code !== 'INVALID_REQUEST') return false
  return /\b413\b|payload too large|request body too large|failed to buffer the request body:\s*length limit exceeded/i.test(message)
}

/**
 * Halve the image payload bound for the next degrade retry.
 * @param imageBytes - base64 image payload bytes sent on the failed attempt.
 * @returns the next `maxRequestImageBytes` bound, at least one byte.
 */
export function nextDegradedImageBudget(imageBytes: number): number {
  return Math.max(1, Math.floor(imageBytes / 2))
}

/**
 * Format base64 bytes as megabytes with one decimal for operator diagnostics.
 * @param bytes - base64 image payload bytes.
 * @returns megabytes with one decimal, for example `5.3MB`.
 */
export function formatImageMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
