# Agent Note: Degrade image payloads after a fast gateway reset

Status: implemented

English | [中文](2026-09-04-image-payload-fast-reset-degradation.zh.md)

## Problem

A request carrying six ~1 MiB images (~5.3 MiB on the wire) to the opencode-go gateway is reset in ~33 ms with `UND_ERR_SOCKET / other side closed`, and five identical retries fail the same way: retrying the exact bytes that the gateway refused to receive cannot succeed. Two gaps in the harness made this unrecoverable. First, pi-ai flattens the fetch rejection to a bare message before the adapter sees it, so the socket cause never reaches error classification ([transport truncation note](2026-07-22-pi-ai-transport-truncation-classification.md)). Second, the adapter had exactly one image policy — the `maxRequestImageBytes` bound with oldest-first offload — and no behavior between "send everything" and "terminal failure". A separate re-send risk rode along: the compaction summarizer replayed history verbatim, so a poisoned image-heavy history re-sent its own base64 bytes on the rescue request.

## Decision

The adapter now degrades large image payloads after a fast reset instead of repeating them, under four validated profile fields:

- `imagePayloadWarnBytes` (default 3 MiB) warns once per request through `onReplayDegrade` when the prepared base64 payload reaches the bound; the request itself is not blocked.
- `imagePayloadDegradeMinBytes` (default 2 MiB) is the payload floor for degradation. Smaller payloads keep the legacy path, so ordinary transport failures never shrink a request.
- `imageDegradeFastFailMs` (default 3000) is the window that marks a reset as body-size. An explicit 413/payload-too-large rejection degrades regardless of timing; a `TRANSPORT` failure degrades only when it lands inside this window and before any content streams.
- `maxImageDegradeRounds` (default 2) caps the halve-and-retry loop. Each round halves the `maxRequestImageBytes` bound (oldest images offload first via the existing deterministic projection), rebuilds the context, and retries; `0` restores the legacy behavior.

The socket cause is captured at the harness's own `fetch` boundary (`src/transport-cause.ts`): a redacted wrapper plus `node:diagnostics_channel` observation keeps method, host, path, sizes, timing, and truncated codes/messages, and hands the cause to `classifyPiAiError`, which now prefers the cause over flattened text. Logging stays installed only with `DSH_LOG_UNDICI_CAUSE=1` (or an explicit install call); headers, bodies, queries, and credentials never reach the log. This partially resolves the `XXX(pi-ai upstream)` in the transport truncation note: cause capture is now possible without pi-ai forwarding the `Error`, and text matching remains as the fallback for cases the observer misses. That note stays active for its fallback coverage.

The compaction summarizer sends `projectImagesForTextModel` placeholders instead of image blocks, so the rescue request never carries image bytes. This is a stateless projection, not a session event or format change.

`TRANSPORT` stays retryable, so an exhausted degrade loop still returns to the profile `retryPolicy`, which restarts from the full payload — worst case `maxRetries × (1 + maxImageDegradeRounds)` wire attempts.

## Alternatives considered

**Only raise or lower the static `maxRequestImageBytes` bound.** Rejected: any fixed bound either still exceeds a gateway cap that is smaller than assumed, or permanently degrades every large request even when the gateway would accept it. The failure is dynamic (this gateway, this size, right now); the response is dynamic too.

**Rely on outer retries with backoff.** Rejected: backoff does not change the bytes, and the observed failure refails five times identically. Outer retry remains as the backstop, not the fix.

**Record degradation as a session event.** Rejected: the degrade loop is a request-local projection choice fully reconstructable from the request and the profile; a new event would force a format bump for no model-visible gain, violating the stateless-strip decision.

**Strip images only when the summarizer route is text-only.** Rejected: the summarizer request never benefits from image bytes (it condenses text), and conditional stripping would reintroduce the poisoning path on exactly the routes most likely to be image-capable.

## Consequences

Large-image requests that a gateway resets on receipt now shrink and retry in-loop instead of failing after identical retries; the warn line gives deployments a signal to lower their configured bound before users notice. The cost is a per-attempt loop in the adapter stream path and four more profile fields to understand. Outer retry can still multiply degrade rounds on a persistently failing gateway, but the product is bounded and documented in the package README.

## Testing

`packages/llm/llm-pi-ai` and `packages/compaction/compaction-basic` hold 469 passing tests with zero uncovered lines in either package (per-file 100% gate). A mock server that destroys the socket replays the observed `other side closed` reset and the retry succeeds with half the images; an explicit 413 degrades regardless of timing; small payloads, zero rounds, and post-content failures keep the legacy path. The host-side undici hook independently logged the reset→degrade→200 chain during the test run.

## Related

- [Classify pi-ai transport truncations from flattened message text](2026-07-22-pi-ai-transport-truncation-classification.md) — partially superseded on cause capture (now observed at the harness fetch boundary); its text-matching fallback stays active and this note does not archive it.
