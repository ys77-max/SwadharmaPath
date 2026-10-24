import { ROADMAP_TEMPLATES } from '../constants'
import { supabase } from '../supabase'
import type {
  AppUser, ArchiveSettings, ArchivedRow, LibraryRow, RefreshProposal, RefreshRun, AssessmentResult, AssessmentSession, BirthDetailsSummary, CaseloadRow, Candidate, Career, CareerMatch,
  CounsellingSession, DocumentFile, InstrumentMeta, MyInstrument, NextItem, ProfileSummary, Report, Roadmap,
  RoadmapItem, StreamMatch, StreamOption, SwadharmaChart, SwadharmaRelease, SwadharmaScore,
} from '../types'
import type { Api } from './api'

type Res<T> = { data: T | null; error: { message: string } | null }

function must<T>({ data, error }: Res<T>): T {
  if (error) throw new Error(error.message)
  return data as T
}

async function uid(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const id = data.session?.user.id
  if (!id) throw new Error('Not signed in')
  return id
}

const SESSION_COLS = 'id, candidate_id, instrument_id, started_at, completed_at, status, device, duration_sec'
const INSTRUMENT_COLS = 'id, code, name, version, track_variant, time_limit_min, is_active'
const CAREER_COLS = 'id, name, family, riasec_code, outlook, automation_exposure, description'
const RUN_COLS = 'id, scope, source, status, requested_by, summary, error, created_at, finished_at, applied_at, rematched_at'

