import { ROADMAP_TEMPLATES } from '../constants'
import type { ArchiveSettings, AssessmentSession, CaseloadRow, CounsellingSession, LibraryRow, NextItem, RefreshProposal, RefreshRun, Report } from '../types'
import type { Api } from './api'
import * as d from './demoData'

const KEY = 'swadharmapath.demo.persona'
const listeners = new Set<() => void>()
let personaId: string | null = (() => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
})()

const wait = <T,>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), ms))
const id = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`
const now = () => new Date().toISOString()
const me = () => d.users.find((u) => u.id === personaId) ?? null
const myCand = () => d.candidates.find((c) => c.user_id === personaId) ?? null

function setPersona(uid: string | null) {
  personaId = uid
  try {
    if (uid) localStorage.setItem(KEY, uid)
    else localStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: persona lasts for this tab only */
  }
  listeners.forEach((l) => l())
}

function flatItems(instrumentId: string) {
  return d.demoItems(instrumentId).flatMap((s) => s.items.map((item, index) => ({ section: s, item, index })))
}

// Library refresh and archiving live only in memory in demo mode. A refresh goes straight to
// review with one sample suggestion, standing in for the worker.
const runs: RefreshRun[] = []
const proposals: RefreshProposal[] = []
const reviewed: Record<string, string> = {}
const archivedAt: Record<string, string> = {}
let archiveSettings: ArchiveSettings = { auto_archive: false, candidate_inactive_days: 730, lead_inactive_days: 365, last_auto_run_at: null, updated_at: now() }
const openRun = () => runs.find((r) => ['queued', 'running', 'review'].includes(r.status))
const dayKey = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
function lastActivity(cid: string) {
  const c = d.candidates.find((x) => x.id === cid)!
  const times = [c.created_at, ...d.sessions.filter((s) => s.candidate_id === cid).map((s) => s.scheduled_at),
    ...d.assessmentSessions.filter((a) => a.candidate_id === cid).flatMap((a) => [a.started_at, a.completed_at ?? '']),
    ...d.reports.filter((r) => r.candidate_id === cid).map((r) => r.created_at)]
  return times.filter(Boolean).sort().at(-1) ?? c.created_at
}
function archivable(before: string) {
  return d.candidates
    .filter((c) => !archivedAt[c.id] && lastActivity(c.id) < before && !d.sessions.some((s) => s.candidate_id === c.id && s.scheduled_at > now()))
    .map((c) => ({ id: c.id, name: d.users.find((u) => u.id === c.user_id)?.full_name ?? null, last_activity: lastActivity(c.id) }))
}

function caseRow(cid: string): CaseloadRow {
  const c = d.candidates.find((x) => x.id === cid)!
  const u = d.users.find((x) => x.id === c.user_id)
  const ses = d.sessions.filter((s) => s.candidate_id === cid).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const past = ses.filter((s) => s.scheduled_at <= now())
  const done = d.assessmentSessions.filter((a) => a.candidate_id === cid && a.status === 'completed')
  const assessed = done.map((a) => a.completed_at!).sort().at(-1) ?? null
  const reported = d.reports.filter((r) => r.candidate_id === cid && ['candidate', 'candidate_junior', 'stream_choice'].includes(r.kind)).map((r) => r.created_at).sort()[0] ?? null
  const age = c.dob ? (Date.now() - new Date(c.dob).getTime()) / (365.25 * 86_400_000) : 0
  return {
    candidate_id: cid, full_name: u?.full_name ?? null, track: c.track, status: c.status, class_or_years_exp: c.class_or_years_exp, city: c.city,
    iccc_stage: past.at(-1)?.iccc_stage ?? 'know_self',
    next_session_at: ses.find((s) => s.scheduled_at > now())?.scheduled_at ?? null,
    assessments_done: done.length,
    validity_issues: d.results.filter((r) => r.candidate_id === cid && Object.values(r.validity_flags).some((v) => v === true)).length,
    missed_items: d.roadmapItems.filter((i) => d.roadmaps.find((r) => r.id === i.roadmap_id)?.candidate_id === cid && i.status === 'missed').length,
    consent_pending: (!c.dob || age < 18) && !c.guardian_consent_at,
    profile_approved_at: d.profiles.find((p) => p.candidate_id === cid)?.approved_at ?? null,
    assessed_at: assessed, reported_at: reported,
    report_due_at: assessed ? new Date(new Date(assessed).getTime() + 7 * 86_400_000).toISOString() : null,
  }
}

export const demoApi: Api = {
  async currentUser() {
    return wait(me(), 30)
  },
  onAuthChange(cb) {
    listeners.add(cb)
    return () => listeners.delete(cb)
  },
  async signInWithPassword(email) {
    const p = d.PERSONAS.find((x) => x.email === email.trim().toLowerCase())
    if (!p) throw new Error('Demo mode: pick one of the demo accounts below.')
    setPersona(p.userId)
  },
  async sendPhoneOtp() {
    await wait(null)
  },
  async verifyPhoneOtp() {
    setPersona('u-rohan')
  },
  async signOut() {
    setPersona(null)
  },

  async caseload() {
    const mine = d.candidates.filter((c) => !archivedAt[c.id] && (me()?.role === 'admin' || c.counsellor_id === personaId))
    return wait(mine.map((c) => caseRow(c.id)))
  },
  async getCase(cid) {
    const c = d.candidates.find((x) => x.id === cid)
    if (!c) throw new Error('Case not found')
    return wait({ candidate: c, user: d.users.find((u) => u.id === c.user_id) ?? null, parent: d.users.find((u) => u.id === c.parent_user_id) ?? null })
  },
  async instrumentsFor(variant) {
    // demo data has no adult battery; professionals see the standard one
    const v = variant === 'adult' ? 'standard' : variant
    return wait(d.instruments.filter((i) => i.track_variant === v))
  },
  async assessmentSessions(cid) {
    return wait(d.assessmentSessions.filter((s) => s.candidate_id === cid).map(({ responses, ...s }) => ({ ...s, answered: Object.keys(responses).length })))
  },
  async assessmentResults(cid) {
    return wait(d.results.filter((r) => r.candidate_id === cid))
  },
  async reAdminister(sid) {
    const s = d.assessmentSessions.find((x) => x.id === sid)
    if (s) s.status = 'invalidated'
    await wait(null)
  },
  async profile(cid) {
    return wait(d.profiles.find((p) => p.candidate_id === cid) ?? null)
  },
  async saveNarrative(cid, narrative) {
    const p = d.profiles.find((x) => x.candidate_id === cid)
    if (p) Object.assign(p, { narrative, updated_at: now() })
    else d.profiles.push({ candidate_id: cid, narrative, interest_vector: null, aptitude_vector: null, workstyle_vector: null, values_vector: null, approved_by: null, approved_at: null, updated_at: now() })
    await wait(null)
  },
  async approveProfile(cid) {
    const p = d.profiles.find((x) => x.candidate_id === cid)
    if (p) Object.assign(p, { approved_by: personaId, approved_at: now() })
    await wait(null)
  },
  async swadharma(cid) {
    const c = d.candidates.find((x) => x.id === cid)!
    return wait({
      optedIn: c.swadharma_opted_in,
      birth: d.birthDetails[cid] ?? null,
      chart: d.swadharmaCharts.find((x) => x.candidate_id === cid) ?? null,
      scores: d.swadharmaScores.filter((x) => x.candidate_id === cid).sort((a, b) => b.points - a.points),
      releases: d.releases.filter((x) => x.candidate_id === cid),
      swadharmaReports: d.reports.filter((r) => r.candidate_id === cid && r.kind === 'swadharma'),
    })
  },
  async saveSwadharmaNote(scoreId, note) {
    const s = d.swadharmaScores.find((x) => x.id === scoreId)
    if (s) s.counsellor_notes = note
    await wait(null)
  },
  async releaseSwadharma({ candidateId, reportId, to, reason }) {
    if (!reason.trim()) throw new Error('A reason is required')
    const r = d.reports.find((x) => x.id === reportId)
    if (!r || r.kind !== 'swadharma') throw new Error('Pick a Swadharma report to release')
    d.releases.unshift({ id: id('rel'), candidate_id: candidateId, released_by: personaId!, released_to: to, reason, report_id: reportId, released_at: now() })
    const prev = r.visible_to
    r.visible_to = to === 'both' || prev === 'all' || (prev !== 'counsellor' && prev !== to) ? 'all' : to
    await wait(null)
  },
  async careerMatches(cid) {
    return wait(d.careerMatches.filter((m) => m.candidate_id === cid).map((m) => ({ ...m, career: d.careers.find((c) => c.id === m.career_id) })).sort((a, b) => a.rank - b.rank))
  },
  async streamMatches(cid) {
    return wait(d.streamMatches.filter((m) => m.candidate_id === cid).map((m) => ({ ...m, stream: d.streams.find((s) => s.id === m.stream_option_id) })).sort((a, b) => a.rank - b.rank))
  },
  async setMatchAction(table, mid, action) {
    const list = table === 'career_matches' ? d.careerMatches : d.streamMatches
    const m = list.find((x) => x.id === mid)
    if (m) {
      m.counsellor_action = action
      if (action === 'hidden') m.visible_to_candidate = false
    }
    await wait(null)
  },
  async addCareerMatch(cid, careerId) {
    d.careerMatches.push({ id: id('cm'), candidate_id: cid, career_id: careerId, fit_score: NaN, breakdown: {}, rank: 99, counsellor_action: 'added', visible_to_candidate: false, match_version: 'counsellor' })
    await wait(null)
  },
  async addStreamMatch(cid, streamId) {
    d.streamMatches.push({ id: id('sm'), candidate_id: cid, stream_option_id: streamId, fit_score: NaN, breakdown: {}, rank: 99, counsellor_action: 'added', visible_to_candidate: false })
    await wait(null)
  },
  async setMatchesPublished(table, cid, published) {
    const list = table === 'career_matches' ? d.careerMatches : d.streamMatches
    list.filter((m) => m.candidate_id === cid).forEach((m) => (m.visible_to_candidate = published && m.counsellor_action !== 'hidden'))
    await wait(null)
  },
  async careers() {
    return wait(d.careers)
  },
  async streams() {
    return wait(d.streams)
  },
  async sessions(cid) {
    return wait(d.sessions.filter((s) => s.candidate_id === cid).sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at)))
  },
  async saveSession(s) {
    let row = s.id ? d.sessions.find((x) => x.id === s.id) : undefined
    if (row) Object.assign(row, s)
    else {
      row = { id: id('se'), counsellor_id: personaId, scheduled_at: now(), duration_min: 60, mode: 'video', meeting_url: null, iccc_stage: 'know_self', notes_private: null, summary_for_candidate: null, action_items: [], attended: null, ...s } as CounsellingSession
      d.sessions.push(row)
    }
    return wait(row)
  },
  async roadmap(cid) {
    const roadmap = d.roadmaps.filter((r) => r.candidate_id === cid).sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))[0] ?? null
    const items = roadmap ? d.roadmapItems.filter((i) => i.roadmap_id === roadmap.id).sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9')) : []
    return wait({ roadmap, items })
  },
  async createRoadmap(cid, template, startDate) {
    const t = ROADMAP_TEMPLATES[template]
    const rid = id('rm')
    const end = new Date(startDate)
    end.setMonth(end.getMonth() + t.months)
    d.roadmaps.push({ id: rid, candidate_id: cid, template, goal_career_id: null, goal_stream_id: null, start_date: startDate, end_date: end.toISOString().slice(0, 10), status: 'draft', published_at: null })
    t.items.forEach((i) => {
      const due = new Date(startDate)
      due.setDate(due.getDate() + i.offsetDays)
      d.roadmapItems.push({ id: id('ri'), roadmap_id: rid, kind: i.kind, title: i.title, description: null, due_date: due.toISOString().slice(0, 10), owner: i.owner, status: 'todo', evidence_url: null, completed_at: null })
    })
    await wait(null)
  },
  async saveRoadmapItem(item) {
    const row = item.id ? d.roadmapItems.find((x) => x.id === item.id) : undefined
    if (row) Object.assign(row, item)
    else d.roadmapItems.push({ id: id('ri'), kind: 'task', title: 'New item', description: null, due_date: null, owner: 'candidate', status: 'todo', evidence_url: null, completed_at: null, ...item })
    await wait(null)
  },
  async deleteRoadmapItem(iid) {
    const i = d.roadmapItems.findIndex((x) => x.id === iid)
    if (i >= 0) d.roadmapItems.splice(i, 1)
    await wait(null)
  },
  async setRoadmapStatus(rid, status) {
    const r = d.roadmaps.find((x) => x.id === rid)
    if (r) Object.assign(r, { status, published_at: status === 'published' ? r.published_at ?? now() : r.published_at })
    await wait(null)
  },
  async reports(cid) {
    return wait(d.reports.filter((r) => r.candidate_id === cid).sort((a, b) => b.created_at.localeCompare(a.created_at)))
  },
  async requestReport(cid, kind, visibleTo) {
    const version = Math.max(0, ...d.reports.filter((r) => r.candidate_id === cid && r.kind === kind).map((r) => r.version)) + 1
    const r: Report = { id: id('rep'), candidate_id: cid, kind, version, generated_by: personaId, pdf_path: null, content: { status: 'requested' },
      visible_to: kind === 'case_file' || kind === 'swadharma' ? 'counsellor' : visibleTo, created_at: now() }
    d.reports.push(r)
    // pretend the worker renders it a few seconds later
    setTimeout(() => {
      r.pdf_path = `reports/${cid}/${kind}-v${version}.pdf`
      r.content = { status: 'ready' }
    }, 4000)
    await wait(null)
  },
  async reportUrl() {
    return wait('data:application/pdf;base64,JVBERi0xLjEKJcK1wrYKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0+PmVuZG9iagp0cmFpbGVyPDwvUm9vdCAxIDAgUj4+Cg==')
  },
  async documents(cid) {
    const uploads = d.documents.filter((x) => x.candidate_id === cid).map((x) => ({ name: x.name, path: x.path, created_at: x.created_at, size: x.size, source: 'upload' as const }))
    const rm = d.roadmaps.filter((r) => r.candidate_id === cid).map((r) => r.id)
    const ev = d.roadmapItems.filter((i) => rm.includes(i.roadmap_id) && i.evidence_url).map((i) => ({ name: `Evidence: ${i.title}`, path: i.evidence_url!, created_at: i.completed_at, size: null, source: 'evidence' as const }))
    return wait([...uploads, ...ev])
  },
  async uploadDocument(cid, file) {
    d.documents.unshift({ candidate_id: cid, name: file.name, path: `${cid}/${Date.now()}-${file.name}`, created_at: now(), size: file.size })
    await wait(null, 400)
  },
  async documentUrl() {
    return demoApi.reportUrl('x')
  },

  // ---------------------------------------------------------------- admin: library refresh and archiving
  async libraryRows(entity) {
    const rows: LibraryRow[] = entity === 'career'
      ? d.careers.map((c) => ({ ...c, pathways: [] }))
      : d.streams.map((st) => ({ ...st }))
    return wait(rows.map((r) => ({ ...r, last_reviewed: reviewed[r.id] ?? null })))
  },
  async refreshRuns() {
    return wait([...runs].sort((a, b) => b.created_at.localeCompare(a.created_at)))
  },
  async refreshRun(runId) {
    const run = runs.find((r) => r.id === runId)
    if (!run) throw new Error('Refresh not found')
    return wait({ run, proposals: proposals.filter((p) => p.run_id === runId) })
  },
  async requestLibraryRefresh(scope, source, csv) {
    if (openRun()) throw new Error('a library refresh is already in progress; finish or cancel it first')
    if (source === 'csv' && !csv?.trim()) throw new Error('upload a CSV file first')
    const run: RefreshRun = { id: id('run'), scope, source, status: 'review', requested_by: personaId, error: null, created_at: now(),
      finished_at: now(), applied_at: null, rematched_at: null, summary: { checked: 0, proposals: 0, errors: [] } }
    if (source === 'ai' && scope !== 'streams') {
      const c = d.careers[0]
      proposals.push({ id: id('prop'), run_id: run.id, entity: 'career', entity_id: c.id, entity_name: c.name, decision: 'pending', decided_at: null,
        changes: { outlook: { old: c.outlook, new: c.outlook === 'growing' ? 'transforming' : 'growing' } },
        rationale: 'Demo suggestion. In production the worker checks each entry against current Indian sources and cites them here.',
        sources: [{ url: 'https://www.weforum.org/publications/the-future-of-jobs-report-2025/', title: 'WEF Future of Jobs Report 2025' }] })
      run.summary = { checked: d.careers.length, proposals: 1, errors: [] }
    } else {
      run.summary = { checked: 0, proposals: 0, errors: ['Demo mode: the worker reads uploaded CSVs and stream suggestions in production.'] }
    }
    runs.push(run)
    return wait(run.id)
  },
  async cancelLibraryRefresh(runId) {
    const r = runs.find((x) => x.id === runId && ['queued', 'running', 'review'].includes(x.status))
    if (!r) throw new Error('this refresh is not open')
    r.status = 'cancelled'
    return wait(undefined)
  },
  async decideProposal(proposalId, decision) {
    const p = proposals.find((x) => x.id === proposalId)
    if (!p) throw new Error('this change is not awaiting review')
    p.decision = decision
    p.decided_at = decision === 'pending' ? null : now()
    return wait(undefined)
  },
  async applyLibraryRefresh(runId) {
    const r = runs.find((x) => x.id === runId && x.status === 'review')
    if (!r) throw new Error('this refresh is not awaiting review')
    let applied = 0
    for (const p of proposals.filter((x) => x.run_id === runId)) {
      if (p.decision === 'pending') p.decision = 'skipped'
      if (p.decision !== 'approved') continue
      const target = (p.entity === 'career' ? d.careers : d.streams).find((x) => x.id === p.entity_id) as unknown as Record<string, unknown> | undefined
      if (target) for (const [f, v] of Object.entries(p.changes)) if (f in target) target[f] = v.new
      applied++
    }
    const today = new Date().toISOString().slice(0, 10)
    if (r.scope !== 'streams') d.careers.forEach((c) => (reviewed[c.id] = today))
    if (r.scope !== 'careers') d.streams.forEach((st) => (reviewed[st.id] = today))
    Object.assign(r, { status: 'applied', applied_at: now(), rematched_at: now(), summary: { ...r.summary, applied } })
    return wait(applied)
  },
  async archiveSettings() {
    return wait(archiveSettings)
  },
  async saveArchiveSettings(s) {
    archiveSettings = { ...archiveSettings, ...s, updated_at: now() }
    return wait(undefined)
  },
  async archivePreview(candidatesBefore) {
    return wait({ candidates: archivable(candidatesBefore), leads: [] })
  },
  async archiveInactive(candidatesBefore) {
    if (candidatesBefore && candidatesBefore > dayKey(30)) throw new Error('the candidate cutoff must be at least 30 days ago')
    const hit = candidatesBefore ? archivable(candidatesBefore) : []
    hit.forEach((c) => (archivedAt[c.id] = now()))
    return wait({ candidates: hit.length, leads: 0 })
  },
  async archived() {
    return wait(Object.entries(archivedAt).map(([cid, at]) => ({
      entity: 'candidate' as const, id: cid, archived_at: at,
      name: d.users.find((u) => u.id === d.candidates.find((c) => c.id === cid)?.user_id)?.full_name ?? null,
    })))
  },
  async restoreArchived(_entity, rid) {
    if (!archivedAt[rid]) throw new Error('nothing archived with that id')
    delete archivedAt[rid]
    return wait(undefined)
  },

  // ---------------------------------------------------------------- candidate
  async myCandidate() {
    return wait(myCand())
  },
  async myInstruments() {
    const c = myCand()
    if (!c) return []
    const variant = c.track === 'early_explorer' ? 'junior' : 'standard'  // demo data has no adult battery
    return wait(d.instruments.filter((i) => i.track_variant === variant).map((i) => {
      const s = d.assessmentSessions.filter((x) => x.candidate_id === c.id && x.instrument_id === i.id && x.status !== 'invalidated').at(-1)
      const n = flatItems(i.id).length
      return { instrument_id: i.id, code: i.code, name: i.name, track_variant: i.track_variant, time_limit_min: i.time_limit_min, item_count: n,
        est_minutes: i.time_limit_min ?? Math.max(1, Math.ceil((n * 12) / 60)), session_id: s?.id ?? null, status: s?.status ?? null,
        answered: s ? Object.keys(s.responses).filter((k) => k !== '_meta').length : 0 }
    }))
  },
  async mySessions() {
    const c = myCand()
    const kids = d.candidates.filter((x) => x.parent_user_id === personaId).map((x) => x.id)
    return wait(d.sessions.filter((s) => s.candidate_id === c?.id || kids.includes(s.candidate_id)).map(({ notes_private: _omit, ...s }) => s).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)))
  },
  async myProgress() {
    const c = myCand()
    const cid = c?.id
    return wait({
      publishedOptions: d.careerMatches.some((m) => m.candidate_id === cid && m.visible_to_candidate) || d.streamMatches.some((m) => m.candidate_id === cid && m.visible_to_candidate),
      publishedRoadmap: d.roadmaps.some((r) => r.candidate_id === cid && r.status !== 'draft'),
      attendedSessions: d.sessions.filter((s) => s.candidate_id === cid && s.attended).length,
      profileApproved: Boolean(d.profiles.find((p) => p.candidate_id === cid)?.approved_at),
    })
  },
  async startAssessment(cid, instrumentId) {
    const c = d.candidates.find((x) => x.id === cid)!
    if (c.dob && Date.now() - new Date(c.dob).getTime() < 18 * 365.25 * 86_400_000 && !c.guardian_consent_at) {
      throw new Error('guardian consent is required before an under-18 candidate can start an assessment')
    }
    const s: AssessmentSession & { responses: Record<string, unknown> } = { id: id('as'), candidate_id: cid, instrument_id: instrumentId, started_at: now(), completed_at: null, status: 'in_progress', device: 'desktop', duration_sec: null, responses: {} }
    d.assessmentSessions.push(s)
    return wait(s.id)
  },
  async nextItem(sid, position) {
    const s = d.assessmentSessions.find((x) => x.id === sid)
    if (!s || s.status !== 'in_progress') throw new Error('assessment is not in progress')
    const items = flatItems(s.instrument_id)
    const meta = ((s.responses._meta as { section_started?: Record<string, string> }) ??= {})
    meta.section_started ??= {}
    let pos = position ?? items.findIndex((x) => !(x.item.id in s.responses))
    for (;;) {
      if (pos < 0 || pos >= items.length) return wait<NextItem>({ done: true, total: items.length })
      const { section } = items[pos]
      if (!section.time_limit_sec) break
      const started = meta.section_started[section.code]
      if (started && Date.now() >= new Date(started).getTime() + section.time_limit_sec * 1000) {
        const next = items.findIndex((x, i) => i > pos && x.section.code !== section.code)
        pos = next
        continue
      }
      const furthest = Math.max(-1, ...items.map((x, i) => (x.section.code === section.code && x.item.id in s.responses ? i : -1)))
      if (furthest >= 0 && pos < furthest) throw new Error('back navigation is not allowed in a timed section')
      meta.section_started[section.code] ??= now()
      break
    }
    const { section, item, index } = items[pos]
    return wait<NextItem>({
      done: false, position: pos, total: items.length,
      section: { code: section.code, name: section.name, time_limit_sec: section.time_limit_sec, started_at: meta.section_started[section.code] ?? null, server_now: now(), index, count: section.items.length },
      item, answer: (s.responses[item.id] as NextItem['answer']) ?? null,
    }, 60)
  },
  async saveResponses(sid, responses) {
    const s = d.assessmentSessions.find((x) => x.id === sid)
    if (!s || s.status !== 'in_progress') throw new Error('assessment is not in progress')
    const known = new Set(flatItems(s.instrument_id).map((x) => x.item.id))
    const clean = Object.fromEntries(Object.entries(responses).filter(([k]) => known.has(k)))
    Object.assign(s.responses, clean)
    return wait(Object.keys(clean).length, 80)
  },
  async completeAssessment(sid) {
    const s = d.assessmentSessions.find((x) => x.id === sid)
    if (!s || s.status !== 'in_progress') throw new Error('assessment is not in progress')
    Object.assign(s, { status: 'completed', completed_at: now(), duration_sec: Math.round((Date.now() - new Date(s.started_at!).getTime()) / 1000) })
    await wait(null)
  },
}
