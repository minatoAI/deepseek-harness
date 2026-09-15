# Agent Note: truncate oversized session-title input instead of keeping fallback

Status: implemented

English | [中文](2026-09-14-session-title-input-truncation.zh.md)

## Problem

The shared `session-title-llm` helper measured the final JSON-framed title prompt against `maxInputBytes` and rejected the whole auxiliary request when it did not fit. A 1451-character Chinese first prompt framed to 4277 bytes against the shipped 4096-byte budget, so no `session/title-llm-request` was logged and the session kept only the deterministic leading-words fallback while the main conversation succeeded.

## Decision

Fit the selection into `maxInputBytes` before logging or dispatch in `packages/session/session-title-llm/src/index.ts`. The full selection is sent unchanged when it fits; otherwise a single message keeps its leading UTF-8-safe prefix, and several messages keep the first/last pair with the middle dropped, shrinking the longer prefix first. The logged `session/title-llm-request` carries the exact fitted text and seqs, so the model-visible input stays reconstructable from the log. A budget smaller than the empty framing still rejects.

## Alternatives considered

- **Raise `maxInputBytes` only.** That moves the failure to the next long CJK prompt and raises every title call's token cost; kept as a deployment knob, not the fix.
- **Keep rejecting oversized input.** The fallback is durable but long prompts never get an AI title except through manual refresh with a larger override; this was the reported defect.
- **Summarize-then-title with a second model call.** That adds a new failure mode and latency for every long session; prefix/head-tail fitting reuses the existing single auxiliary request.

## Verification

`packages/session/session-title-llm/tests/llm.spec.ts` pins both shapes: a single oversized CJK message dispatches its leading prefix within budget with unchanged seqs, and three oversized messages dispatch the first/last pair without the middle within budget. Adjacent `session-title`, `first-prompt`, and `all-prompts` provider suites still pass. The failing 4277-byte session input fits to 4094 bytes (1390 of 1451 chars, prefix-preserved) under the shipped 4096 budget.

## Consequences

- Long first prompts get AI titles from their leading prefix instead of permanent fallbacks; long multi-prompt sessions get titles from background plus latest update.
- Middle messages are invisible to the title model once input overflows; truncated prefixes carry no ellipsis marker.
- `maxInputBytes` is now a truncation budget, not a rejection threshold, except when even the empty framing does not fit.
