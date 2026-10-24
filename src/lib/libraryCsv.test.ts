import { describe, expect, it } from 'vitest'
import { csvHeader, detectCsv, toCsv } from './libraryCsv'

describe('library CSV', () => {
  it('writes lists with "; ", JSON for objects, and quotes when needed', () => {
    const csv = toCsv('career', [{
      id: 'c1', name: 'Data Scientist', family: 'Mathematics, Finance & Analytics', riasec_code: 'ICE',
      interest_weights: [0.2, 1, 0.1, 0.2, 0.5, 0.8], outlook: 'growing', typical_entry_paths: ['B.Sc Statistics', 'B.Tech'],
      india_salary_band: { entry: [6, 12], note: 'Indicative "metro" ranges' }, pathways: null,
    }])
    const [head, row] = csv.trimEnd().split('\r\n')
    expect(head.startsWith('id,name,family,riasec_code,interest_weights')).toBe(true)
    expect(row).toContain('"Mathematics, Finance & Analytics"')
    expect(row).toContain('0.2; 1; 0.1; 0.2; 0.5; 0.8')
    expect(row).toContain('"{""entry"":[6,12],""note"":""Indicative \\""metro\\"" ranges""}"')
    expect(row.endsWith(',')).toBe(true) // empty pathways cell
  })

  it('tells careers and streams files apart', () => {
    expect(detectCsv(toCsv('stream', []))).toEqual({ entity: 'stream' })
    expect(detectCsv(toCsv('career', []))).toEqual({ entity: 'career' })
    expect(detectCsv('﻿"id","name","notes"\n')).toHaveProperty('error')
    expect(detectCsv('foo,bar\n')).toHaveProperty('error')
    expect(detectCsv('  ')).toHaveProperty('error')
    expect(csvHeader('﻿id,"name"\r\nx,y')).toEqual(['id', 'name'])
  })
})
