/**
 * Register-time parameters contract: `normalizeRegisteredParameters` must
 * pass a complete JSON Schema through byte-for-byte, convert the
 * defineTool-style property-table form with a warning, and reject anything
 * else with a tool-named error — so a bad schema surfaces at registration,
 * not at the first model call.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, {
  defineTool,
  normalizeRegisteredParameters,
  type ToolDefinition,
} from '@deepseek-ai/dsh-tools'
import { collectToolCatalog } from '../../../../scripts/gen-tool-catalog.ts'

/** One complete JSON Schema in the shape the model API requires. */
const FULL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: 'Search query.' },
    num: { type: 'number', description: 'Number of results. Default: 5.' },
  },
  required: ['query'],
}

describe('normalizeRegisteredParameters', () => {
  it('passes a complete JSON Schema through byte-for-byte (zero rewrite)', () => {
    expect(normalizeRegisteredParameters('jina_classify', FULL_SCHEMA)).toBe(FULL_SCHEMA)
  })

  it('converts a defineTool-style property table into a full JSON Schema', () => {
    const table = { q: { type: 'string', required: true }, n: { type: 'number' } }
    const converted = normalizeRegisteredParameters('jina_classify', table)
    // Aligned with the real converter output: an open implicit object root.
    expect(converted).toEqual({
      type: 'object',
      properties: { q: { type: 'string' }, n: { type: 'number' } },
      required: ['q'],
    })
    expect(converted).not.toBe(table)
  })

  it('rejects a non-object schema root with a tool-named error', () => {
    expect(() => normalizeRegisteredParameters('jina_classify', { type: 'array' })).toThrow(/jina_classify/)
    expect(() => normalizeRegisteredParameters('jina_classify', { type: 'string' })).toThrow(/jina_classify/)
  })

  it('rejects required names absent from properties with a tool-named error', () => {
    expect(() => normalizeRegisteredParameters('jina_read', {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['missing'],
    })).toThrow(/jina_read/)
    expect(() => normalizeRegisteredParameters('jina_read', {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['missing'],
    })).toThrow(/missing/)
    expect(() => normalizeRegisteredParameters('jina_read', {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url', 42],
    })).toThrow(/jina_read/)
  })

  it('rejects a property table containing non-schema values instead of mis-converting', () => {
    expect(() => normalizeRegisteredParameters('jina_classify', { q: { type: 'string' }, oops: 42 }))
      .toThrow(/jina_classify/)
    expect(() => normalizeRegisteredParameters('jina_classify', { q: { type: 'string' }, oops: [1] }))
      .toThrow(/jina_classify/)
    expect(() => normalizeRegisteredParameters('jina_classify', { q: { type: 'string' }, oops: { noType: true } }))
      .toThrow(/jina_classify/)
  })

  it('passes every shipped built-in tool schema through byte-for-byte (compat snapshot)', async () => {
    const catalog = await collectToolCatalog()
    expect(catalog.length).toBeGreaterThan(0)
    for (const entry of catalog) {
      for (const schema of entry.schemas) {
        const parameters = schema.parameters as Record<string, unknown>
        expect(
          normalizeRegisteredParameters(schema.name, parameters),
          `normalization must not rewrite shipped tool ${schema.name}`,
        ).toBe(parameters)
      }
    }
  })

  it('registers a property-table tool with the converted schema and warns once', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    // Simulate a bundle that passes a defineTool-style property table to the
    // raw register() (the historical jina plugin shape): it must register
    // with the converted full JSON Schema, never a silent type:null wire bug.
    const legacy: ToolDefinition = {
      ...defineTool({
        name: 'legacy_search',
        description: 'legacy property-table tool',
        parameters: { q: { type: 'string', required: true } },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute() {
          return 'ok'
        },
      }),
      parameters: { q: { type: 'string', required: true } },
    }
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    ctx.tools.register(legacy)
    expect(ctx.tools.schemas()).toEqual([{
      name: 'legacy_search',
      description: 'legacy property-table tool',
      parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
    }])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toMatch(/legacy_search/)
  })
})
