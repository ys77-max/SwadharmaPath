import type { LibraryEntity, LibraryRow } from './types'

/**
 * CSV export and upload checks for the careers and streams library. The worker
 * (worker/library_refresh.py) parses uploads with the same columns and cell rules:
 * lists are joined with "; ", objects and pathways are JSON, an empty cell means
 * "leave as it is", and an empty id adds a new item.
 */
type Kind = 'text' | 'list' | 'number_list' | 'json'

export const CSV_COLUMNS: Record<LibraryEntity, [string, Kind][]> = {
  career: [
    ['id', 'text'], ['name', 'text'], ['family', 'text'], ['riasec_code', 'text'], ['interest_weights', 'number_list'],
    ['outlook', 'text'], ['automation_exposure', 'text'], ['description', 'text'], ['day_in_life', 'text'],
    ['typical_entry_paths', 'list'], ['adjacent_emerging', 'list'], ['workstyle_fit', 'list'], ['values_fit', 'list'],
    ['india_salary_band', 'json'], ['aptitude_min', 'json'], ['pathways', 'json'],
  ],
  stream: [
    ['id', 'text'], ['name', 'text'], ['board', 'text'], ['subjects', 'list'], ['keeps_open_families', 'list'],
    ['closes_families', 'list'], ['notes', 'text'],
  ],
}

function cell(kind: Kind, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (kind === 'list' || kind === 'number_list') return Array.isArray(v) ? v.join('; ') : String(v)
  if (kind === 'json') return JSON.stringify(v)
  return String(v)
}

function quote(s: string): string {
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(entity: LibraryEntity, rows: LibraryRow[]): string {
  const cols = CSV_COLUMNS[entity]
  const lines = [cols.map(([c]) => c).join(',')]
  for (const r of rows) lines.push(cols.map(([c, k]) => quote(cell(k, r[c]))).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** Reads the header row only (enough to check an upload before sending it). */
export function csvHeader(text: string): string[] {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  return first.split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
}

/** Which library a CSV is for, from its header, or an error an admin can act on. */
export function detectCsv(text: string): { entity: LibraryEntity } | { error: string } {
  if (!text.trim()) return { error: 'The file is empty.' }
  const head = csvHeader(text)
  if (!head.includes('name')) return { error: 'The first row must be the column headings, including "name". Start from Download CSV.' }
  const careerOnly = ['family', 'riasec_code', 'outlook', 'interest_weights']
  const streamOnly = ['board', 'subjects', 'keeps_open_families', 'closes_families']
  const isCareer = head.some((h) => careerOnly.includes(h))
  const isStream = head.some((h) => streamOnly.includes(h))
  if (isCareer === isStream) return { error: 'Could not tell whether this is the careers or the streams file. Start from Download CSV.' }
  return { entity: isCareer ? 'career' : 'stream' }
}

export const MAX_CSV_BYTES = 2_000_000
