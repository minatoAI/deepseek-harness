# Agent Note: Automatic x-opencode-session affinity on OpenCode routes

Status: implemented

English | [中文](2026-09-06-opencode-session-affinity-header.zh.md)

## Problem

OpenCode Go managed inference requires a stable per-conversation x-opencode-session header for routing and optimization, and requests without it error from 09/05. All recent harness versions show near-zero header presence, so OpenCode Go users break unless the harness sends the header by default. The stable value already exists as the loop-stamped GenerateOptions.sessionId (Branded SessionId in packages/llm/llm/src/types.ts), which pi-ai already receives as sessionId and the DeepSeek adapter already maps to x-deepseek-harness-session-id; only the OpenCode-named header is missing on llm-pi-ai routes.

## Decision

PiAiAdapter sends x-opencode-session automatically on OpenCode-serving routes: route keys opencode and opencode-go, plus any hand-declared route whose baseURL contains opencode.ai, carry the loop session id as the header value. An explicit deployment header of the same name wins case-insensitively, Harness attribution still wins over both, requests without a session id omit the header, and model-discovery probes never send it because discovery has no conversation. The rule lives in packages/llm/llm-pi-ai/src/adapter.ts (OPENCODE_SESSION_HEADER, needsOpencodeSession, extended requestHeaders) and is re-exported from packages/llm/llm-pi-ai/src/index.ts; behavior is documented under Send OpenCode session affinity in packages/llm/llm-pi-ai/README.md.

## Alternatives considered

- Templated header value such as x-opencode-session: dsh-session-id substituted per request. Rejected: it asks about 25k orgs to edit settings.yaml before 09/05, a typo silently sends the literal string, it mixes the deployment plane with the request plane, and it needs validation twice (config time plus post-substitution Fetch check).
- Generic extraHeaders config without automation. Rejected for the same rollout reason: the header is an external protocol constant with a known source value, so making every deployment hand-wire it trades a one-line adapter rule for thousands of manual edits.
- Send x-opencode-session on every provider route. Rejected: it correlates conversations at providers that never asked for the OpenCode contract; scope stays on routes that serve managed OpenCode inference.

## Consequences

OpenCode Go calls carry stable per-conversation routing without configuration, explicit deployment headers keep working, non-OpenCode routes and discovery traffic are unchanged, and no header values enter logs because transport-cause never records headers. Follow-ups asking for per-request header templating should cite this note and explain why a new protocol constant does not fit the automatic rule.

## Testing

packages/llm/llm-pi-ai/tests/adapter.spec.ts pins the behavior through the mock server: automatic value from session id, omission without session id, explicit-header precedence, absence on non-OpenCode routes, and route matching by key or managed-endpoint address; the full adapter spec passes (65 tests).
