// Instant scoring for one assessment session. Mirrors worker/scoring.py; both
// are checked against supabase/functions/_shared/scoring_fixtures.json.
// Pure functions only (no Deno or Node APIs) so vitest and Deno can both load it.
import styleTemplates from './workstyle_templates.json' with { type: 'json' }

export const SCORING_VERSION = 'scoring-0.1'

export type Option = { value: string | number; label: string; factor?: string; value_name?: string }
export type Item = { id: string; type: string; prompt: string; scale?: string; key?: number; reverse?: boolean; sd?: boolean; options: Option[] }
export type Section = { code: string; name: string; time_limit_sec: number | null; items: Item[] }
export type Norms = Record<string, Record<string, { mean: number; sd: number }>>
export type Responses = Record<string, { a: unknown; rt?: number }>

export interface ScoreInput {
  items: { sections: Section[] }
  scoring_spec: Record<string, unknown> & { method: string }
  norms: Norms | null
  responses: Responses
  ageBand: string
  variant: 'junior' | 'standard'
}

export interface ScoreOutput {
  raw: Record<string, unknown>
  percentiles: Record<string, number>
  derived: Record<string, unknown>
  validity_flags: Record<string, boolean>
}

export const AGE_BANDS = ['13-15', '16-18', '19-22', '23+'] as const

export function ageBand(dob: string | null, on: Date = new Date()): string {
  if (!dob) return '16-18'
  const b = new Date(dob)
  let age = on.getUTCFullYear() - b.getUTCFullYear()
  if (on.getUTCMonth() < b.getUTCMonth() || (on.getUTCMonth() === b.getUTCMonth() && on.getUTCDate() < b.getUTCDate())) age--
  if (age <= 15) return '13-15'
  if (age <= 18) return '16-18'
  if (age <= 22) return '19-22'
  return '23+'
}

// Abramowitz-Stegun 7.1.26 approximation of erf, accurate to ~1e-7.
function erf(x: number) {
  const s = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a)
  return s * y
}

export function percentile(x: number, mean: number, sd: number): number {
  if (!sd) return 50
  const p = 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)))
  return Math.max(1, Math.min(99, Math.round(p * 100)))
}

const round2 = (x: number) => Math.round(x * 100) / 100
const allItems = (sections: Section[]) => sections.flatMap((s) => s.items)

function normPct(norms: Norms | null, band: string, scale: string, x: number): number | undefined {
  const n = norms?.[band]?.[scale]
  return n ? percentile(x, n.mean, n.sd) : undefined
}

export function aptitudeBand(p: number): 'Low' | 'Average' | 'High' | 'Very High' {
  if (p < 25) return 'Low'
  if (p < 75) return 'Average'
  if (p < 90) return 'High'
  return 'Very High'
}

// ---------------------------------------------------------------- validity

export function validity(items: Item[], responses: Responses): Record<string, boolean> {
  const rts = items.map((i) => responses[i.id]?.rt).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b)
  const median = rts.length ? (rts.length % 2 ? rts[(rts.length - 1) / 2] : (rts[rts.length / 2 - 1] + rts[rts.length / 2]) / 2) : null
  let run = 0
  let longest = 0
  let prev: string | null = null
  for (const i of items) {
    if (i.type !== 'likert5') continue
    const a = responses[i.id]?.a
    const k = a === undefined ? null : JSON.stringify(a)
    run = k !== null && k === prev ? run + 1 : k === null ? 0 : 1
    prev = k
    longest = Math.max(longest, run)
  }
  const answered = items.filter((i) => responses[i.id] !== undefined).length
  return {
    fast_responses: median !== null && median < 1500,
    straight_lining: longest >= 10,
    incomplete: items.length > 0 && answered / items.length < 0.8,
  }
}

// ---------------------------------------------------------------- methods

function scoreRiasec(inp: ScoreInput): ScoreOutput {
  const scales = (inp.scoring_spec.scales as string[]) ?? ['R', 'I', 'A', 'S', 'E', 'C']
  const items = allItems(inp.items.sections)
  const raw: Record<string, number> = {}
  const n: Record<string, number> = {}
  for (const s of scales) { raw[s] = 0; n[s] = 0 }
  for (const i of items) {
    const a = inp.responses[i.id]?.a
    if (typeof a === 'number' && i.scale && i.scale in raw) { raw[i.scale] += a; n[i.scale]++ }
  }
  const percentiles: Record<string, number> = {}
  for (const s of scales) {
    const p = normPct(inp.norms, inp.ageBand, s, raw[s])
    if (p !== undefined) percentiles[s] = p
  }
  const vector = scales.map((s) => (n[s] ? round2((raw[s] - n[s]) / (n[s] * 4)) : 0))
  const order = [...scales].sort((a, b) => (percentiles[b] ?? 0) - (percentiles[a] ?? 0) || raw[b] - raw[a] || scales.indexOf(a) - scales.indexOf(b))
  return { raw, percentiles, derived: { code: order.slice(0, 3).join(''), vector, order }, validity_flags: validity(items, inp.responses) }
}

