# Change Logs

English | [中文](README.zh.md)

This directory records the background and process of every change to this repository. See [AGENTS.md](AGENTS.md) for the standard.

## Records (newest first)

- **2026-09-17** — [Built-in Web Search assessment and disable](2026-09-17-builtin-web-search-assessment.md): a 519-session audit proves the failures came from a credential, not the plugin, and an upstream diff confirms the source is untouched; the official docs confirm the server-tool mechanism and its cost structure, with cache-miss input measured at 79.9% of the bill and structurally unoptimizable; a same-query comparison shows source quality below dsh-jina, so the whole `web` stack is disabled in the profile patch layer.
- **2026-09-16** — [Documentation gates restored: record reference format and generated artifacts](2026-09-16-doc-gate-compliance.md): nine records switch to commit subject lines, the standard drops its commit-identifier requirement, and the cordis and persistence artifacts are recomputed; doc-sync's six failures drop to one platform limitation.
- **2026-09-13** — [Session titles generate reliably on thinking models](2026-09-13-session-title-thinking.md): the title budget rises 64→256, pi-ai title requests disable thinking when the model offers an `off` level, and models without `off` keep their previous default.
- **2026-09-12** — [A teammate can be created with its own persona](2026-09-12-2025-teammate-persona.md): `spawn_teammate` gains `persona`, which exclusively overrides the inherited Lead persona; omitting it keeps the inherited one, and empty text is rejected before the name is claimed.
- **2026-09-12** — [A teammate's global tool set can be trimmed at creation](2026-09-12-teammate-tool-filter.md): `spawn_teammate` gains `tool_filter` (`allow`/`deny`); Team collaboration tools stay always visible, and an empty filter is rejected before the name is claimed.
- **2026-09-06** — [OpenCode routes carry x-opencode-session affinity automatically](2026-09-06-opencode-session-affinity-header.md): llm-pi-ai sends the loop session id on OpenCode routes with no configuration, and an explicit header takes precedence.
- **2026-09-04** — [Large image payloads degrade and retry when the gateway resets fast](2026-09-04-image-payload-fast-reset-degradation.md): `llm-pi-ai` halves the image budget each round and retries when a large payload is reset during fast transfer, and adds a redacted transport-reason log plus image stripping on the compression side.
- **2026-08-19** — [The level named by `reasoningEfforts.default` joins the model's offered levels](2026-08-19-reasoning-efforts-default-offer.md): `{ default: medium, high: high }` now offers both medium and high and defaults to medium, no longer requiring the default level to be restated as a level key.
- **2026-08-18** — [Tool argument errors carry their full ownership path](2026-08-18-tool-argument-diagnostic-paths.md): `defineTool()` uses the tool name as the runtime validation root path, so direct calls and Code Mode sub-dispatch report full argument paths such as `run_code.description` and `pwsh.description`.
- **2026-08-17** — [`reasoningEfforts.default` is accepted as a reserved selector key](2026-08-17-reasoning-efforts-default.md): `llm-pi-ai` treats `default` as a per-model default-level selector rather than an unknown level, so the whole settings section no longer fails to register and hide custom providers.
- **2026-08-14** — [Tool parameter schema validation and local `dsh plugin check`](2026-08-14-tool-schema-contract.md): `tools.register` validates the parameter schema at registration and names the offending tool, and a new `dsh plugin check` command validates a bundle locally, with a bilingual bundle development checklist alongside.
