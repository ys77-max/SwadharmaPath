import { describe, expect, it } from 'vitest'
import { fmtClock, forcedChoiceComplete, remainingSeconds, ResponseBuffer } from './runner'

describe('ResponseBuffer', () => {
  it('takes pending answers once and remembers them', () => {
    const b = new ResponseBuffer()
    b.put('i1', { a: 3, rt: 1200 })
    b.put('i2', { a: 1, rt: 900 })
    expect(b.size).toBe(2)
    expect(b.take()).toEqual({ i1: { a: 3, rt: 1200 }, i2: { a: 1, rt: 900 } })
    expect(b.size).toBe(0)
    expect(b.get('i1')).toEqual({ a: 3, rt: 1200 })
  })

  it('restores a failed batch without overwriting newer answers', () => {
    const b = new ResponseBuffer()
    b.put('i1', { a: 1, rt: 1 })
    const batch = b.take()
    b.put('i1', { a: 2, rt: 2 })
    b.restore(batch)
    expect(b.take()).toEqual({ i1: { a: 2, rt: 2 } })
  })
})

describe('remainingSeconds', () => {
  it('uses the server clock', () => {
    const started = '2026-01-01T10:00:00Z'
    const serverNow = Date.parse('2026-01-01T10:01:00Z')
    // device clock 5 minutes fast
    const offset = 5 * 60_000
    expect(remainingSeconds(300, started, offset, serverNow + offset)).toBe(240)
  })
  it('never goes negative', () => {
    expect(remainingSeconds(60, '2026-01-01T10:00:00Z', 0, Date.parse('2026-01-01T11:00:00Z'))).toBe(0)
  })
})

describe('helpers', () => {
  it('formats a clock', () => expect(fmtClock(125)).toBe('2:05'))
  it('checks forced choice', () => {
    expect(forcedChoiceComplete({ most: 'a', least: 'b' })).toBe(true)
    expect(forcedChoiceComplete({ most: 'a', least: 'a' })).toBe(false)
    expect(forcedChoiceComplete({ most: 'a' })).toBe(false)
  })
})
