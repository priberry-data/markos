import { describe, expect, it } from 'vitest'
import * as S from '@/lib/engine/schemas'
import { toProviderSchema } from '@/lib/llm/schema'

const schemas = Object.entries(S).filter(([name]) => name.endsWith('Schema')) as [string, Parameters<typeof toProviderSchema>[0]][]

describe('agent schemas', () => {
  it('keeps a field named like a keyword (regression: NOVA\'s "format" was deleted)', () => {
    const json = toProviderSchema(S.ContentPlatformSchema) as { properties: { pieces: { items: { properties: Record<string, unknown>; required: string[] } } } }
    const piece = json.properties.pieces.items
    expect(piece.properties.format).toBeDefined()
    for (const field of piece.required) expect(piece.properties[field]).toBeDefined()
  })

  it('covers every agent', () => {
    expect(schemas.map(([n]) => n).sort()).toEqual([
      'AdsSchema', 'AgendaSchema', 'AgentReplySchema', 'ContentPlatformSchema', 'CreativeSchema', 'CustomerDraftSchema', 'CustomerSynthesisSchema',
      'DataFindingsSchema', 'DataPlanSchema', 'DirectiveSchema', 'DistributionSchema', 'ExecReportSchema', 'GoalsDraftSchema', 'IntakeSchema', 'InvestorSchema', 'MeetingRequestSchema',
      'MeetingTurnSchema', 'MinutesSchema', 'MorningBriefSchema', 'PRSchema', 'ProspectsSchema',
      'ResearchSchema', 'ReviewNotesSchema', 'RoomRespondersSchema', 'RoutePreviewSchema', 'SearchSchema', 'StrategySchema', 'TaskResultSchema', 'TeammateAnswerSchema', 'WeeklyReviewSchema',
    ])
  })

  it.each(schemas)('%s converts to a provider-safe JSON Schema', (_name, schema) => {
    const json = JSON.stringify(toProviderSchema(schema))
    // Keywords (a key followed by a plain value) are stripped; a field that
    // happens to be *named* "format" (followed by its own schema object) stays.
    for (const banned of [/"\$schema"/, /"format":"/, /"minimum":\d/, /"maxLength":\d/, /"pattern":"/]) {
      expect(json).not.toMatch(banned)
    }
    // Every object is closed, so the model can't invent extra fields.
    const objects = json.match(/"type":"object"/g)?.length ?? 0
    const closed = json.match(/"additionalProperties":false/g)?.length ?? 0
    expect(closed).toBe(objects)
  })
})
