/** Pure helpers for the test runner, kept separate so they can be unit tested. */

export const AUTOSAVE_MS = 30_000

export type Answer = { a: unknown; rt: number }

/** Answers waiting to be flushed to save_responses(). */
export class ResponseBuffer {
  private pending = new Map<string, Answer>()
  private known = new Map<string, Answer>()

  put(itemId: string, answer: Answer) {
    this.pending.set(itemId, answer)
    this.known.set(itemId, answer)
  }

  get(itemId: string): Answer | undefined {
    return this.known.get(itemId)
  }

  get size() {
    return this.pending.size
  }

  /** Takes the pending answers; call restore() with them if the save fails. */
  take(): Record<string, Answer> {
    const out = Object.fromEntries(this.pending)
    this.pending.clear()
    return out
  }

  restore(batch: Record<string, Answer>) {
    for (const [k, v] of Object.entries(batch)) if (!this.pending.has(k)) this.pending.set(k, v)
  }
}

/**
 * Seconds left in a timed section, using the server's clock so a wrong device
 * clock cannot add time. clockOffsetMs = client now − server now at fetch time.
 */
export function remainingSeconds(limitSec: number, startedAtIso: string, clockOffsetMs: number, nowMs = Date.now()) {
  const serverNow = nowMs - clockOffsetMs
  const elapsed = (serverNow - new Date(startedAtIso).getTime()) / 1000
  return Math.max(0, Math.ceil(limitSec - elapsed))
}

export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Forced-choice answers need two different statements. */
export function forcedChoiceComplete(a: { most?: string; least?: string } | undefined) {
  return Boolean(a?.most && a?.least && a.most !== a.least)
}