function addDays(iso: string, days: number) {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const supabaseApi: Api = {
  async currentUser() {
    const { data } = await supabase.auth.getSession()
    const id = data.session?.user.id
    if (!id) return null
    const res = await supabase.from('users').select('id, role, full_name, phone, email, photo_url, language_pref').eq('id', id).maybeSingle()
    return must(res) as AppUser | null
  },
  onAuthChange(cb) {
    const { data } = supabase.auth.onAuthStateChange(() => cb())
    return () => data.subscription.unsubscribe()
  },
  async signInWithPassword(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  },
  async sendPhoneOtp(phone) {
    const { error } = await supabase.auth.signInWithOtp({ phone })
    if (error) throw new Error(error.message)
  },
  async verifyPhoneOtp(phone, token) {
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: 'sms' })
    if (error) throw new Error(error.message)
  },
  async signOut() {
    await supabase.auth.signOut()
  },

  // ---------------------------------------------------------------- counsellor
  async caseload() {
    return must(await supabase.from('v_caseload').select('*').order('next_session_at', { ascending: true, nullsFirst: false })) as CaseloadRow[]
  },
  async getCase(candidateId) {
    const candidate = must(await supabase.from('candidates').select('*').eq('id', candidateId).single()) as Candidate
    const ids = [candidate.user_id, candidate.parent_user_id].filter(Boolean) as string[]
    const users = ids.length ? (must(await supabase.from('users').select('id, role, full_name, phone, email').in('id', ids)) as AppUser[]) : []
    return {
      candidate,
      user: users.find((u) => u.id === candidate.user_id) ?? null,
      parent: users.find((u) => u.id === candidate.parent_user_id) ?? null,
    }
  },
  async instrumentsFor(variant) {
    return must(await supabase.from('instruments').select(INSTRUMENT_COLS).eq('track_variant', variant).eq('is_active', true)) as InstrumentMeta[]
  },
  async assessmentSessions(candidateId) {
    return must(await supabase.from('assessment_sessions').select(SESSION_COLS).eq('candidate_id', candidateId).order('started_at', { ascending: false })) as AssessmentSession[]
  },
  async assessmentResults(candidateId) {
    return must(await supabase.from('assessment_results').select('*').eq('candidate_id', candidateId).order('scored_at', { ascending: false })) as AssessmentResult[]
  },
  async reAdminister(sessionId) {
    must(await supabase.from('assessment_sessions').update({ status: 'invalidated' }).eq('id', sessionId))
  },
  async profile(candidateId) {
    return must(await supabase.from('profile_summary').select('*').eq('candidate_id', candidateId).maybeSingle()) as ProfileSummary | null
  },
  async saveNarrative(candidateId, narrative) {
    must(await supabase.from('profile_summary').upsert({ candidate_id: candidateId, narrative }, { onConflict: 'candidate_id' }))
  },
  async approveProfile(candidateId) {
    const me = await uid()
    must(await supabase.from('profile_summary').update({ approved_by: me, approved_at: new Date().toISOString() }).eq('candidate_id', candidateId))
  },
  async swadharma(candidateId) {
    const [cand, birth, chart, scores, releases, reports] = await Promise.all([
      supabase.from('candidates').select('swadharma_opted_in').eq('id', candidateId).single(),
      supabase.from('birth_details').select('birth_date, birth_time, time_certainty, birth_place, consent_at, consent_text_version').eq('candidate_id', candidateId).maybeSingle(),
      supabase.from('swadharma_charts').select('*').eq('candidate_id', candidateId).maybeSingle(),
      supabase.from('swadharma_scores').select('*').eq('candidate_id', candidateId).order('points', { ascending: false }),
      supabase.from('swadharma_releases').select('*').eq('candidate_id', candidateId).order('released_at', { ascending: false }),
      supabase.from('reports').select('*').eq('candidate_id', candidateId).eq('kind', 'swadharma').order('version', { ascending: false }),
    ])
    return {
      optedIn: Boolean((must(cand) as { swadharma_opted_in: boolean }).swadharma_opted_in),
      birth: must(birth) as BirthDetailsSummary | null,
      chart: must(chart) as SwadharmaChart | null,
      scores: must(scores) as SwadharmaScore[],
      releases: must(releases) as SwadharmaRelease[],
      swadharmaReports: must(reports) as Report[],
    }
  },
  async saveSwadharmaNote(scoreId, note) {
    must(await supabase.from('swadharma_scores').update({ counsellor_notes: note }).eq('id', scoreId))
  },
  async releaseSwadharma({ candidateId, reportId, to, reason }) {
    const me = await uid()
    must(await supabase.from('swadharma_releases').insert({ candidate_id: candidateId, report_id: reportId, released_to: to, reason, released_by: me }))
  },
  async careerMatches(candidateId) {
    return must(await supabase.from('career_matches').select(`*, career:careers(${CAREER_COLS})`).eq('candidate_id', candidateId).order('rank')) as CareerMatch[]
  },
  async streamMatches(candidateId) {
    return must(await supabase.from('stream_matches').select('*, stream:stream_options(*)').eq('candidate_id', candidateId).order('rank')) as StreamMatch[]
  },
  async setMatchAction(table, id, action) {
    const patch: Record<string, unknown> = { counsellor_action: action }
    if (action === 'hidden') patch.visible_to_candidate = false
    must(await supabase.from(table).update(patch).eq('id', id))
  },
  async addCareerMatch(candidateId, careerId) {
    must(await supabase.from('career_matches').insert({ candidate_id: candidateId, career_id: careerId, counsellor_action: 'added', rank: 99, fit_score: null, breakdown: {}, match_version: 'counsellor' }))
  },
  async addStreamMatch(candidateId, streamId) {
    must(await supabase.from('stream_matches').insert({ candidate_id: candidateId, stream_option_id: streamId, counsellor_action: 'added', rank: 99, fit_score: null, breakdown: {} }))
  },
  async setMatchesPublished(table, candidateId, published) {
    must(await supabase.from(table).update({ visible_to_candidate: false }).eq('candidate_id', candidateId))
    if (published) {
      must(await supabase.from(table).update({ visible_to_candidate: true }).eq('candidate_id', candidateId).or('counsellor_action.is.null,counsellor_action.neq.hidden'))
    }
  },
  async careers() {
    return must(await supabase.from('careers').select(CAREER_COLS).order('name')) as Career[]
  },
  async streams() {
    return must(await supabase.from('stream_options').select('*').order('name')) as StreamOption[]
  },
  async sessions(candidateId) {
    return must(await supabase.from('sessions').select('*').eq('candidate_id', candidateId).order('scheduled_at', { ascending: false })) as CounsellingSession[]
  },
  async saveSession(s) {
    const me = await uid()
    const row = { counsellor_id: me, ...s }
    const q = s.id ? supabase.from('sessions').update(row).eq('id', s.id) : supabase.from('sessions').insert(row)
    return must(await q.select('*').single()) as CounsellingSession
  },
  async roadmap(candidateId) {
    const roadmap = must(await supabase.from('roadmaps').select('*').eq('candidate_id', candidateId).order('start_date', { ascending: false }).limit(1).maybeSingle()) as Roadmap | null
    if (!roadmap) return { roadmap: null, items: [] }
    const items = must(await supabase.from('roadmap_items').select('*').eq('roadmap_id', roadmap.id).order('due_date', { nullsFirst: false })) as RoadmapItem[]
    return { roadmap, items }
  },
  async createRoadmap(candidateId, template, startDate) {
    const t = ROADMAP_TEMPLATES[template]
    const end = new Date(startDate)
    end.setMonth(end.getMonth() + t.months)
    const roadmap = must(
      await supabase.from('roadmaps').insert({ candidate_id: candidateId, template, start_date: startDate, end_date: end.toISOString().slice(0, 10), status: 'draft' }).select('id').single(),
    ) as { id: string }
    if (t.items.length) {
      must(
        await supabase.from('roadmap_items').insert(
          t.items.map((i) => ({ roadmap_id: roadmap.id, kind: i.kind, title: i.title, owner: i.owner, due_date: addDays(startDate, i.offsetDays) })),
        ),
      )
    }
  },
  async saveRoadmapItem(item) {
    if (item.id) must(await supabase.from('roadmap_items').update(item).eq('id', item.id))
    else must(await supabase.from('roadmap_items').insert(item))
  },
  async deleteRoadmapItem(id) {
    must(await supabase.from('roadmap_items').delete().eq('id', id))
  },
  async setRoadmapStatus(roadmapId, status) {
    must(await supabase.from('roadmaps').update({ status }).eq('id', roadmapId))
  },
  async reports(candidateId) {
    return must(await supabase.from('reports').select('*').eq('candidate_id', candidateId).order('created_at', { ascending: false })) as Report[]
  },
  async requestReport(candidateId, kind, visibleTo) {
    const me = await uid()
    must(await supabase.from('reports').insert({ candidate_id: candidateId, kind, visible_to: visibleTo, generated_by: me, content: { status: 'requested' } }))
  },
  async reportUrl(reportId) {
    const { data, error } = await supabase.functions.invoke('generate_signed_report_url', { body: { report_id: reportId } })
    if (error) throw new Error(error.message)
    return (data as { url: string }).url
  },
  async documents(candidateId) {
    const { data, error } = await supabase.storage.from('documents').list(candidateId, { sortBy: { column: 'created_at', order: 'desc' } })
    if (error) throw new Error(error.message)
    const uploads: DocumentFile[] = (data ?? []).map((f) => ({
      name: f.name.replace(/^\d+-/, ''),
      path: `${candidateId}/${f.name}`,
      created_at: f.created_at ?? null,
      size: (f.metadata as { size?: number } | null)?.size ?? null,
      source: 'upload',
    }))
    const { items } = await supabaseApi.roadmap(candidateId)
    const evidence: DocumentFile[] = items
      .filter((i) => i.evidence_url)
      .map((i) => ({ name: `Evidence: ${i.title}`, path: i.evidence_url!, created_at: i.completed_at, size: null, source: 'evidence' }))
    return [...uploads, ...evidence]
  },
  async uploadDocument(candidateId, file) {
    const safe = file.name.replace(/[^\w.-]+/g, '_')
    const { error } = await supabase.storage.from('documents').upload(`${candidateId}/${Date.now()}-${safe}`, file)
    if (error) throw new Error(error.message)
  },
  async documentUrl(path) {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 900)
    if (error) throw new Error(error.message)
    return data.signedUrl
  },

  // ---------------------------------------------------------------- admin: library refresh and archiving
  async libraryRows(entity) {
    if (entity === 'stream') return must(await supabase.from('stream_options').select('*').order('name')) as LibraryRow[]
    const careers = must(await supabase.from('careers').select('*').order('name')) as LibraryRow[]
    const pathways = must(await supabase.from('education_pathways').select('career_id, level, stream_required, exams, degrees, institutions, duration, alternative_routes, notes')) as ({ career_id: string } & Record<string, unknown>)[]
    return careers.map((c) => ({ ...c, pathways: pathways.filter((p) => p.career_id === c.id).map(({ career_id: _, ...p }) => p) }))
  },
  async refreshRuns() {
    return must(await supabase.from('library_refresh_runs').select(RUN_COLS).order('created_at', { ascending: false }).limit(20)) as RefreshRun[]
  },
  async refreshRun(runId) {
    const run = must(await supabase.from('library_refresh_runs').select(RUN_COLS).eq('id', runId).single()) as RefreshRun
    const proposals = must(await supabase.from('library_refresh_proposals').select('*').eq('run_id', runId).order('entity').order('entity_name')) as RefreshProposal[]
    return { run, proposals }
  },
  async requestLibraryRefresh(scope, source, csv) {
    return must(await supabase.rpc('request_library_refresh', { p_scope: scope, p_source: source, p_csv: csv ?? null })) as string
  },
  async cancelLibraryRefresh(runId) {
    must(await supabase.rpc('cancel_library_refresh', { p_run_id: runId }))
  },
  async decideProposal(proposalId, decision) {
    must(await supabase.rpc('decide_refresh_proposal', { p_proposal_id: proposalId, p_decision: decision }))
  },
  async applyLibraryRefresh(runId) {
    return must(await supabase.rpc('apply_library_refresh', { p_run_id: runId })) as number
  },
  async archiveSettings() {
    return must(await supabase.from('archive_settings').select('auto_archive, candidate_inactive_days, lead_inactive_days, last_auto_run_at, updated_at').single()) as ArchiveSettings
  },
  async saveArchiveSettings(s) {
    must(await supabase.rpc('save_archive_settings', { p_auto: s.auto_archive, p_candidate_days: s.candidate_inactive_days, p_lead_days: s.lead_inactive_days }))
  },
  async archivePreview(candidatesBefore, leadsBefore) {
    return must(await supabase.rpc('archive_preview', { p_candidates_before: candidatesBefore, p_leads_before: leadsBefore })) as Awaited<ReturnType<Api['archivePreview']>>
  },
  async archiveInactive(candidatesBefore, leadsBefore) {
    return must(await supabase.rpc('archive_inactive', { p_candidates_before: candidatesBefore, p_leads_before: leadsBefore })) as { candidates: number; leads: number }
  },
  async archived() {
    const cands = must(await supabase.from('candidates').select('id, archived_at, users!candidates_user_id_fkey(full_name)').not('archived_at', 'is', null).order('archived_at', { ascending: false })) as unknown as { id: string; archived_at: string; users: { full_name: string } | null }[]
    const leads = must(await supabase.from('leads').select('id, name, archived_at').not('archived_at', 'is', null).order('archived_at', { ascending: false })) as { id: string; name: string | null; archived_at: string }[]
    return [
      ...cands.map((c): ArchivedRow => ({ entity: 'candidate', id: c.id, name: c.users?.full_name ?? null, archived_at: c.archived_at })),
      ...leads.map((l): ArchivedRow => ({ entity: 'lead', id: l.id, name: l.name, archived_at: l.archived_at })),
    ]
  },
  async restoreArchived(entity, id) {
    must(await supabase.rpc('restore_archived', { p_entity: entity, p_id: id }))
  },

  // ---------------------------------------------------------------- candidate
  async myCandidate() {
    const me = await uid()
    return must(await supabase.from('candidates').select('*').eq('user_id', me).order('created_at', { ascending: false }).limit(1).maybeSingle()) as Candidate | null
  },
  async myInstruments() {
    return must(await supabase.rpc('my_instruments')) as MyInstrument[]
  },
  async mySessions() {
    return must(await supabase.from('v_candidate_sessions').select('*').order('scheduled_at')) as CounsellingSession[]
  },
  async myProgress() {
    const [cm, sm, rm, ss, pf] = await Promise.all([
      supabase.from('v_candidate_matches').select('id', { count: 'exact', head: true }),
      supabase.from('v_candidate_stream_matches').select('id', { count: 'exact', head: true }),
      supabase.from('roadmaps').select('id', { count: 'exact', head: true }),
      supabase.from('v_candidate_sessions').select('id', { count: 'exact', head: true }).eq('attended', true),
      supabase.from('profile_summary').select('candidate_id', { count: 'exact', head: true }),
    ])
    return {
      publishedOptions: (cm.count ?? 0) + (sm.count ?? 0) > 0,
      publishedRoadmap: (rm.count ?? 0) > 0,
      attendedSessions: ss.count ?? 0,
      profileApproved: (pf.count ?? 0) > 0,
    }
  },
  async startAssessment(candidateId, instrumentId) {
    const device = /Mobi/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
    const row = must(await supabase.from('assessment_sessions').insert({ candidate_id: candidateId, instrument_id: instrumentId, device }).select('id').single()) as { id: string }
    return row.id
  },
  async nextItem(sessionId, position) {
    return must(await supabase.rpc('next_item', { p_session_id: sessionId, p_position: position ?? null })) as NextItem
  },
  async saveResponses(sessionId, responses) {
    return must(await supabase.rpc('save_responses', { p_session_id: sessionId, p_responses: responses })) as number
  },
  async completeAssessment(sessionId) {
    const device = /Mobi/i.test(navigator.userAgent) ? 'mobile' : 'desktop'
    must(await supabase.rpc('complete_assessment', { p_session_id: sessionId, p_device: device }))
  },
}
