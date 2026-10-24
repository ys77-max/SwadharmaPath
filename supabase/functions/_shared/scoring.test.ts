import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ageBand, aptitudeBand, percentile, primaryOf, scoreSession, type ScoreInput } from './scoring'

const FIXTURES = join(__dirname, 'scoring_fixtures.json')
type Case = { name: string; input: ScoreInput; expected: unknown }
const cases: Case[] = JSON.parse(readFileSync(FIXTURES, 'utf8'))

describe('helpers', () => {
  it('maps age to the four bands', () => {
    const on = new Date('2026-10-24T00:00:00Z')
    expect(ageBand('2012-01-01', on)).toBe('13-15')
    expect(ageBand('2009-01-01', on)).toBe('16-18')
    expect(ageBand('2005-01-01', on)).toBe('19-22')
    expect(ageBand('1995-01-01', on)).toBe('23+')
  })
  it('uses the spec aptitude bands', () => {
    expect([10, 25, 74, 75, 89, 90].map(aptitudeBand)).toEqual(['Low', 'Average', 'Average', 'High', 'High', 'Very High'])
  })
  it('computes a normal percentile', () => {
    expect(percentile(10, 10, 2)).toBe(50)
    expect(percentile(12, 10, 2)).toBe(84)
  })
  it('primary is highest above midline', () => {
    expect(primaryOf([3, -2, 9, 1])).toBe('P')
    expect(primaryOf([-1, -2, 0, -5])).toBeNull()
  })
})

describe('validity flags', () => {
  it('flags straight-lining and fast responses', () => {
    const straight = cases.find((c) => c.name === 'interest/standard/straight')!
    expect(scoreSession(straight.input).validity_flags.straight_lining).toBe(true)
    const fast = cases.find((c) => c.name === 'interest/standard/fast')!
    expect(scoreSession(fast.input).validity_flags.fast_responses).toBe(true)
    const normal = cases.find((c) => c.name === 'interest/standard/normal')!
    expect(scoreSession(normal.input).validity_flags).toMatchObject({ fast_responses: false, straight_lining: false })
  })
})

describe('instrument outputs', () => {
  it('produces a 3-letter RIASEC code and a 6-vector', () => {
    const out = scoreSession(cases.find((c) => c.name === 'interest/standard/normal')!.input)
    expect(String(out.derived.code)).toMatch(/^[RIASEC]{3}$/)
    expect((out.derived.vector as number[]).length).toBe(6)
  })
  it('gives three work-style graphs for standard and two for junior', () => {
    const std = scoreSession(cases.find((c) => c.name === 'workstyle/standard/normal')!.input)
    const jr = scoreSession(cases.find((c) => c.name === 'workstyle/junior/normal')!.input)
    expect(Object.keys(std.derived.graphs as object)).toEqual(['others', 'stress', 'self'])
    expect(Object.keys(jr.derived.graphs as object)).toEqual(['others', 'self'])
    for (const g of Object.values(std.derived.graphs as Record<string, number[]>)) for (const v of g) expect(Math.abs(v)).toBeLessThanOrEqual(19)
  })
  it('ranks values and keeps a top 5', () => {
    const out = scoreSession(cases.find((c) => c.name === 'values/standard/normal')!.input)
    expect((out.derived.top5 as string[]).length).toBe(5)
  })
})

describe('fixtures (shared with worker/tests/test_scoring.py)', () => {
  if (process.env.UPDATE_FIXTURES) {
    it('rewrites expected outputs', () => {
      for (const c of cases) c.expected = scoreSession(c.input)
      writeFileSync(FIXTURES, JSON.stringify(cases, null, 1))
    })
  }
  for (const c of cases) {
    it(c.name, () => {
      expect(c.expected, 'run UPDATE_FIXTURES=1 npx vitest run supabase/functions').not.toBeNull()
      expect(scoreSession(c.input)).toEqual(c.expected)
    })
  }
})