function scoreAptitude(inp: ScoreInput): ScoreOutput {
  const raw: Record<string, number> = {}
  const percentiles: Record<string, number> = {}
  const bands: Record<string, string> = {}
  for (const sec of inp.items.sections) {
    raw[sec.code] = sec.items.filter((i) => inp.responses[i.id]?.a === i.key).length
    const p = normPct(inp.norms, inp.ageBand, sec.code, raw[sec.code])
    if (p !== undefined) { percentiles[sec.code] = p; bands[sec.code] = aptitudeBand(p) }
  }
  const items = allItems(inp.items.sections)
  const v = validity(items, inp.responses)
  return { raw, percentiles, derived: { bands, attempted: items.filter((i) => inp.responses[i.id]).length }, validity_flags: { fast_responses: v.fast_responses } }
}

const FACTORS = ['R', 'A', 'P', 'D'] as const
type Graph = [number, number, number, number]
const clamp19 = (x: number) => Math.max(-19, Math.min(19, Math.round(x)))

export function primaryOf(g: Graph): string | null {
  const above = FACTORS.map((f, i) => ({ f, v: g[i] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
  return above[0]?.f ?? null
}

function scoreWorkstyle(inp: ScoreInput): ScoreOutput {
  const items = allItems(inp.items.sections)
  const most: Record<string, number> = { R: 0, A: 0, P: 0, D: 0 }
  const least: Record<string, number> = { R: 0, A: 0, P: 0, D: 0 }
  let N = 0
  for (const i of items) {
    const a = inp.responses[i.id]?.a as { most?: string; least?: string } | undefined
    if (!a?.most || !a?.least || a.most === a.least) continue
    const fm = i.options.find((o) => String(o.value) === a.most)?.factor
    const fl = i.options.find((o) => String(o.value) === a.least)?.factor
    if (!fm || !fl) continue
    most[fm]++
    least[fl]++
    N++
  }
  const q = N / 4
  const others = FACTORS.map((f) => (N ? clamp19(((most[f] - q) / (3 * q)) * 19) : 0)) as Graph
  const stress = FACTORS.map((f) => (N ? clamp19(((q - least[f]) / (3 * q)) * 19) : 0)) as Graph
  const self = FACTORS.map((f) => (N ? clamp19(((most[f] - least[f]) / N) * 19) : 0)) as Graph
  const junior = inp.variant === 'junior'
  const graphs: Record<string, Graph> = junior ? { others, self } : { others, stress, self }

  const [R, A, P, D] = self
  const span = Math.max(...self) - Math.min(...self)
  const patterns: Record<string, unknown> = {
    span: span >= 20 ? 'wide' : span <= 8 ? 'crunched' : 'normal',
    reversal: primaryOf(others) !== null && primaryOf(self) !== null && primaryOf(others) !== primaryOf(self),
    undershift: self.every((v) => v <= 2),
    overshift: self.filter((v) => v > 0).length >= 3,
    mercurial: A - Math.max(R, P, D) >= 8,
    flick_up: P < 0 && D < 0 && D > P,
    flick_down: P < 0 && D < 0 && D < P,
  }
  if (!junior) {
    const s: string[] = []
    const dPersonal = stress[2] - self[2]
    const dPerformance = others[2] - self[2]
    if (Math.abs(dPersonal) >= 3) s.push('personal')
    if (Math.abs(dPerformance) >= 3) s.push('performance')
    const aPersonal = stress[1] - self[1]
    const aPerformance = others[1] - self[1]
    if ((Math.abs(dPersonal) >= 3 && Math.abs(aPersonal) >= 3 && Math.sign(aPersonal) === Math.sign(dPersonal)) ||
        (Math.abs(dPerformance) >= 3 && Math.abs(aPerformance) >= 3 && Math.sign(aPerformance) === Math.sign(dPerformance))) s.push('relationship')
    patterns.stress = s
  }
  const sorted = FACTORS.map((f, i) => ({ f, v: self[i] })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v)
  const primary = sorted[0]?.f ?? null
  const divergence = FACTORS.some((_, i) => Math.abs(others[i] - self[i]) >= 12)
  return {
    raw: { most, least, n: N },
    percentiles: {},
    derived: { graphs, primary, secondary: sorted[1]?.f ?? null, patterns, style_table: styleTable(primary) },
    validity_flags: { ...validity(items, inp.responses), divergence },
  }
}

/** Strengths / limitations per area for the primary style (original template text). */
export function styleTable(primary: string | null) {
  if (!primary) return null
  const t = styleTemplates.styles[primary as keyof typeof styleTemplates.styles]
  return {
    style: primary,
    label: t.label,
    summary: t.summary,
    rows: styleTemplates.areas.map((area) => ({ area, ...(t[area as keyof typeof t] as { strength: string; limitation: string }) })),
    template_version: styleTemplates.version,
  }
}

function scoreBigFive(inp: ScoreInput): ScoreOutput {
  const domains = (inp.scoring_spec.domains as string[]) ?? ['O', 'C', 'E', 'A', 'N']
  const items = allItems(inp.items.sections)
  const sums: Record<string, number[]> = {}
  for (const i of items) {
    const a = inp.responses[i.id]?.a
    if (typeof a !== 'number' || !i.scale) continue
    ;(sums[i.scale] ??= []).push(i.reverse ? 6 - a : a)
  }
  const raw: Record<string, number> = {}
  const percentiles: Record<string, number> = {}
  for (const d of [...domains, 'SD']) {
    const xs = sums[d]
    if (!xs?.length) continue
    raw[d] = round2(xs.reduce((s, x) => s + x, 0) / xs.length)
    const p = normPct(inp.norms, inp.ageBand, d, raw[d])
    if (p !== undefined) percentiles[d] = p
  }
  const sdPct = percentiles.SD
  delete percentiles.SD
  return {
    raw, percentiles, derived: { social_desirability_pct: sdPct ?? null },
    validity_flags: { ...validity(items.filter((i) => !i.sd), inp.responses), social_desirability: sdPct !== undefined && sdPct > 80 },
  }
}

function scoreValues(inp: ScoreInput): ScoreOutput {
  const names = (inp.scoring_spec.values as string[]) ?? []
  const top = (inp.scoring_spec.top as number) ?? 5
  const items = allItems(inp.items.sections)
  const wins: Record<string, number> = Object.fromEntries(names.map((v) => [v, 0]))
  const seen: Record<string, number> = Object.fromEntries(names.map((v) => [v, 0]))
  for (const i of items) {
    const a = inp.responses[i.id]?.a
    for (const o of i.options) if (o.value_name) seen[o.value_name] = (seen[o.value_name] ?? 0) + 1
    const chosen = i.options.find((o) => o.value === a)?.value_name
    if (chosen) wins[chosen] = (wins[chosen] ?? 0) + 1
  }
  const ranking = [...names].sort((a, b) => wins[b] - wins[a] || names.indexOf(a) - names.indexOf(b))
  const vector = names.map((v) => (seen[v] ? round2(wins[v] / seen[v]) : 0))
  return { raw: { wins }, percentiles: {}, derived: { ranking, top5: ranking.slice(0, top), vector }, validity_flags: { fast_responses: validity(items, inp.responses).fast_responses } }
}

function scoreLikertScales(inp: ScoreInput): ScoreOutput {
  const scales = (inp.scoring_spec.scales as string[]) ?? []
  const items = allItems(inp.items.sections)
  const by: Record<string, number[]> = {}
  for (const i of items) {
    const a = inp.responses[i.id]?.a
    if (typeof a === 'number' && i.scale) (by[i.scale] ??= []).push(a)
  }
  const raw: Record<string, number> = {}
  const percentiles: Record<string, number> = {}
  for (const s of scales) {
    const xs = by[s]
    if (!xs?.length) continue
    const sum = xs.reduce((t, x) => t + x, 0)
    raw[s] = inp.scoring_spec.per_item ? sum : round2(sum / xs.length)
    const p = normPct(inp.norms, inp.ageBand, s, sum)
    if (p !== undefined) percentiles[s] = p
  }
  const order = [...scales].filter((s) => s in raw).sort((a, b) => raw[b] - raw[a])
  return { raw, percentiles, derived: { order, top: order[0] ?? null }, validity_flags: validity(items, inp.responses) }
}

export function scoreSession(inp: ScoreInput): ScoreOutput {
  switch (inp.scoring_spec.method) {
    case 'riasec': return scoreRiasec(inp)
    case 'aptitude': return scoreAptitude(inp)
    case 'workstyle': return scoreWorkstyle(inp)
    case 'bigfive': return scoreBigFive(inp)
    case 'values': return scoreValues(inp)
    case 'likert_scales': return scoreLikertScales(inp)
    default: throw new Error(`unknown scoring method ${inp.scoring_spec.method}`)
  }
}
