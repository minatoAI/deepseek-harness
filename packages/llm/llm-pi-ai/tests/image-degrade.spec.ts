import { describe, expect, it } from 'vitest'
import {
  formatImageMegabytes,
  isPayloadRejection,
  nextDegradedImageBudget,
  shouldDegradeImages,
} from '../src/image-degrade.ts'
import type { ImageDegradeDecision } from '../src/image-degrade.ts'

const decision = (overrides: Partial<ImageDegradeDecision> = {}): ImageDegradeDecision => ({
  code: 'TRANSPORT',
  message: 'terminated',
  imageBytes: 5_324_800,
  degradeMinBytes: 2 * 1024 * 1024,
  elapsedMs: 33,
  fastFailMs: 3_000,
  degradedRounds: 0,
  maxRounds: 2,
  ...overrides,
})

describe('shouldDegradeImages', () => {
  it('degrades a large fast transport failure', () => {
    expect(shouldDegradeImages(decision())).toBe(true)
  })

  it('refuses without remaining rounds', () => {
    expect(shouldDegradeImages(decision({ maxRounds: 0 }))).toBe(false)
    expect(shouldDegradeImages(decision({ degradedRounds: 2 }))).toBe(false)
    expect(shouldDegradeImages(decision({ degradedRounds: 3 }))).toBe(false)
  })

  it('keeps small requests on the legacy retry path', () => {
    expect(shouldDegradeImages(decision({ imageBytes: 1024 }))).toBe(false)
    expect(shouldDegradeImages(decision({ imageBytes: 2 * 1024 * 1024 - 1 }))).toBe(false)
    expect(shouldDegradeImages(decision({ imageBytes: 2 * 1024 * 1024 }))).toBe(true)
  })

  it('degrades an explicit size rejection regardless of timing', () => {
    expect(shouldDegradeImages(decision({
      code: 'INVALID_REQUEST',
      message: 'HTTP 413: Payload Too Large',
      elapsedMs: 30_000,
    }))).toBe(true)
  })

  it('refuses slow transports and unrelated codes', () => {
    expect(shouldDegradeImages(decision({ elapsedMs: 3_001 }))).toBe(false)
    expect(shouldDegradeImages(decision({ elapsedMs: 3_000 }))).toBe(true)
    expect(shouldDegradeImages(decision({ code: 'SERVER', message: 'HTTP 500: down' }))).toBe(false)
    expect(shouldDegradeImages(decision({ code: 'PI_AI_ERROR', message: 'mystery' }))).toBe(false)
  })
})

describe('isPayloadRejection', () => {
  it('matches explicit oversized-body rejections', () => {
    expect(isPayloadRejection('INVALID_REQUEST', 'HTTP 413: Payload Too Large')).toBe(true)
    expect(isPayloadRejection('INVALID_REQUEST', 'request body too large')).toBe(true)
    expect(isPayloadRejection('INVALID_REQUEST', 'Failed to buffer the request body: length limit exceeded')).toBe(true)
  })

  it('ignores other codes and nearby wordings', () => {
    expect(isPayloadRejection('TRANSPORT', 'HTTP 413: Payload Too Large')).toBe(false)
    expect(isPayloadRejection('INVALID_REQUEST', 'HTTP 400: bad input')).toBe(false)
    expect(isPayloadRejection('INVALID_REQUEST', 'vector length limit exceeded')).toBe(false)
  })
})

describe('nextDegradedImageBudget', () => {
  it('at least halves the failed payload', () => {
    expect(nextDegradedImageBudget(5_324_800)).toBe(2_662_400)
    expect(nextDegradedImageBudget(3)).toBe(1)
    expect(nextDegradedImageBudget(1)).toBe(1)
    expect(nextDegradedImageBudget(0)).toBe(1)
  })
})

describe('formatImageMegabytes', () => {
  it('formats one-decimal megabytes for operator diagnostics', () => {
    expect(formatImageMegabytes(5_324_800)).toBe('5.1MB')
    expect(formatImageMegabytes(3 * 1024 * 1024)).toBe('3.0MB')
    expect(formatImageMegabytes(0)).toBe('0.0MB')
  })
})
