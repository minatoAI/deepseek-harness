# Agent Note: size the base session-title budget for thinking models

Status: implemented

English | [中文](2026-09-13-session-title-budget-for-thinking-models.zh.md)

## Problem

The shipped `dsh-base` composition capped the auxiliary session-title request at `maxOutputTokens: 64`. That budget fits the DeepSeek route because the DeepSeek adapter disables thinking for `purpose: 'session-title'`, so the whole budget serves the one-line title. Every other adapter owns its purpose-specific behavior and keeps its profile's default reasoning level for the title call, which carries no explicit `reasoningEffort`. On a thinking model the reasoning trace consumes the 64-token budget before any title text is emitted, the shared helper rejects the result (`max-tokens` finish or reasoning-only output with no text), and the session keeps only its deterministic fallback title while the main conversation succeeds.

## Decision

Two changes ship together. The `session-title-llm` row in `packages/bundle/base/cordis.patch.yml` sets `maxOutputTokens: 256`, leaving room for a reasoning trace plus the title where thinking cannot be disabled. The pi-ai adapter (`packages/llm/llm-pi-ai/src/adapter.ts`) resolves `purpose: 'session-title'` requests to no thinking when the model offers an off level — mirroring the DeepSeek adapter's thinking-disabled title behavior within pi-ai's vocabulary — while models without an off level keep the profile default, so no route titles worse than before. The six headless-profile expected snapshots now record `"maxTokens": 256` on their `session/title-llm-request` events, and the mock-server title-request sniffers in the headless and web specs key on 256.

## Alternatives considered

- **Budget increase only, without touching the adapter.** That leaves thinking models spending most of the larger budget on reasoning before emitting the title; kept as the complementary half, not the whole fix.
- **Give the title call an independent non-thinking route via paired `provider`/`model` overrides.** That works per deployment today and stays available, but it does not repair the shipped default every thinking-model deployment inherits.
- **Force `off` unconditionally for title calls, even where the model does not offer it.** That would turn currently working titles on always-thinking routes into permanent fallbacks; the shipped rule degrades to the profile default instead.
- **Keep 64 and document the failure.** The fallback title is durable but the reported symptom — every session titled by its first words with no recovery path except manual rename — is the defect being fixed.

## Verification

The headless-profile expected snapshots pin the dispatched `maxTokens` on the logged `session/title-llm-request` event; they fail if the composition regresses the budget. The `session-title-llm` unit suite pins the rejection behavior that made the small budget fatal: `max-tokens` finishes and reasoning-only output without text are both rejected before acceptance. The pi-ai adapter suite pins both sides of the new rule: a title request on a model offering off sends thinking-disabled with no reasoning effort, and a title request on a model without off keeps the profile default.

## Consequences

- Thinking-model deployments get provider-generated titles instead of permanent fallback titles, at roughly four times the previous title-call output cost and with no thinking trace spent.
- Thinking-disabled routes pay the larger cap only when the model actually emits more tokens; the title text itself stays bounded by the existing word and byte targets.
- Routes whose models offer no off level behave exactly as before; such routes should use the explicit `provider`/`model` title override or a further budget increase.
