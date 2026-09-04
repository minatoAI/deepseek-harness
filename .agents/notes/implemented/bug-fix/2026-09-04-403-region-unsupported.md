# Agent Note: Split 403 region blocks from credential failures

Status: implemented

English | [中文](2026-09-04-403-region-unsupported.zh.md)

## Problem

Session 7c38242b fails at seq 750-752 with `OpenAI API error (403) type RegionError: This model is not available in your country` mapped to `AUTH`. The same key, provider, and model succeed for 44 steps with 112773 totalTokens at step 44, step 45 usage is all zero after a ~54s gap, so the LLM request itself fails. The mapping chain maps 401 or 403 to `AUTH` in `httpErrorCode`, maps 401 or 403 text to `AUTH` in `classifyPiAiError`, blanks `AUTH` in `displayFailure`, and renders `AUTH` as API key invalid in `MessageItem`. The session log keeps the provider diagnostic while the GUI reports an invalid key for a region block.

## Decision

`@deepseek-ai/dsh-llm` owns `REGION_UNSUPPORTED_CODE` (`REGION_UNSUPPORTED`) and `isRegionUnsupportedError`, a case-insensitive fingerprint over `RegionError`, `not available in your country`, `not available in region`, `country`, and `region`. Callers require HTTP 403 alongside the fingerprint so bare wording never reclassifies another status. `httpErrorCode` keeps pure 401 as `AUTH`, maps 403 with the fingerprint to `REGION_UNSUPPORTED`, and keeps pure 403 as `AUTH`. `DeepSeekFilesError` applies the same split on its joined provider detail. `classifyPiAiError` checks 403 plus the fingerprint before the generic 401-or-403 rule, leaving `QUOTA` and `RATE_LIMIT` order unchanged. Model discovery keeps `DISCOVERY_FAILED` and hints 401 with the key while hinting 403 with key or region availability. Both `displayFailure` copies keep blanking `AUTH` and preserve the provider message for `REGION_UNSUPPORTED`, which carries no credential material. `MessageItem` and `TrajectoryTable` render `REGION_UNSUPPORTED` through `message.failure.region` and `details.failure.region`: the model is unavailable in the current region (403), the key is valid, check egress region or VPN, retry later or switch model or provider, see the session log. The session log format is unchanged. `REGION_UNSUPPORTED` stays outside the default retryable set alongside `AUTH`.

## Alternatives considered

**Keep mapping every 403 to `AUTH`.** Rejected: the fix for a region block (egress, VPN, model, provider) differs from the fix for a bad key, and the current text sends region-blocked users to rotate a valid key.

**Match `RegionError` without requiring 403.** Rejected: a bare word match reclassifies unrelated statuses on coincidental wording; the observed provider failure always carries 403, so the status requirement keeps the split conservative and pure 403 stays `AUTH`.

**Blank region messages like `AUTH`.** Rejected: region diagnostics carry no credential material, and the trajectory inspector needs the provider detail while chat renders the locale guidance.

**Retry region blocks by default.** Rejected: the same route from the same region fails identically, so bounded retries only add latency and billing; `always` mode still retries when a deployment explicitly selects it.

## Consequences

Region blocks render key-valid guidance with the `REGION_UNSUPPORTED` code in chat and trajectory while pure 401 and non-region 403 keep the invalid-key text and existing snapshots. Discovery 403 points at key or region instead of key alone. Default retries ignore region blocks, so a blocked turn ends fast instead of burning the retry budget.

## Testing

`dsh-llm` pins the fingerprint true and false cases. `dsh-llm-deepseek` pins 403 region versus pure 403 and 401 in `httpErrorCode` and `DeepSeekFilesError`. `dsh-llm-pi-ai` pins the 403 `RegionError` text, the pure 403 fallback, and the 403 discovery hint through convert, adapter, and discovery specs. `dsh-llm-retry` pins `REGION_UNSUPPORTED` outside defaults and delegated without a timer. Chat and trajectory pin preserved region messages, locale rendering distinct from auth, and table localization. Web pins `error-region.expected.md` beside `error-auth.expected.md` and session pins `error-region-finish` beside `error-finish`.
